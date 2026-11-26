import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as xlsx from 'xlsx';

import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AuditService } from '../../audit/audit.service';
import { getUserAccessScope } from '../whatsapp-permissions.util';
import {
  WhatsappImportedLead,
  WhatsappImportedLeadDocument,
} from '../schemas/whatsapp-imported-lead.schema';
import {
  WhatsappTemplate,
  WhatsappTemplateDocument,
} from '../schemas/whatsapp-template.schema';
import {
  WhatsappCampaign,
  WhatsappCampaignDocument,
  CampaignStatus,
  CampaignLeadSource,
} from '../schemas/whatsapp-campaign.schema';
import {
  WhatsappCampaignRecipient,
  WhatsappCampaignRecipientDocument,
  RecipientStatus,
} from '../schemas/whatsapp-campaign-recipient.schema';
import { CreateCampaignDto } from '../dto/campaign.dto';
import { WhatsappQueueService } from './whatsapp-queue.service';

@Injectable()
export class WhatsappCampaignsService {
  private readonly logger = new Logger(WhatsappCampaignsService.name);

  constructor(
    @InjectModel(WhatsappCampaign.name)
    private readonly campaignModel: Model<WhatsappCampaignDocument>,
    @InjectModel(WhatsappCampaignRecipient.name)
    private readonly recipientModel: Model<WhatsappCampaignRecipientDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(WhatsappImportedLead.name)
    private readonly importedLeadModel: Model<WhatsappImportedLeadDocument>,
    @InjectModel(WhatsappTemplate.name)
    private readonly templateModel: Model<WhatsappTemplateDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly queueService: WhatsappQueueService,
    private readonly auditService: AuditService,
  ) { }

