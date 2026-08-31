import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument, LeadStatus, LeadSource } from './schemas/lead.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { Quotation, QuotationDocument } from '../quotations/schemas/quotation.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateFollowupDto } from './dto/create-followup.dto';

function sanitizePhone(phoneStr?: string): string {
  if (!phoneStr) return '';
  const digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Quotation.name) private quotationModel: Model<QuotationDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async generateLeadId(): Promise<string> {
    const leads = await this.leadModel.find({}, { leadId: 1 }).lean();
    let maxNum = 0;
    for (const l of leads) {
      if (l.leadId) {
        const match = l.leadId.match(/LEAD-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.leadModel.findOne({ leadId: `LEAD-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `LEAD-${String(nextNum).padStart(4, '0')}`;
  }

  private async generateClientId(): Promise<string> {
    const clients = await this.clientModel.find({}, { clientId: 1 }).lean();
    let maxNum = 0;
    for (const c of clients) {
      if (c.clientId) {
        const match = c.clientId.match(/CLT-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.clientModel.findOne({ clientId: `CLT-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `CLT-${String(nextNum).padStart(4, '0')}`;
  }

  async autoCreateClientFromWonLead(lead: LeadDocument, userId?: string): Promise<ClientDocument | null> {
    if (!lead || lead.status !== LeadStatus.WON) return null;

    // Check if client record already exists for this lead
    let existingClient = await this.clientModel.findOne({
      $or: [
        { leadRef: lead._id },
        ...(lead.email ? [{ email: lead.email.toLowerCase().trim() }] : []),
        ...(lead.phone ? [{ phone: lead.phone.trim() }] : []),
      ],
    });

    if (existingClient) {
      if (!existingClient.leadRef) {
        existingClient.leadRef = lead._id;
        await existingClient.save();
      }
      await this.quotationModel.updateMany({ lead: lead._id, client: { $exists: false } }, { client: existingClient._id });
      await this.paymentModel.updateMany({ lead: lead._id, client: { $exists: false } }, { client: existingClient._id });
      return existingClient;
    }

    // Automatically generate new client profile
    const clientId = await this.generateClientId();
    const newClient = new this.clientModel({
      clientId,
      name: lead.name,
      company: lead.company || lead.name,
      phone: lead.phone,
      whatsapp: lead.whatsapp || lead.phone,
      email: lead.email ? lead.email.toLowerCase().trim() : undefined,
      city: lead.city || undefined,
      address: lead.address || undefined,
      leadRef: lead._id,
      assignedSales: lead.assignedTo || undefined,
      createdBy: userId ? new Types.ObjectId(userId) : lead.createdBy,
      status: 'active',
      totalBusiness: lead.estimatedValue || 0,
      totalRevenue: 0,
      pendingAmount: lead.estimatedValue || 0,
    });

    const savedClient = await newClient.save();

    // Link quotations & payments of this lead to the newly created client
    await this.quotationModel.updateMany({ lead: lead._id }, { $set: { client: savedClient._id } });
    await this.paymentModel.updateMany({ lead: lead._id }, { $set: { client: savedClient._id } });

    // Auto-create Payment entry for this WON lead if no payment exists yet and lead has value
    let payment = await this.paymentModel.findOne({
      $or: [{ client: savedClient._id }, { lead: lead._id }],
    });

    if (!payment && (lead.estimatedValue || 0) > 0) {
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
        client: savedClient._id,
        lead: lead._id,
        invoiceAmount: lead.estimatedValue || 0,
        receivedAmount: 0,
        pendingAmount: lead.estimatedValue || 0,
        status: 'pending',
        paymentMethod: 'bank_transfer',
        notes: `Automated payment ledger created for WON Lead (${lead.leadId}: ${lead.name})`,
        createdBy: userId ? new Types.ObjectId(userId) : lead.createdBy,
      });

      await newPayment.save();
    }

    return savedClient;
  }

  async create(createLeadDto: CreateLeadDto, userId: string, user?: any): Promise<LeadDocument> {
    const cleanPhone = sanitizePhone(createLeadDto.phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new BadRequestException('Phone number must be a valid 10-digit number (e.g. 9876543210)');
    }

    const cleanWhatsapp = createLeadDto.whatsapp ? sanitizePhone(createLeadDto.whatsapp) : cleanPhone;
    if (cleanWhatsapp && cleanWhatsapp.length !== 10) {
      throw new BadRequestException('WhatsApp number must be a valid 10-digit number');
    }

    const cleanEmail = createLeadDto.email ? createLeadDto.email.toLowerCase().trim() : undefined;

    // Check Duplicate Lead by Phone (regex matches any format e.g. +91 9876543210, 09876543210, 9876543210) or Email
    const phoneRegex = new RegExp(cleanPhone);
    const duplicateConditions: any[] = [
      { phone: { $regex: phoneRegex } },
      { whatsapp: { $regex: phoneRegex } },
    ];
    if (cleanEmail) {
      duplicateConditions.push({ email: new RegExp(`^${cleanEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') });
    }

    const existingLead = await this.leadModel.findOne({ $or: duplicateConditions });
    if (existingLead) {
      throw new ConflictException(
        `Duplicate Lead Error: A lead with phone ${cleanPhone}${cleanEmail ? ' or email' : ''} already exists! (Lead ID: ${existingLead.leadId}, Name: ${existingLead.name})`
      );
    }

    const leadId = await this.generateLeadId();
    const mode = createLeadDto.meetingMode || 'online';
    const payload: any = {
      ...createLeadDto,
      phone: cleanPhone,
      whatsapp: cleanWhatsapp,
      email: cleanEmail,
      meetingMode: mode,
      leadId,
      createdBy: new Types.ObjectId(userId),
    };

    // If user is sales executive, automatically assign to themselves
    if (user?.role === 'sales') {
      payload.assignedTo = new Types.ObjectId(userId);
      payload.status = LeadStatus.ASSIGNED;
    } else if (createLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(createLeadDto.assignedTo);
      payload.status = LeadStatus.ASSIGNED;
    } else {
      payload.status = LeadStatus.NEW;
    }

    const lead = new this.leadModel(payload);
    const saved = await lead.save();

    if (saved.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(saved, userId);
    }
    return saved;
  }

  async findAll(query: any, user: any): Promise<{ leads: LeadDocument[]; total: number }> {
    const { search, status, source, meetingMode, assignedTo, page = 1, limit = 20, startDate, endDate } = query;
    const filter: any = {};

    // Sales users see only their assigned leads or leads created by them
    if (user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
        { createdBy: new Types.ObjectId(uId) },
        { createdBy: uId },
      ];
    }

    if (search) {
      // Find all users whose name or email matches search term
      const matchingUsers = await this.userModel.find(
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        },
        { _id: 1 },
      ).lean();

      const matchingUserIds = matchingUsers.map((u) => u._id);

      const searchConditions: any[] = [
        { name: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { requirement: { $regex: search, $options: 'i' } },
      ];

      if (matchingUserIds.length > 0) {
        searchConditions.push(
          { assignedTo: { $in: matchingUserIds } },
          { createdBy: { $in: matchingUserIds } },
        );
      }

      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (source && source !== 'all') {
      filter.source = source;
    }

    if (meetingMode && meetingMode !== 'all') {
      filter.meetingMode = meetingMode;
    }

    if (assignedTo && user.role !== 'sales') {
      filter.assignedTo = new Types.ObjectId(assignedTo);
    }

    // Followup specific filter (overdue / today)
    if (query.followupFilter === 'overdue') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      filter.nextFollowup = { $lt: startOfToday, $ne: null };
      filter.status = { $nin: ['won', 'lost'] };
    } else if (query.followupFilter === 'today') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      filter.nextFollowup = { $gte: startOfToday, $lte: endOfToday };
      filter.status = { $nin: ['won', 'lost'] };
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [leads, total] = await Promise.all([
      this.leadModel
        .find(filter)
        .populate('assignedTo', 'name email role')
        .populate('createdBy', 'name email role')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.leadModel.countDocuments(filter),
    ]);

    return { leads, total };
  }

  async findOne(id: string): Promise<LeadDocument> {
    const lead = await this.leadModel
      .findById(id)
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role')
      .populate('followups.createdBy', 'name email role')
      .populate('notes.createdBy', 'name email role');

    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async update(id: string, updateLeadDto: UpdateLeadDto, userId?: string, user?: any): Promise<LeadDocument> {
    const existing = await this.leadModel.findById(id);
    if (!existing) throw new NotFoundException('Lead not found');

    const payload: any = { ...updateLeadDto };

    if (updateLeadDto.phone) {
      const cleanPhone = sanitizePhone(updateLeadDto.phone);
      if (cleanPhone.length !== 10) {
        throw new BadRequestException('Phone number must be a valid 10-digit number');
      }
      payload.phone = cleanPhone;

      // Duplicate check for another lead using regex
      const phoneRegex = new RegExp(cleanPhone);
      const conflict = await this.leadModel.findOne({
        _id: { $ne: new Types.ObjectId(id) },
        $or: [{ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } }],
      });
      if (conflict) {
        throw new ConflictException(
          `Duplicate Lead Error: Phone number ${cleanPhone} already belongs to another lead (${conflict.leadId}: ${conflict.name}).`
        );
      }
    }

    if (updateLeadDto.whatsapp) {
      const cleanWhatsapp = sanitizePhone(updateLeadDto.whatsapp);
      if (cleanWhatsapp.length !== 10) {
        throw new BadRequestException('WhatsApp number must be a valid 10-digit number');
      }
      payload.whatsapp = cleanWhatsapp;
    }

    if (updateLeadDto.email) {
      const cleanEmail = updateLeadDto.email.toLowerCase().trim();
      payload.email = cleanEmail;

      const conflict = await this.leadModel.findOne({
        _id: { $ne: new Types.ObjectId(id) },
        email: cleanEmail,
      });
      if (conflict) {
        throw new ConflictException(
          `Duplicate Lead Error: Email address ${cleanEmail} already belongs to another lead (${conflict.leadId}: ${conflict.name}).`
        );
      }
    }

    if (updateLeadDto.meetingMode) {
      payload.meetingMode = updateLeadDto.meetingMode;
    }

    // If sales role, do not allow changing assignedTo
    if (user?.role === 'sales') {
      delete payload.assignedTo;
    } else if (updateLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(updateLeadDto.assignedTo);
    }

    const lead = await this.leadModel.findByIdAndUpdate(id, payload, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(lead, userId);
    }

    return lead;
  }

  async updateStatus(id: string, status: string, lostReason?: string, userId?: string): Promise<LeadDocument> {
    const update: any = { status };
    if (lostReason) update.lostReason = lostReason;
    const lead = await this.leadModel.findByIdAndUpdate(id, update, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(lead, userId);
    }

    return lead;
  }

  async assign(id: string, assignedTo: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      { assignedTo: new Types.ObjectId(assignedTo), status: LeadStatus.ASSIGNED },
      { new: true },
    );
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async addFollowup(id: string, createFollowupDto: CreateFollowupDto, userId: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');

    const followup = {
      ...createFollowupDto,
      _id: new Types.ObjectId(),
      createdBy: new Types.ObjectId(userId),
      createdAt: new Date(),
    };

    lead.followups.push(followup as any);
    if (createFollowupDto.nextAction) {
      lead.nextFollowup = new Date(createFollowupDto.date);
    }
    await lead.save();
    return this.findOne(id);
  }

  async addNote(id: string, text: string, userId: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');

    lead.notes.push({
      _id: new Types.ObjectId(),
      text,
      createdBy: new Types.ObjectId(userId),
      createdAt: new Date(),
    } as any);

    await lead.save();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.leadModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Lead not found');
  }

  async delete(id: string): Promise<void> {
    return this.remove(id);
  }

  async getStats(user?: any): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filter: any = {};
    if (user?.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }

    const [total, byStatus, todayFollowups] = await Promise.all([
      this.leadModel.countDocuments(filter),
      this.leadModel.aggregate([
        ...(filter.$or ? [{ $match: filter }] : []),
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.leadModel.countDocuments({
        ...filter,
        nextFollowup: {
          $gte: today,
          $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return { total, byStatus, todayFollowups };
  }

  async getTodayFollowups(user?: any): Promise<LeadDocument[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const filter: any = { nextFollowup: { $gte: today, $lt: tomorrow } };
    if (user?.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }

    return this.leadModel
      .find(filter)
      .populate('assignedTo', 'name email')
      .sort({ nextFollowup: 1 });
  }

  async importLeads(leadsArray: any[], userId: string, user?: any): Promise<{ importedCount: number; skippedCount: number; data: LeadDocument[] }> {
    if (!Array.isArray(leadsArray) || leadsArray.length === 0) {
      return { importedCount: 0, skippedCount: 0, data: [] };
    }

    const createdLeads: LeadDocument[] = [];
    let skippedCount = 0;
    const creatorId = new Types.ObjectId(userId);
    const processedPhones = new Set<string>();

    for (const raw of leadsArray) {
      if (!raw || (!raw.name && !raw.phone)) continue;

      const cleanPhone = sanitizePhone(raw.phone);
      const cleanEmail = raw.email ? String(raw.email).toLowerCase().trim() : undefined;

      // Validate 10 digit phone
      if (!cleanPhone || cleanPhone.length !== 10) {
        skippedCount++;
        continue;
      }

      // Check duplicates within batch
      if (processedPhones.has(cleanPhone)) {
        skippedCount++;
        continue;
      }

      // Check duplicates in DB with regex
      const phoneRegex = new RegExp(cleanPhone);
      const dupQuery: any[] = [{ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } }];
      if (cleanEmail) {
        dupQuery.push({ email: new RegExp(`^${cleanEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') });
      }

      const existingInDb = await this.leadModel.findOne({ $or: dupQuery });
      if (existingInDb) {
        skippedCount++;
        continue;
      }

      processedPhones.add(cleanPhone);

      const leadId = await this.generateLeadId();
      const name = String(raw.name || 'Imported Prospect').trim();
      const company = raw.company ? String(raw.company).trim() : undefined;
      const city = raw.city ? String(raw.city).trim() : undefined;
      const requirement = raw.requirement ? String(raw.requirement).trim() : undefined;
      const estimatedValue = Number(raw.estimatedValue) || 0;
      const cleanWhatsapp = raw.whatsapp ? sanitizePhone(raw.whatsapp) : cleanPhone;

      const validSources = Object.values(LeadSource);
      const rawSource = raw.source ? String(raw.source).toLowerCase().trim() : 'other';
      const source = validSources.includes(rawSource as any) ? rawSource : LeadSource.OTHER;

      const validStatuses = Object.values(LeadStatus);
      const rawStatus = raw.status ? String(raw.status).toLowerCase().trim() : 'new';
      let status = validStatuses.includes(rawStatus as any) ? rawStatus : LeadStatus.NEW;

      let assignedTo: Types.ObjectId | undefined = undefined;
      if (user?.role === 'sales') {
        assignedTo = creatorId;
        status = LeadStatus.ASSIGNED;
      } else if (raw.assignedTo && Types.ObjectId.isValid(raw.assignedTo)) {
        assignedTo = new Types.ObjectId(raw.assignedTo);
        status = LeadStatus.ASSIGNED;
      }

      const payload: any = {
        leadId,
        name,
        phone: cleanPhone,
        whatsapp: cleanWhatsapp,
        email: cleanEmail,
        company,
        city,
        requirement,
        source,
        status,
        estimatedValue,
        assignedTo,
        createdBy: creatorId,
        meetingMode: raw.meetingMode || 'online',
      };

      const lead = new this.leadModel(payload);
      const saved = await lead.save();

      if (saved.status === LeadStatus.WON) {
        await this.autoCreateClientFromWonLead(saved, userId);
      }

      createdLeads.push(saved);
    }

    return { importedCount: createdLeads.length, skippedCount, data: createdLeads };
  }

  async getUpcomingReminders(user: any) {
    const userObjId = Types.ObjectId.isValid(user._id?.toString()) ? new Types.ObjectId(user._id.toString()) : user._id;
    const roleLower = (user?.role || '').toLowerCase().trim();
    const isAdminOrManager = ['admin', 'management', 'super_admin', 'superadmin'].includes(roleLower);

    // Super Admin / Admin / Management never get popups (they only receive Notifications)
    if (isAdminOrManager) {
      return [];
    }

    // 3 minutes window before scheduled follow-up time:
    // Only fetch leads where nextFollowup is between (now - 30 mins) and (now + 3 mins)
    const now = Date.now();
    const windowStart = new Date(now - 30 * 60 * 1000); // 30 mins grace window for active shift
    const windowEnd = new Date(now + 3 * 60 * 1000);     // 3 mins pre-alarm window

    const query: any = {
      status: { $nin: ['won', 'lost'] },
      nextFollowup: { $gte: windowStart, $lte: windowEnd },
      $or: [
        { assignedTo: userObjId },
        { assignedTo: user._id.toString() },
        { createdBy: userObjId },
        { createdBy: user._id.toString() },
      ],
    };

    const leads = await this.leadModel
      .find(query)
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email')
      .sort({ nextFollowup: 1 })
      .lean();

    // Filter leads where lastReminderHandledAt is missing OR before nextFollowup
    const dueReminders = leads.filter((l: any) => {
      if (!l.nextFollowup) return false;
      if (!l.lastReminderHandledAt) return true;
      const followupTime = new Date(l.nextFollowup).getTime();
      const handledTime = new Date(l.lastReminderHandledAt).getTime();
      return handledTime < followupTime;
    });

    return dueReminders;
  }

  async logReminderOutcome(id: string, body: { note: string; nextFollowup?: string; status?: string }, user: any) {
    if (!body.note || !body.note.trim()) {
      throw new BadRequestException('Reminder outcome note is required');
    }

    const lead = await this.leadModel.findById(id);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const userObjId = Types.ObjectId.isValid(user._id?.toString()) ? new Types.ObjectId(user._id.toString()) : user._id;
    const authorName = user.name || user.email || 'Sales Executive';

    // 1. Push to followups history
    lead.followups.push({
      date: new Date(),
      type: 'call',
      summary: body.note.trim(),
      nextFollowup: body.nextFollowup ? new Date(body.nextFollowup) : undefined,
      createdByName: authorName,
      createdAt: new Date(),
    } as any);

    // 2. Push to notes array
    lead.notes.push({
      text: `[Reminder Outcome]: ${body.note.trim()}`,
      createdBy: userObjId,
      createdByName: authorName,
      createdAt: new Date(),
    } as any);

    // 3. Update nextFollowup & lastReminderHandledAt
    if (body.nextFollowup) {
      lead.nextFollowup = new Date(body.nextFollowup);
    }
    lead.lastReminderHandledAt = new Date();

    // 4. Update status if provided
    if (body.status && Object.values(LeadStatus).includes(body.status as LeadStatus)) {
      lead.status = body.status;
      if (body.status === LeadStatus.WON && !lead.isConverted) {
        await this.autoCreateClientFromWonLead(lead, user._id?.toString() || '');
      }
    }

    const updated = await lead.save();

    // 5. Send Real-Time Notifications to Super Admin & Admins
    try {
      const adminUsers = await this.userModel.find({
        role: { $in: ['admin', 'management', 'super_admin', 'superadmin'] },
        isActive: true,
      }).select('_id');

      for (const admin of adminUsers) {
        await this.notificationsService.create({
          userId: admin._id.toString(),
          title: `🔔 Reminder Note: ${updated.name}`,
          message: `${authorName} logged follow-up note for lead "${updated.name}": "${body.note.trim()}"`,
          type: 'lead',
          module: 'leads',
          referenceId: updated._id.toString(),
        });
      }
    } catch (notifErr) {
      console.error('Error sending reminder notifications to admins:', notifErr);
    }

    return updated;
  }
}
