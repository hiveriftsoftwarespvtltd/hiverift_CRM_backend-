import { Injectable, NotFoundException, BadRequestException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Quotation, QuotationDocument } from './schemas/quotation.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Project, ProjectDocument, ProjectStatus, ProjectDepartment } from '../projects/schemas/project.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { MailService } from '../common/services/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class QuotationsService implements OnModuleInit {
  constructor(
    @InjectModel(Quotation.name) private quotationModel: Model<QuotationDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    private mailService: MailService,
    private notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    // One-time self-healing migration for existing unversioned quotations
    try {
      const unversioned = await this.quotationModel.find({
        $or: [
          { version: { $exists: false } },
          { isLatest: { $exists: false } },
          { rootQuotationNo: { $exists: false } },
        ],
      });
      if (unversioned.length > 0) {
        for (const q of unversioned) {
          if (!q.rootQuotationNo) {
            const match = (q.quotationNo || '').match(/^(QUO-\d+-\d+)/i);
            q.rootQuotationNo = match ? match[1].toUpperCase() : q.quotationNo;
          }
          if (!q.version) q.version = 1;
          if (q.isLatest === undefined) q.isLatest = true;
          await q.save();
        }
        console.log(`[QuotationsService] Migrated ${unversioned.length} legacy quotations to versioning schema.`);
      }
    } catch (e) {
      console.error('[QuotationsService] Migration check error:', e);
    }
  }

  private async generateQuotationNo(): Promise<{ quotationNo: string; rootQuotationNo: string }> {
    const year = new Date().getFullYear();
    const quotations = await this.quotationModel.find({}, { quotationNo: 1, rootQuotationNo: 1 }).lean();
    let maxNum = 0;
    for (const q of quotations) {
      const candidate = q.rootQuotationNo || q.quotationNo;
      if (candidate) {
        const match = candidate.match(/QUO-\d+-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (
      await this.quotationModel.findOne({
        $or: [
          { quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` },
          { quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}-V1` },
          { rootQuotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` },
        ],
      })
    ) {
      nextNum++;
    }
    const root = `QUO-${year}-${String(nextNum).padStart(4, '0')}`;
    return { quotationNo: `${root}-V1`, rootQuotationNo: root };
  }

  private async notifyAdminsAboutQuotation(quotation: QuotationDocument, salesUserId: string, title: string) {
    try {
      const salesUser = await this.userModel.findById(salesUserId).select('name email');
      const salesName = salesUser?.name || 'Sales Representative';
      const admins = await this.userModel.find({ role: { $in: ['admin', 'superadmin', 'management'] } }).select('_id');

      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin._id.toString(),
          title,
          message: `${salesName} submitted Quotation ${quotation.quotationNo} (₹${quotation.totalAmount?.toLocaleString('en-IN')}) for approval.`,
          type: 'quotation',
          module: 'quotations',
          referenceId: quotation._id.toString(),
        });
      }
    } catch (err) {
      console.error('Failed to dispatch quotation notification to admins:', err);
    }
  }

  private async notifySalesAboutApproval(quotation: QuotationDocument, approved: boolean, reason?: string) {
    try {
      if (!quotation.createdBy) return;
      const salesUserId = (quotation.createdBy as any)._id
        ? (quotation.createdBy as any)._id.toString()
        : quotation.createdBy.toString();

      await this.notificationsService.create({
        userId: salesUserId,
        title: approved ? 'Quotation Approved' : 'Quotation Approval Rejected',
        message: approved
          ? `SuperAdmin approved Quotation ${quotation.quotationNo}. You can now send it to the client.`
          : `SuperAdmin rejected Quotation ${quotation.quotationNo}. Reason: "${reason || 'Requires revision'}"`,
        type: 'quotation',
        module: 'quotations',
        referenceId: quotation._id.toString(),
      });
    } catch (err) {
      console.error('Failed to notify sales user about quotation approval:', err);
    }
  }


  /**
   * Idempotently provision a Project from an Accepted Quotation (M03 / COM-04)
   */
  private async autoProvisionProjectFromQuotation(quotation: QuotationDocument) {
    try {
      if (!quotation || quotation.status !== 'accepted') return;

      // Check if project already provisioned for this quotation
      const existing = await this.projectModel.findOne({ quotationRef: quotation._id });
      if (existing) {
        return existing;
      }

      // Determine client ObjectId
      let clientId = quotation.client;
      if (!clientId && quotation.lead) {
        // Find if lead already has a client ref
        const lead = await this.leadModel.findById(quotation.lead).select('clientRef').lean();
        if (lead && (lead as any).clientRef) {
          clientId = (lead as any).clientRef;
        }
      }

      if (!clientId) {
        console.log(`[autoProvisionProject] Skipping project provisioning for ${quotation.quotationNo}: No linked client found yet.`);
        return;
      }

      const prjName = quotation.headerTitle || `Project - ${quotation.quotationNo}`;
      const deadline = quotation.validUntil ? new Date(quotation.validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const newProject = new this.projectModel({
        name: prjName,
        client: clientId,
        department: ProjectDepartment.DEVELOPMENT,
        service: quotation.services && quotation.services[0] ? quotation.services[0].name : 'Custom Service',
        status: ProjectStatus.ASSIGNED,
        progress: 0,
        startDate: new Date(),
        deadline,
        value: quotation.totalAmount || 0,
        requirements: quotation.executiveSummary || quotation.notes || 'Scope provisioned from accepted quotation ' + quotation.quotationNo,
        leadRef: quotation.lead,
        quotationRef: quotation._id,
        assignedBy: quotation.approvedBy || quotation.createdBy,
        notes: [
          {
            text: `Project automatically provisioned from accepted Quotation ${quotation.quotationNo} (Approved by ${quotation.approvedByName || quotation.signerName || 'Client'})`,
            createdAt: new Date(),
          },
        ],
      });

      const savedPrj = await newProject.save();
      console.log(`[autoProvisionProject] Successfully provisioned Project ${savedPrj.projectId} from Quotation ${quotation.quotationNo}`);
      return savedPrj;
    } catch (err) {
      console.error('[autoProvisionProject] Error provisioning project from quotation:', err);
    }
  }

  private async syncQuotationPayment(quotation: QuotationDocument, userId?: string) {
    if (!quotation || !quotation.totalAmount) return;

    try {
      // ONLY create/sync payment if lead status is 'won', or quotation is 'approved'/'accepted', or client is attached
      let isWonOrApproved = false;
      if (quotation.status === 'approved' || quotation.status === 'accepted') {
        isWonOrApproved = true;
      }

      if (!isWonOrApproved && quotation.lead) {
        const leadDoc = await this.leadModel.findById(quotation.lead);
        if (leadDoc && leadDoc.status === 'won') {
          isWonOrApproved = true;
        }
      }

      if (!isWonOrApproved && quotation.client) {
        isWonOrApproved = true;
      }

      if (!isWonOrApproved) {
        return; // Skip payment creation for unapproved/prospect quotations
      }

      // Find if payment ledger already exists for this quotation or root quotation
      let payment = await this.paymentModel.findOne({ quotation: quotation._id });
      if (!payment && quotation.client) {
        payment = await this.paymentModel.findOne({ client: quotation.client, quotation: { $exists: false } });
      }

      if (payment) {
        payment.invoiceAmount = quotation.totalAmount;
        payment.pendingAmount = Math.max(0, quotation.totalAmount - (payment.receivedAmount || 0));
        if (payment.receivedAmount >= quotation.totalAmount && quotation.totalAmount > 0) {
          payment.status = 'paid';
        } else if (payment.receivedAmount > 0) {
          payment.status = 'partial';
        } else {
          payment.status = 'pending';
        }
        payment.quotation = quotation._id as any;
        if (quotation.client) payment.client = quotation.client;
        if (quotation.lead) (payment as any).lead = quotation.lead;
        await payment.save();
      } else {
        const year = new Date().getFullYear();
        const lastDoc = await this.paymentModel
          .findOne({ paymentNo: { $regex: new RegExp(`^PAY-${year}-\\d+$`) } })
          .sort({ paymentNo: -1, createdAt: -1 });

        let nextNum = 1;
        if (lastDoc && lastDoc.paymentNo) {
          const match = lastDoc.paymentNo.match(/PAY-\d+-(\d+)/);
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        while (await this.paymentModel.findOne({ paymentNo: `PAY-${year}-${String(nextNum).padStart(4, '0')}` })) {
          nextNum++;
        }
        const paymentNo = `PAY-${year}-${String(nextNum).padStart(4, '0')}`;

        const newPayment = new this.paymentModel({
          paymentNo,
          client: quotation.client || undefined,
          lead: quotation.lead || undefined,
          quotation: quotation._id,
          invoiceAmount: quotation.totalAmount,
          receivedAmount: 0,
          pendingAmount: quotation.totalAmount,
          status: 'pending',
          paymentMethod: 'bank_transfer',
          notes: `Automated payment invoice created from Quotation ${quotation.quotationNo}`,
          createdBy: userId ? new Types.ObjectId(userId) : quotation.createdBy,
        });

        await newPayment.save();
      }
    } catch (err) {
      console.error('Error syncing quotation payment:', err);
    }
  }

  async create(dto: any, userId: string, userRole?: string): Promise<QuotationDocument> {
    const { quotationNo, rootQuotationNo } = await this.generateQuotationNo();
    const initialStatus = dto.status || (userRole === 'sales' ? 'pending_approval' : 'draft');
    const payload: any = {
      ...dto,
      status: initialStatus,
      quotationNo,
      rootQuotationNo,
      version: 1,
      isLatest: true,
      createdBy: new Types.ObjectId(userId),
    };
    if (userRole === 'sales' || initialStatus === 'pending_approval') {
      payload.approvalRequestedAt = new Date();
    }
    if (dto.lead) payload.lead = new Types.ObjectId(dto.lead);
    if (dto.client) payload.client = new Types.ObjectId(dto.client);

    const quotation = new this.quotationModel(payload);
    const saved = await quotation.save();

    // Auto-sync into Payments collection if already approved
    await this.syncQuotationPayment(saved, userId);

    // If sales role created it in pending_approval, notify admins
    if (userRole === 'sales' || initialStatus === 'pending_approval') {
      await this.notifyAdminsAboutQuotation(saved, userId, `New Quotation ${saved.quotationNo} Submitted for Approval`);
    }

    return saved;
  }

  async createRevision(
    id: string,
    dto: { revisionReason?: string; discount?: number; notes?: string; services?: any[] },
    userId: string,
    userRole?: string,
  ): Promise<QuotationDocument> {
    const prev = await this.quotationModel.findById(id);
    if (!prev) throw new NotFoundException('Quotation not found');

    const root = prev.rootQuotationNo || prev.quotationNo.replace(/-V\d+$/i, '');
    const currentVersion = prev.version || 1;
    const nextVersion = currentVersion + 1;
    const newQuotationNo = `${root}-V${nextVersion}`;

    // Mark previous versions for this root as isLatest = false
    await this.quotationModel.updateMany({ rootQuotationNo: root }, { isLatest: false });
    if (prev.status !== 'accepted' && prev.status !== 'won') {
      prev.status = 'superseded';
      prev.isLatest = false;
      await prev.save();
    }

    const prevObj: any = prev.toObject ? prev.toObject() : { ...prev };
    delete prevObj._id;
    delete prevObj.createdAt;
    delete prevObj.updatedAt;
    delete prevObj.__v;

    const initialStatus = userRole === 'sales' ? 'pending_approval' : 'draft';

    const newQuotation = new this.quotationModel({
      ...prevObj,
      rootQuotationNo: root,
      quotationNo: newQuotationNo,
      version: nextVersion,
      parentQuotation: prev._id,
      isLatest: true,
      status: initialStatus,
      revisionReason: dto.revisionReason || `Revision V${nextVersion} created for negotiation`,
      approvalRequestedAt: userRole === 'sales' || initialStatus === 'pending_approval' ? new Date() : undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      rejectionReason: undefined,
      sentAt: undefined,
      viewedAt: undefined,
      clientAcceptedAt: undefined,
      clientAcceptedNotes: undefined,
      clientFeedback: undefined,
      createdBy: new Types.ObjectId(userId),
      ...(dto.services ? { services: dto.services } : {}),
      ...(dto.discount !== undefined ? { discount: Number(dto.discount) } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });

    const saved = await newQuotation.save();

    if (userRole === 'sales' || initialStatus === 'pending_approval') {
      await this.notifyAdminsAboutQuotation(saved, userId, `Quotation Revision ${newQuotationNo} Submitted for Approval`);
    }

    return this.findOne(saved._id.toString());
  }

  async getVersionHistory(id: string): Promise<QuotationDocument[]> {
    const q = await this.quotationModel.findById(id);
    if (!q) throw new NotFoundException('Quotation not found');

    const root = q.rootQuotationNo || q.quotationNo.replace(/-V\d+$/i, '');
    const versions = await this.quotationModel
      .find({
        $or: [
          { rootQuotationNo: root },
          { quotationNo: { $regex: new RegExp(`^${root}(-V\\d+)?$`, 'i') } },
        ],
      })
      .populate('createdBy', 'name email role')
      .populate('approvedBy', 'name email role')
      .sort({ version: -1, createdAt: -1 });

    return versions;
  }

  async findAll(query: any, user?: any): Promise<{ quotations: QuotationDocument[]; total: number }> {
    const { status, lead, client, page = 1, limit = 20, search, onlyLatest = 'true' } = query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (lead) filter.lead = new Types.ObjectId(lead);
    if (client) filter.client = new Types.ObjectId(client);

    if (onlyLatest === 'true' || onlyLatest === true) {
      filter.$or = [{ isLatest: true }, { isLatest: { $exists: false } }];
    }

    // Sales role isolation
    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.createdBy = new Types.ObjectId(uId);
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const searchConditions = [
        { quotationNo: searchRegex },
        { rootQuotationNo: searchRegex },
        { 'services.name': searchRegex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [quotations, total] = await Promise.all([
      this.quotationModel
        .find(filter)
        .populate('lead', 'name company email phone')
        .populate('client', 'name company email phone')
        .populate('createdBy', 'name email role')
        .populate('parentQuotation', 'quotationNo version totalAmount')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.quotationModel.countDocuments(filter),
    ]);

    // Automated expiry check
    const now = new Date();
    for (const q of quotations) {
      if (
        q.validUntil &&
        new Date(q.validUntil) < now &&
        ['sent', 'viewed', 'pending_approval', 'negotiation'].includes(q.status)
      ) {
        q.status = 'expired';
        await this.quotationModel.findByIdAndUpdate(q._id, { status: 'expired' });
      }
    }

    return { quotations, total };
  }

  async findOne(id: string, user?: any): Promise<QuotationDocument> {
    const q = await this.quotationModel
      .findById(id)
      .populate('lead', 'name company email phone address city')
      .populate('client', 'name company email phone address city gstin')
      .populate('parentQuotation', 'quotationNo version totalAmount createdAt')
      .populate('createdBy', 'name email phone role');
    if (!q) throw new NotFoundException('Quotation not found');

    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      const creatorId = (q.createdBy as any)?._id ? (q.createdBy as any)._id.toString() : (q.createdBy as any)?.toString();
      if (creatorId && creatorId !== uId) {
        throw new ForbiddenException('You do not have permission to view this quotation');
      }
    }
    return q;
  }

  async update(id: string, dto: any, user?: any): Promise<QuotationDocument> {
    const q = await this.findOne(id, user);

    if (dto.services) q.services = dto.services;
    if (dto.discount !== undefined) q.discount = Number(dto.discount) || 0;
    if (dto.taxPercent !== undefined) q.taxPercent = Number(dto.taxPercent) || 0;
    if (dto.validUntil) q.validUntil = new Date(dto.validUntil);
    if (dto.notes !== undefined) q.notes = dto.notes;
    if (dto.status) q.status = dto.status;
    if (dto.templateType) q.templateType = dto.templateType;
    if (dto.headerTitle !== undefined) (q as any).headerTitle = dto.headerTitle;
    if (dto.subTitle !== undefined) (q as any).subTitle = dto.subTitle;
    if (dto.customClientHeading !== undefined) (q as any).customClientHeading = dto.customClientHeading;
    if (dto.section1Title !== undefined) (q as any).section1Title = dto.section1Title;
    if (dto.section2Title !== undefined) (q as any).section2Title = dto.section2Title;
    if (dto.section3Title !== undefined) (q as any).section3Title = dto.section3Title;
    if (dto.section4Title !== undefined) (q as any).section4Title = dto.section4Title;
    if (dto.section5Title !== undefined) (q as any).section5Title = dto.section5Title;
    if (dto.executiveSummary !== undefined) (q as any).executiveSummary = dto.executiveSummary;
    if (dto.termsAndConditions !== undefined) (q as any).termsAndConditions = dto.termsAndConditions;
    if (dto.footerQuote !== undefined) (q as any).footerQuote = dto.footerQuote;
    if (dto.lead) q.lead = new Types.ObjectId(dto.lead);
    if (dto.client) q.client = new Types.ObjectId(dto.client);

    // Calculate totals
    if (q.services?.length) {
      q.subtotal = q.services.reduce((s, svc) => s + (Number(svc.amount) || ((Number(svc.quantity) || 1) * (Number(svc.rate) || 0))), 0);
      q.taxAmount = Math.max(0, ((q.subtotal - q.discount) * q.taxPercent) / 100);
      q.totalAmount = Math.max(0, q.subtotal - q.discount + q.taxAmount);
    }

    const updated = await q.save();

    // Auto-update price in Payments collection
    await this.syncQuotationPayment(updated);

    return updated;
  }

  async updateStatus(id: string, status: string, user?: any): Promise<QuotationDocument> {
    const q = await this.findOne(id, user);
    const updatePayload: any = { status };
    if (status === 'sent') {
      updatePayload.sentAt = new Date();
    } else if (status === 'approved') {
      updatePayload.approvedAt = new Date();
      if (user && user._id) updatePayload.approvedBy = new Types.ObjectId(user._id);
    } else if (status === 'pending_approval') {
      updatePayload.approvalRequestedAt = new Date();
    }

    const updated = await this.quotationModel.findByIdAndUpdate(id, updatePayload, { new: true });
    if (!updated) throw new NotFoundException('Quotation not found');

    await this.syncQuotationPayment(updated);
    return updated;
  }

  async requestApproval(id: string, user?: any): Promise<QuotationDocument> {
    const q = await this.findOne(id, user);
    q.status = 'pending_approval';
    (q as any).approvalRequestedAt = new Date();
    const saved = await q.save();

    const userId = user?._id?.toString() || (q.createdBy as any)?.toString();
    await this.notifyAdminsAboutQuotation(saved, userId, `Quotation Approval Requested: ${saved.quotationNo}`);

    return saved;
  }

  async approve(id: string, user?: any): Promise<QuotationDocument> {
    if (user && user.role === 'sales') {
      throw new ForbiddenException('Only SuperAdmin/Admin can approve quotations');
    }
    const q = await this.findOne(id);
    q.status = 'approved';
    (q as any).approvedAt = new Date();
    if (user && user._id) (q as any).approvedBy = new Types.ObjectId(user._id);
    const saved = await q.save();

    // Notify the salesperson that quote was approved
    await this.notifySalesAboutApproval(saved, true);
    await this.syncQuotationPayment(saved);

    return saved;
  }

  async reject(id: string, reason?: string, user?: any): Promise<QuotationDocument> {
    if (user && user.role === 'sales') {
      throw new ForbiddenException('Only SuperAdmin/Admin can reject quotations');
    }
    const q = await this.findOne(id);
    q.status = 'rejected_approval';
    (q as any).rejectionReason = reason || 'Not approved by SuperAdmin';
    const saved = await q.save();

    // Notify the salesperson that quote was rejected with feedback
    await this.notifySalesAboutApproval(saved, false, reason);
    return saved;
  }

  async sendEmail(id: string, user?: any): Promise<{ success: boolean; message: string }> {
    const quotation = await this.findOne(id, user);

    if (user && user.role === 'sales') {
      const allowed = ['approved', 'sent', 'viewed', 'accepted'];
      if (!allowed.includes(quotation.status)) {
        if (quotation.status === 'pending_approval') {
          throw new ForbiddenException('This quotation is currently PENDING SuperAdmin approval. You cannot send it to the client until SuperAdmin approves it.');
        } else if (quotation.status === 'rejected_approval') {
          throw new ForbiddenException(`SuperAdmin REJECTED this quotation: "${quotation.rejectionReason || 'Requires revision'}". Please edit and request approval again.`);
        } else {
          throw new ForbiddenException('This quotation must be approved by SuperAdmin before sending to client.');
        }
      }
    }

    const recipient = (quotation.lead as any)?.email || (quotation.client as any)?.email;
    const recipientName = (quotation.lead as any)?.name || (quotation.client as any)?.name || 'Valued Client';

    if (!recipient) {
      throw new NotFoundException('No email address registered for this Lead or Client profile');
    }

    const sent = await this.mailService.sendQuotationEmail(recipient, recipientName, quotation);
    if (sent) {
      await this.quotationModel.findByIdAndUpdate(id, { status: 'sent', sentAt: new Date() });
      await this.syncQuotationPayment(quotation);
      return { success: true, message: `Quotation ${quotation.quotationNo} successfully sent to ${recipient}` };
    } else {
      throw new BadRequestException(`Failed to dispatch email to ${recipient}. Please check SMTP/Email configuration.`);
    }
  }

  // ==========================================
  // Public Client Portal Endpoints
  // ==========================================
  async getPublicQuotation(id: string): Promise<any> {
    const q = await this.quotationModel
      .findById(id)
      .populate('lead', 'name company email phone city')
      .populate('client', 'name company email phone city gstin address')
      .populate('createdBy', 'name email phone');

    if (!q) throw new NotFoundException('Proposal document not found or link has expired');

    // Auto mark as viewed when opened
    if (q.status === 'sent') {
      q.status = 'viewed';
      q.viewedAt = new Date();
      await q.save();
    }

    return q;
  }

  async acceptPublicProposal(
    id: string,
    body?: {
      notes?: string;
      approvedByName?: string;
      approvedByEmail?: string;
      approvedByPhone?: string;
      signerName?: string;
      signerEmail?: string;
      ipAddress?: string;
    }
  ): Promise<{ success: boolean; message: string }> {
    const q = await this.quotationModel.findById(id);
    if (!q) throw new NotFoundException('Quotation not found');

    const approverName = body?.approvedByName || body?.signerName || '';
    const approverEmail = body?.approvedByEmail || body?.signerEmail || '';
    const approverPhone = body?.approvedByPhone || '';

    q.status = 'accepted';
    (q as any).clientAcceptedAt = new Date();
    if (body?.notes) (q as any).clientAcceptedNotes = body.notes;
    if (approverName) {
      (q as any).approvedByName = approverName;
      (q as any).signerName = approverName;
    }
    if (approverEmail) {
      (q as any).approvedByEmail = approverEmail;
      (q as any).signerEmail = approverEmail;
    }
    if (approverPhone) (q as any).approvedByPhone = approverPhone;
    if (body?.ipAddress) (q as any).approvedByIpAddress = body.ipAddress;
    await q.save();

    await this.syncQuotationPayment(q);
    await this.autoProvisionProjectFromQuotation(q);

    // Notify creator & admins
    try {
      const creatorId = q.createdBy ? q.createdBy.toString() : null;
      if (creatorId) {
        await this.notificationsService.create({
          userId: creatorId,
          title: 'Proposal Accepted by Client!',
          message: `Client accepted Proposal ${q.quotationNo} (₹${q.totalAmount?.toLocaleString('en-IN')})!`,
          type: 'quotation',
          module: 'quotations',
          referenceId: q._id.toString(),
        });
      }
      const admins = await this.userModel.find({ role: { $in: ['admin', 'superadmin'] } }).select('_id');
      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin._id.toString(),
          title: 'Proposal Accepted by Client!',
          message: `Client accepted Proposal ${q.quotationNo} (₹${q.totalAmount?.toLocaleString('en-IN')})!`,
          type: 'quotation',
          module: 'quotations',
          referenceId: q._id.toString(),
        });
      }
    } catch (err) {
      console.error('Failed to notify upon client acceptance:', err);
    }

    return { success: true, message: `Proposal ${q.quotationNo} successfully accepted.` };
  }

  async requestChangesPublic(id: string, feedback: string): Promise<{ success: boolean; message: string }> {
    const q = await this.quotationModel.findById(id);
    if (!q) throw new NotFoundException('Quotation not found');

    q.status = 'negotiation';
    (q as any).clientFeedback = feedback;
    await q.save();

    try {
      const creatorId = q.createdBy ? q.createdBy.toString() : null;
      if (creatorId) {
        await this.notificationsService.create({
          userId: creatorId,
          title: 'Client Requested Proposal Revision',
          message: `Client requested changes on ${q.quotationNo}: "${feedback}"`,
          type: 'quotation',
          module: 'quotations',
          referenceId: q._id.toString(),
        });
      }
    } catch (err) {
      console.error('Failed to notify upon client revision request:', err);
    }

    return { success: true, message: 'Your revision request has been submitted to the account manager.' };
  }

  async remove(id: string, user?: any): Promise<void> {
    await this.findOne(id, user);
    const q = await this.quotationModel.findByIdAndDelete(id);
    if (!q) throw new NotFoundException('Quotation not found');
  }

  async delete(id: string, user?: any): Promise<void> {
    return this.remove(id, user);
  }

  async bulkDelete(ids: string[], user?: any): Promise<{ count: number }> {
    if (!ids || !ids.length) return { count: 0 };
    const res = await this.quotationModel.deleteMany({ _id: { $in: ids } });
    return { count: res.deletedCount || 0 };
  }
}