  // ==========================================
  // HELPER: VALIDATE CAMPAIGN ACCESS
  // ==========================================
  private async validateCampaignAccess(
    id: string,
    user?: any,
    action = 'view',
  ): Promise<{ campaign: WhatsappCampaignDocument; scope: any }> {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid campaign ID');
    }
    const scope = getUserAccessScope(user);
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (scope.isSalesEmployee) {
      const isOwner =
        (campaign.createdBy && campaign.createdBy.toString() === scope.userId) ||
        (campaign.ownerId && campaign.ownerId.toString() === scope.userId);
      if (!isOwner) {
        await this.auditService.log({
          userId: scope.userId,
          action: 'unauthorized_campaign_access_attempt',
          module: 'whatsapp_campaigns',
          recordId: campaign.campaignId || id,
          description: `Sales employee ${scope.userName} attempted unauthorized ${action} on campaign ${campaign.campaignId || id}`,
        });
        throw new ForbiddenException(`You do not have permission to ${action} this campaign`);
      }
    }
    return { campaign, scope };
  }

  // ==========================================
  // 1. DASHBOARD STATS
  // ==========================================
  async getDashboardStats(user: any) {
    const scope = getUserAccessScope(user);

    if (scope.isSalesEmployee) {
      // ----------------------------------------------------
      // Sales Employee: STRICTLY PERSONAL METRICS ONLY
      // ----------------------------------------------------
      const myCampaigns = await this.campaignModel
        .find({ $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }] }, { _id: 1 })
        .lean();
      const myCampaignIds = myCampaigns.map((c) => c._id);

      const [
        myAssignedCrmLeads,
        myImportedLeads,
        myTotalCampaigns,
        recipientsSummary,
        recentCampaigns,
        recentRecipients,
      ] = await Promise.all([
        this.leadModel.countDocuments({
          $or: [{ assignedTo: scope.userObjId }, { assignedTo: scope.userId }],
        }),
        this.importedLeadModel.countDocuments({
          $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }],
        }),
        this.campaignModel.countDocuments({
          $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }],
        }),
        this.recipientModel.aggregate([
          {
            $match: {
              $or: [
                { campaignId: { $in: myCampaignIds } },
                { ownerId: scope.userObjId },
              ],
            },
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ]),
        this.campaignModel
          .find({ $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }] })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('templateId', 'displayName name')
          .lean(),
        this.recipientModel
          .find({
            $or: [
              { campaignId: { $in: myCampaignIds } },
              { ownerId: scope.userObjId },
            ],
            status: { $in: ['sent', 'delivered', 'read', 'failed'] },
          })
          .sort({ updatedAt: -1 })
          .limit(10)
          .populate('campaignId', 'name')
          .lean(),
      ]);

      const statusCounts: Record<string, number> = {
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
      };

      recipientsSummary.forEach((r) => {
        if (r._id && statusCounts[r._id] !== undefined) {
          statusCounts[r._id] = r.count;
        }
      });

      const totalProcessed = (statusCounts.sent || 0) + (statusCounts.delivered || 0) + (statusCounts.read || 0);
      const totalDelivered = (statusCounts.delivered || 0) + (statusCounts.read || 0);

      return {
        isSalesEmployee: true,
        scopeName: scope.userName,
        totalCrmLeads: myAssignedCrmLeads,
        totalImportedLeads: myImportedLeads,
        totalCampaigns: myTotalCampaigns,
        totalMessagesSent: totalProcessed,
        totalMessagesDelivered: totalDelivered,
        totalMessagesRead: statusCounts.read || 0,
        totalFailedMessages: statusCounts.failed || 0,
        totalPendingMessages: statusCounts.pending || 0,
        totalSkippedMessages: statusCounts.skipped || 0,
        recentCampaigns,
        recentActivity: recentRecipients,
      };
    }

    // ----------------------------------------------------
    // Sales Manager / Super Admin: TEAM-WIDE METRICS
    // ----------------------------------------------------
    const [
      totalCrmLeads,
      totalImportedLeads,
      totalCampaigns,
      recipientsSummary,
      recentCampaigns,
      recentRecipients,
      employeeCampaignCounts,
    ] = await Promise.all([
      this.leadModel.countDocuments(),
      this.importedLeadModel.countDocuments(),
      this.campaignModel.countDocuments(),
      this.recipientModel.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
      this.campaignModel
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('templateId', 'displayName name')
        .populate('createdBy', 'name email role')
        .lean(),
      this.recipientModel
        .find({ status: { $in: ['sent', 'delivered', 'read', 'failed'] } })
        .sort({ updatedAt: -1 })
        .limit(10)
        .populate('campaignId', 'name')
        .lean(),
      this.campaignModel.aggregate([
        {
          $group: {
            _id: '$createdBy',
            name: { $first: '$createdByName' },
            campaignCount: { $sum: 1 },
            totalRecipients: { $sum: '$totalRecipients' },
            sentCount: { $sum: '$sentCount' },
            deliveredCount: { $sum: '$deliveredCount' },
            failedCount: { $sum: '$failedCount' },
          },
        },
        { $sort: { campaignCount: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const statusCounts: Record<string, number> = {
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    };

    recipientsSummary.forEach((r) => {
      if (r._id && statusCounts[r._id] !== undefined) {
        statusCounts[r._id] = r.count;
      }
    });

    const totalProcessed = (statusCounts.sent || 0) + (statusCounts.delivered || 0) + (statusCounts.read || 0);
    const totalDelivered = (statusCounts.delivered || 0) + (statusCounts.read || 0);

    return {
      isSalesEmployee: false,
      isSalesHead: scope.isSalesHead,
      isSuperAdmin: scope.isSuperAdmin,
      totalCrmLeads,
      totalImportedLeads,
      totalCampaigns,
      totalMessagesSent: totalProcessed,
      totalMessagesDelivered: totalDelivered,
      totalMessagesRead: statusCounts.read || 0,
      totalFailedMessages: statusCounts.failed || 0,
      totalPendingMessages: statusCounts.pending || 0,
      totalSkippedMessages: statusCounts.skipped || 0,
      recentCampaigns,
      recentActivity: recentRecipients,
      employeeActivity: employeeCampaignCounts,
    };
  }

  // ==========================================
  // 2. CAMPAIGN CREATION WIZARD
  // ==========================================
  async createCampaign(dto: CreateCampaignDto, user: any) {
    const scope = getUserAccessScope(user);

    if (!dto.recipientIds || dto.recipientIds.length === 0) {
      throw new BadRequestException('Please select at least one lead for the campaign');
    }

    const template = await this.templateModel.findById(dto.templateId).lean();
    if (!template) {
      throw new NotFoundException('Selected WhatsApp template not found');
    }
    if (template.status !== 'APPROVED' || !template.metaTemplateId) {
      throw new BadRequestException(
        `Template "${template.displayName || template.name}" is not verified/approved in your Meta WhatsApp Business Account. Please click "Sync with Meta" and select a Meta-approved template.`,
      );
    }

    // Bulletproof unique campaign ID generation (safe against deleted campaigns & concurrent inserts)
    const monthPrefix = `CMP-${new Date().toISOString().slice(0, 7).replace('-', '')}-`;
    const lastCampaign = await this.campaignModel
      .findOne({ campaignId: { $regex: `^${monthPrefix}` } })
      .sort({ campaignId: -1 })
      .select('campaignId')
      .lean();

    let nextSeq = 1;
    if (lastCampaign?.campaignId) {
      const parts = lastCampaign.campaignId.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        nextSeq = lastNum + 1;
      }
    }

    let campaignId = `${monthPrefix}${String(nextSeq).padStart(4, '0')}`;
    while (await this.campaignModel.exists({ campaignId })) {
      nextSeq++;
      campaignId = `${monthPrefix}${String(nextSeq).padStart(4, '0')}`;
    }

    const delaySeconds = Math.max(1, dto.delaySeconds || 10);
    const isNow = !dto.scheduleType || dto.scheduleType === 'now';
    const status = isNow ? CampaignStatus.RUNNING : CampaignStatus.SCHEDULED;

    // Validate recipient IDs
    const validIds = dto.recipientIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (validIds.length === 0 || validIds.length !== dto.recipientIds.length) {
      throw new BadRequestException('One or more selected lead IDs are invalid');
    }

    // Populate Recipients with strict ownership validation
    const recipientsToInsert: any[] = [];

    if (dto.leadSource === CampaignLeadSource.CRM_LEADS) {
      const crmLeads = await this.leadModel
        .find({ _id: { $in: validIds } })
        .lean();

      if (crmLeads.length !== validIds.length) {
        throw new BadRequestException('One or more selected CRM leads could not be found');
      }

      // STRICT OWNERSHIP ENFORCEMENT: Sales Employee can only use their assigned CRM leads
      if (scope.isSalesEmployee) {
        const unauthorizedLead = crmLeads.find(
          (lead) =>
            !lead.assignedTo ||
            (lead.assignedTo.toString() !== scope.userId &&
              lead.assignedTo.toString() !== scope.userObjId.toString()),
        );

        if (unauthorizedLead) {
          await this.auditService.log({
            userId: scope.userId,
            action: 'unauthorized_crm_lead_campaign_attempt',
            module: 'whatsapp_campaigns',
            recordId: unauthorizedLead._id.toString(),
            description: `Sales employee ${scope.userName} attempted to create campaign with unauthorized CRM lead ${unauthorizedLead._id}`,
          });
          throw new ForbiddenException(
            'Security violation: You can only create campaigns for CRM leads assigned to you. Unauthorized leads were rejected.',
          );
        }
      }

      // Pre-create campaign document
      const campaign = new this.campaignModel({
        campaignId,
        name: dto.name,
        description: dto.description,
        type: dto.type || 'bulk_broadcast',
        leadSource: dto.leadSource,
        templateId: new Types.ObjectId(dto.templateId),
        templateSnapshot: template,
        variableMappings: dto.variableMappings || {},
        scheduleType: dto.scheduleType || 'now',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        delaySeconds,
        status,
        totalRecipients: dto.recipientIds.length,
        pendingCount: dto.recipientIds.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        skippedCount: 0,
        startedAt: isNow ? new Date() : undefined,
        createdBy: scope.userObjId,
        ownerId: scope.userObjId,
        createdByName: scope.userName,
        createdByRole: scope.userRole,
      });

      const savedCampaign = await campaign.save();

      for (const lead of crmLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'crm_lead',
          crmLeadId: lead._id,
          sourceType: 'crm_lead',
          sourceLeadId: lead._id,
          assignedEmployeeId: lead.assignedTo || undefined, // IMPORTANT: preserves original CRM lead assignment
          ownerId: scope.userObjId,
          name: lead.name,
          phoneNumber: lead.phone,
          email: lead.email,
          company: lead.company,
          status: RecipientStatus.PENDING,
          retryCount: 0,
          maxRetries: 2,
        });
      }

      await this.recipientModel.insertMany(recipientsToInsert);

      if (isNow) {
        this.queueService.enqueueCampaign(savedCampaign._id.toString());
      }

      await this.auditService.log({
        userId: scope.userId,
        action: 'create_campaign',
        module: 'whatsapp_campaigns',
        recordId: savedCampaign._id.toString(),
        description: `Created campaign ${savedCampaign.name} (${savedCampaign.campaignId}) with ${recipientsToInsert.length} CRM recipients`,
      });

      return savedCampaign;
    } else {
      // IMPORTED LEADS
      const importedLeads = await this.importedLeadModel
        .find({ _id: { $in: validIds } })
        .lean();

      if (importedLeads.length !== validIds.length) {
        throw new BadRequestException('One or more selected imported leads could not be found');
      }

      // STRICT OWNERSHIP ENFORCEMENT: Sales Employee can only use their owned/imported leads
      if (scope.isSalesEmployee) {
        const unauthorizedLead = importedLeads.find(
          (lead) =>
            lead.createdBy?.toString() !== scope.userId &&
            lead.ownerId?.toString() !== scope.userId,
        );

        if (unauthorizedLead) {
          await this.auditService.log({
            userId: scope.userId,
            action: 'unauthorized_imported_lead_campaign_attempt',
            module: 'whatsapp_campaigns',
            recordId: unauthorizedLead._id.toString(),
            description: `Sales employee ${scope.userName} attempted to create campaign with unauthorized imported lead ${unauthorizedLead._id}`,
          });
          throw new ForbiddenException(
            'Security violation: You can only create campaigns for WhatsApp leads imported by you. Unauthorized leads were rejected.',
          );
        }
      }

      const campaign = new this.campaignModel({
        campaignId,
        name: dto.name,
        description: dto.description,
        type: dto.type || 'bulk_broadcast',
        leadSource: dto.leadSource,
        templateId: new Types.ObjectId(dto.templateId),
        templateSnapshot: template,
        variableMappings: dto.variableMappings || {},
        scheduleType: dto.scheduleType || 'now',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        delaySeconds,
        status,
        totalRecipients: dto.recipientIds.length,
        pendingCount: dto.recipientIds.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        skippedCount: 0,
        startedAt: isNow ? new Date() : undefined,
        createdBy: scope.userObjId,
        ownerId: scope.userObjId,
        createdByName: scope.userName,
        createdByRole: scope.userRole,
      });

      const savedCampaign = await campaign.save();

      for (const lead of importedLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'imported_lead',
          importedLeadId: lead._id,
          sourceType: 'imported_lead',
          sourceLeadId: lead._id,
          assignedEmployeeId: lead.ownerId || lead.createdBy || undefined,
          ownerId: scope.userObjId,
          name: lead.name,
          phoneNumber: lead.phoneNumber,
          email: lead.email,
          company: lead.company,
          status: RecipientStatus.PENDING,
          retryCount: 0,
          maxRetries: 2,
        });
      }

      await this.recipientModel.insertMany(recipientsToInsert);

      if (isNow) {
        this.queueService.enqueueCampaign(savedCampaign._id.toString());
      }

      await this.auditService.log({
        userId: scope.userId,
        action: 'create_campaign',
        module: 'whatsapp_campaigns',
        recordId: savedCampaign._id.toString(),
        description: `Created campaign ${savedCampaign.name} (${savedCampaign.campaignId}) with ${recipientsToInsert.length} imported recipients`,
      });

      return savedCampaign;
    }
  }

  // ==========================================
  // 3. CAMPAIGNS LIST & DETAILS
  // ==========================================
  async findAllCampaigns(query: any, user: any) {
    const scope = getUserAccessScope(user);
    const { status, search, dateFilter, startDate, endDate, employeeId, page = 1, limit = 20 } = query;
    const andConditions: any[] = [];

    // Role-based campaign filtering:
    // Sales Employee can see ONLY their own campaigns
    if (scope.isSalesEmployee) {
      andConditions.push({
        $or: [
          { createdBy: scope.userObjId },
          { ownerId: scope.userObjId },
        ],
      });
    } else if (employeeId && employeeId !== 'all' && Types.ObjectId.isValid(employeeId)) {
      // Sales Head / Manager / Super Admin can filter by specific employee
      andConditions.push({
        $or: [
          { createdBy: new Types.ObjectId(employeeId) },
          { ownerId: new Types.ObjectId(employeeId) },
        ],
      });
    }

    if (status && status !== 'all') {
      andConditions.push({ status });
    }

    if (search) {
      andConditions.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { campaignId: { $regex: search, $options: 'i' } },
        ],
      });
    }

    // Date Filtering: today | yesterday | tomorrow | this_week | this_month | custom
    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      if (dateFilter === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const dateCond = { $gte: start, $lte: end };
        andConditions.push({
          $or: [{ createdAt: dateCond }, { scheduledAt: dateCond }],
        });
      } else if (dateFilter === 'yesterday') {
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        const start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
        const end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
        const dateCond = { $gte: start, $lte: end };
        andConditions.push({
          $or: [{ createdAt: dateCond }, { scheduledAt: dateCond }],
        });
      } else if (dateFilter === 'tomorrow') {
        const tom = new Date(now);
        tom.setDate(tom.getDate() + 1);
        const start = new Date(tom.getFullYear(), tom.getMonth(), tom.getDate(), 0, 0, 0, 0);
        const end = new Date(tom.getFullYear(), tom.getMonth(), tom.getDate(), 23, 59, 59, 999);
        const dateCond = { $gte: start, $lte: end };
        andConditions.push({
          $or: [{ scheduledAt: dateCond }, { createdAt: dateCond }],
        });
      } else if (dateFilter === 'this_week') {
        const curr = new Date(now);
        const first = curr.getDate() - curr.getDay() + (curr.getDay() === 0 ? -6 : 1);
        const start = new Date(curr.setDate(first));
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        andConditions.push({ createdAt: { $gte: start, $lte: end } });
      } else if (dateFilter === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        andConditions.push({ createdAt: { $gte: start, $lte: end } });
      } else if (dateFilter === 'custom' && (startDate || endDate)) {
        const dateCond: any = {};
        if (startDate) {
          const s = new Date(startDate);
          s.setHours(0, 0, 0, 0);
          dateCond.$gte = s;
        }
        if (endDate) {
          const e = new Date(endDate);
          e.setHours(23, 59, 59, 999);
          dateCond.$lte = e;
        }
        andConditions.push({ createdAt: dateCond });
      }
    } else if (startDate || endDate) {
      const dateCond: any = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateCond.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateCond.$lte = e;
      }
      andConditions.push({ createdAt: dateCond });
    }

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [campaigns, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .populate('templateId', 'displayName name category language')
        .populate('createdBy', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      this.campaignModel.countDocuments(filter),
    ]);

    return {
      campaigns,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async findOneCampaign(id: string, user?: any) {
    await this.validateCampaignAccess(id, user, 'view');
    const campaign = await this.campaignModel
      .findById(id)
      .populate('templateId')
      .populate('createdBy', 'name email role')
      .lean();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async deleteCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'delete');

    this.queueService.signalCampaignStop(id);
    await this.recipientModel.deleteMany({ campaignId: new Types.ObjectId(id) });
    await this.campaignModel.findByIdAndDelete(id);

    await this.auditService.log({
      userId: scope.userId,
      action: 'delete_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} (${campaign.campaignId}) deleted by ${scope.userName}`,
    });

    return { success: true, message: `Campaign '${campaign.name}' deleted successfully` };
  }

  // ==========================================
  // 4. CAMPAIGN CONTROLS (PAUSE / RESUME / STOP)
  // ==========================================
  async pauseCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'pause');

    if (campaign.status === CampaignStatus.COMPLETED) {
      return { success: true, message: 'Campaign is already completed', campaign };
    }

    if (campaign.status === CampaignStatus.PAUSED) {
      return { success: true, message: 'Campaign is already paused', campaign };
    }

    if (campaign.status !== CampaignStatus.RUNNING && campaign.status !== CampaignStatus.SCHEDULED) {
      throw new BadRequestException(`Cannot pause a campaign that is in '${campaign.status}' state`);
    }

    campaign.status = CampaignStatus.PAUSED;
    campaign.pausedAt = new Date();
    await campaign.save();

    this.queueService.signalCampaignStop(id);

    // Reset any in-flight processing recipient back to pending
    await this.recipientModel.updateMany(
      { campaignId: new Types.ObjectId(id), status: RecipientStatus.PROCESSING },
      { $set: { status: RecipientStatus.PENDING } },
    );

    await this.auditService.log({
      userId: scope.userId,
      action: 'pause_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} paused by ${scope.userName}`,
    });

    return { success: true, message: 'Campaign paused successfully', campaign };
  }

  async resumeCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'resume');

    if (campaign.status === CampaignStatus.COMPLETED) {
      return { success: true, message: 'Campaign is already completed', campaign };
    }

    if (campaign.status === CampaignStatus.RUNNING) {
      return { success: true, message: 'Campaign is already running', campaign };
    }

    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('Only paused campaigns can be resumed');
    }

    campaign.status = CampaignStatus.RUNNING;
    campaign.pausedAt = undefined;
    await campaign.save();

    this.queueService.enqueueCampaign(id);

    await this.auditService.log({
      userId: scope.userId,
      action: 'resume_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} resumed by ${scope.userName}`,
    });

    return { success: true, message: 'Campaign resumed successfully', campaign };
  }

  async stopCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'stop');

    if (campaign.status === CampaignStatus.COMPLETED || campaign.status === CampaignStatus.STOPPED) {
      return { success: true, message: `Campaign is already ${campaign.status}`, campaign };
    }

    campaign.status = CampaignStatus.STOPPED;
    campaign.completedAt = new Date();
    await campaign.save();

    this.queueService.signalCampaignStop(id);

    // Cancel remaining pending/processing recipients
    await this.recipientModel.updateMany(
      {
        campaignId: new Types.ObjectId(id),
        status: { $in: [RecipientStatus.PENDING, RecipientStatus.PROCESSING] },
      },
      {
        $set: { status: RecipientStatus.SKIPPED, errorMessage: `Campaign stopped by ${scope.userName}` },
      },
    );

    await this.auditService.log({
      userId: scope.userId,
      action: 'stop_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} stopped by ${scope.userName}`,
    });

    return { success: true, message: 'Campaign stopped successfully', campaign };
  }

  // ==========================================
  // 5. LIVE PROGRESS
  // ==========================================
  async getLiveProgress(id: string, user?: any) {
    const { campaign } = await this.validateCampaignAccess(id, user, 'view_progress');

    const total = campaign.totalRecipients || 0;
    const sent = campaign.sentCount || 0;
    const delivered = campaign.deliveredCount || 0;
    const read = campaign.readCount || 0;
    const failed = campaign.failedCount || 0;
    const pending = campaign.pendingCount || 0;
    const skipped = campaign.skippedCount || 0;

    const progressPercentage = total > 0 ? Math.round(((sent + failed + skipped) / total) * 100) : 0;

    return {
      campaignId: campaign.campaignId,
      name: campaign.name,
      status: campaign.status,
      delaySeconds: campaign.delaySeconds,
      total,
      sent,
      delivered,
      read,
      failed,
      pending,
      skipped,
      progressPercentage: Math.min(100, progressPercentage),
    };
  }

  // ==========================================
  // 6. CAMPAIGN REPORTS & SEPARATE LISTS
  // ==========================================
  async getReportRecipients(campaignId: string, status?: string, query?: any, user?: any) {
    await this.validateCampaignAccess(campaignId, user, 'view_report');

    const filter: any = { campaignId: new Types.ObjectId(campaignId) };

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (query?.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { phoneNumber: { $regex: query.search, $options: 'i' } },
        { company: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = Math.max(1, parseInt(query?.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query?.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [recipients, total] = await Promise.all([
      this.recipientModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.recipientModel.countDocuments(filter),
    ]);

    return {
      recipients,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportReportCsv(campaignId: string, status?: string, user?: any) {
    await this.validateCampaignAccess(campaignId, user, 'export_report');


    const filter: any = { campaignId: new Types.ObjectId(campaignId) };
    if (status && status !== 'all') {
      filter.status = status;
    }

    const recipients = await this.recipientModel.find(filter).sort({ createdAt: 1 }).lean();

    const rows = recipients.map((r) => ({
      Name: r.name,
      Phone: r.phoneNumber,
      Email: r.email || '',
      Company: r.company || '',
      Status: r.status.toUpperCase(),
      WhatsAppMessageId: r.whatsappMessageId || '',
      SentAt: r.sentAt ? new Date(r.sentAt).toLocaleString() : '',
      DeliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toLocaleString() : '',
      ReadAt: r.readAt ? new Date(r.readAt).toLocaleString() : '',
      FailedAt: r.failedAt ? new Date(r.failedAt).toLocaleString() : '',
      ErrorMessage: r.errorMessage || '',
    }));

    const worksheet = xlsx.utils.json_to_sheet(rows);
    return xlsx.utils.sheet_to_csv(worksheet);
  }

  // ==========================================
  // 7. WEBHOOK STATUS PROCESSING (SENT / DELIVERED / READ / FAILED)
  // ==========================================
  async handleWebhookStatus(wamid: string, status: string, timestamp?: string, errors?: any[]) {
    if (!wamid || !status) return;

    const recipient = await this.recipientModel.findOne({ whatsappMessageId: wamid });
    if (!recipient) return; // Might be a non-campaign lead message

    const oldStatus = recipient.status;
    const newStatus = status.toLowerCase();

    if (newStatus === 'delivered' && oldStatus !== 'delivered' && oldStatus !== 'read') {
      recipient.status = RecipientStatus.DELIVERED;
      recipient.deliveredAt = timestamp ? new Date(parseInt(timestamp, 10) * 1000) : new Date();
      await recipient.save();

      await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
        $inc: { deliveredCount: 1 },
      });
      this.logger.log(`WhatsApp Recipient [${recipient.phoneNumber}] marked DELIVERED`);
    } else if (newStatus === 'read' && oldStatus !== 'read') {
      recipient.status = RecipientStatus.READ;
      recipient.readAt = timestamp ? new Date(parseInt(timestamp, 10) * 1000) : new Date();
      if (!recipient.deliveredAt) recipient.deliveredAt = recipient.readAt;
      await recipient.save();

      const incObj: any = { readCount: 1 };
      if (oldStatus !== 'delivered') {
        incObj.deliveredCount = 1;
      }
      await this.campaignModel.findByIdAndUpdate(recipient.campaignId, { $inc: incObj });
      this.logger.log(`WhatsApp Recipient [${recipient.phoneNumber}] marked READ`);
    } else if (newStatus === 'failed' && oldStatus !== 'failed') {
      recipient.status = RecipientStatus.FAILED;
      recipient.failedAt = timestamp ? new Date(parseInt(timestamp, 10) * 1000) : new Date();
      if (errors && errors.length > 0) {
        recipient.errorMessage = errors[0]?.message || errors[0]?.title || 'Meta delivery failure';
        recipient.errorCode = String(errors[0]?.code || '');
      }
      await recipient.save();

      await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
        $inc: { failedCount: 1 },
      });
      this.logger.warn(`WhatsApp Recipient [${recipient.phoneNumber}] marked FAILED: ${recipient.errorMessage}`);
    }
  }
}
