import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as xlsx from 'xlsx';

import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AuditService } from '../../audit/audit.service';
import { getUserAccessScope } from '../whatsapp-permissions.util';
import { classifyMetaError } from '../meta-error-classifier.util';
import { MetaService } from '../../meta/meta.service';
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
import {
  WhatsappConversation,
  WhatsappConversationDocument,
} from '../schemas/whatsapp-conversation.schema';
import {
  WhatsappInboxMessage,
  WhatsappInboxMessageDocument,
  InboxMessageDirection,
} from '../schemas/whatsapp-inbox-message.schema';
import {
  WhatsappOptout,
  WhatsappOptoutDocument,
} from '../schemas/whatsapp-optout.schema';
import { CreateCampaignDto } from '../dto/campaign.dto';
import { WhatsappQueueService } from './whatsapp-queue.service';
import { WhatsappOptoutService } from './whatsapp-optout.service';

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
    @InjectModel(WhatsappConversation.name)
    private readonly conversationModel: Model<WhatsappConversationDocument>,
    @InjectModel(WhatsappInboxMessage.name)
    private readonly inboxMessageModel: Model<WhatsappInboxMessageDocument>,
    @InjectModel(WhatsappOptout.name)
    private readonly optoutModel: Model<WhatsappOptoutDocument>,
    private readonly queueService: WhatsappQueueService,
    private readonly auditService: AuditService,
    @Optional() private readonly optoutService?: WhatsappOptoutService,
    @Optional() @Inject(forwardRef(() => MetaService)) private readonly metaService?: MetaService,
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

      const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const [
        runningCampaigns,
        scheduledCampaigns,
        completedCampaigns,
        activeConversations,
        unsubscribedContacts,
        recentReplies,
        recentFailedMessages,
        dailyRaw,
      ] = await Promise.all([
        this.campaignModel.countDocuments({
          $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }],
          status: CampaignStatus.RUNNING,
        }),
        this.campaignModel.countDocuments({
          $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }],
          status: CampaignStatus.SCHEDULED,
        }),
        this.campaignModel.countDocuments({
          $or: [{ createdBy: scope.userObjId }, { ownerId: scope.userObjId }],
          status: CampaignStatus.COMPLETED,
        }),
        this.conversationModel.countDocuments({
          $or: [{ assignedEmployeeId: scope.userObjId }, { ownerId: scope.userObjId }],
        }),
        this.optoutModel.countDocuments({ isActive: true }),
        this.inboxMessageModel
          .find({ direction: InboxMessageDirection.INCOMING })
          .sort({ timestamp: -1 })
          .limit(5)
          .populate('conversationId', 'contactName phoneNumber')
          .lean(),
        this.recipientModel
          .find({
            $or: [{ campaignId: { $in: myCampaignIds } }, { ownerId: scope.userObjId }],
            status: 'failed',
          })
          .sort({ failedAt: -1, updatedAt: -1 })
          .limit(5)
          .populate('campaignId', 'name')
          .lean(),
        this.recipientModel.aggregate([
          {
            $match: {
              $or: [{ campaignId: { $in: myCampaignIds } }, { ownerId: scope.userObjId }],
              createdAt: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      return {
        isSalesEmployee: true,
        scopeName: scope.userName,
        totalCrmLeads: myAssignedCrmLeads,
        totalImportedLeads: myImportedLeads,
        totalCampaigns: myTotalCampaigns,
        runningCampaigns,
        scheduledCampaigns,
        completedCampaigns,
        activeConversations,
        unsubscribedContacts,
        totalMessagesSent: totalProcessed,
        totalMessagesDelivered: totalDelivered,
        totalMessagesRead: statusCounts.read || 0,
        totalFailedMessages: statusCounts.failed || 0,
        totalPendingMessages: statusCounts.pending || 0,
        totalSkippedMessages: statusCounts.skipped || 0,
        recentCampaigns,
        recentActivity: recentRecipients,
        recentReplies,
        recentFailedMessages,
        dailyChart: this.buildSevenDayChart(dailyRaw),
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

    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [
      runningCampaigns,
      scheduledCampaigns,
      completedCampaigns,
      activeConversations,
      unsubscribedContacts,
      recentReplies,
      recentFailedMessages,
      dailyRaw,
    ] = await Promise.all([
      this.campaignModel.countDocuments({ status: CampaignStatus.RUNNING }),
      this.campaignModel.countDocuments({ status: CampaignStatus.SCHEDULED }),
      this.campaignModel.countDocuments({ status: CampaignStatus.COMPLETED }),
      this.conversationModel.countDocuments(),
      this.optoutModel.countDocuments({ isActive: true }),
      this.inboxMessageModel
        .find({ direction: InboxMessageDirection.INCOMING })
        .sort({ timestamp: -1 })
        .limit(5)
        .populate('conversationId', 'contactName phoneNumber')
        .lean(),
      this.recipientModel
        .find({ status: 'failed' })
        .sort({ failedAt: -1, updatedAt: -1 })
        .limit(5)
        .populate('campaignId', 'name')
        .lean(),
      this.recipientModel.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    return {
      isSalesEmployee: false,
      isSalesHead: scope.isSalesHead,
      isSuperAdmin: scope.isSuperAdmin,
      totalCrmLeads,
      totalImportedLeads,
      totalCampaigns,
      runningCampaigns,
      scheduledCampaigns,
      completedCampaigns,
      activeConversations,
      unsubscribedContacts,
      totalMessagesSent: totalProcessed,
      totalMessagesDelivered: totalDelivered,
      totalMessagesRead: statusCounts.read || 0,
      totalFailedMessages: statusCounts.failed || 0,
      totalPendingMessages: statusCounts.pending || 0,
      totalSkippedMessages: statusCounts.skipped || 0,
      recentCampaigns,
      recentActivity: recentRecipients,
      employeeActivity: employeeCampaignCounts,
      recentReplies,
      recentFailedMessages,
      dailyChart: this.buildSevenDayChart(dailyRaw),
    };
  }

  private buildSevenDayChart(dailyRaw: any[]) {
    const map: Record<string, { date: string; label: string; sent: number; delivered: number; read: number; failed: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      map[key] = {
        date: key,
        label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
      };
    }
    for (const row of dailyRaw || []) {
      const day = row?._id?.day;
      const st = row?._id?.status;
      if (!day || !map[day]) continue;
      if (st === 'sent') map[day].sent += row.count;
      else if (st === 'delivered') {
        map[day].sent += row.count;
        map[day].delivered += row.count;
      } else if (st === 'read') {
        map[day].sent += row.count;
        map[day].delivered += row.count;
        map[day].read += row.count;
      } else if (st === 'failed') {
        map[day].failed += row.count;
      }
    }
    return Object.values(map);
  }

  private async generateCampaignCode(): Promise<string> {
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
    return campaignId;
  }

  // ==========================================
  // 2. CAMPAIGN CREATION WIZARD
  // ==========================================
  async createCampaign(dto: CreateCampaignDto, user: any) {
    const scope = getUserAccessScope(user);

    if (!dto.recipientIds || dto.recipientIds.length === 0) {
      throw new BadRequestException('Please select at least one lead for the campaign');
    }
    if (dto.recipientIds.length > 5000) {
      throw new BadRequestException('Maximum 5,000 recipients are allowed per campaign batch');
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

    const campaignId = await this.generateCampaignCode();

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

    // Populate Recipients with strict ownership, opt-out & duplicate validation
    const recipientsToInsert: any[] = [];
    const suppressedSet = this.optoutService ? await this.optoutService.getOptedOutPhoneSet() : new Set<string>();
    const normalizePhone = (p?: string) => {
      const d = String(p || '').replace(/\D/g, '');
      if (d.length === 12 && d.startsWith('91')) return d.slice(2);
      if (d.length === 11 && d.startsWith('0')) return d.slice(1);
      return d.length > 10 ? d.slice(-10) : d;
    };

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

      const seenPhones = new Set<string>();
      const eligibleCrmLeads = crmLeads.filter((lead) => {
        const ph = normalizePhone(lead.whatsapp || lead.phone);
        if (!ph || ph.length < 7 || ph === '0000000000') return false;
        if (suppressedSet.has(ph) || seenPhones.has(ph)) return false;
        seenPhones.add(ph);
        return true;
      });

      if (eligibleCrmLeads.length === 0) {
        throw new BadRequestException(
          'No eligible recipients remaining after excluding invalid, duplicate, or opted-out phone numbers.',
        );
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
        totalRecipients: eligibleCrmLeads.length,
        pendingCount: eligibleCrmLeads.length,
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

      for (const lead of eligibleCrmLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'crm_lead',
          crmLeadId: lead._id,
          sourceType: 'crm_lead',
          sourceLeadId: lead._id,
          assignedEmployeeId: lead.assignedTo || undefined, // IMPORTANT: preserves original CRM lead assignment
          ownerId: scope.userObjId,
          name: lead.name,
          phoneNumber: normalizePhone(lead.whatsapp || lead.phone),
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

      const seenPhones = new Set<string>();
      const eligibleImportedLeads = importedLeads.filter((lead) => {
        if (lead.status === 'unsubscribed' || lead.whatsappOptIn === false) return false;
        const ph = normalizePhone(lead.phoneNumber);
        if (!ph || ph.length < 7) return false;
        if (suppressedSet.has(ph) || seenPhones.has(ph)) return false;
        seenPhones.add(ph);
        return true;
      });

      if (eligibleImportedLeads.length === 0) {
        throw new BadRequestException(
          'No eligible recipients remaining after excluding unsubscribed/opted-out, invalid, or duplicate contacts.',
        );
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
        totalRecipients: eligibleImportedLeads.length,
        pendingCount: eligibleImportedLeads.length,
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

      for (const lead of eligibleImportedLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'imported_lead',
          importedLeadId: lead._id,
          sourceType: 'imported_lead',
          sourceLeadId: lead._id,
          assignedEmployeeId: lead.ownerId || lead.createdBy || undefined,
          ownerId: scope.userObjId,
          name: lead.name,
          phoneNumber: normalizePhone(lead.phoneNumber),
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

    if (query?.templateId && query.templateId !== 'all' && Types.ObjectId.isValid(query.templateId)) {
      andConditions.push({ templateId: new Types.ObjectId(query.templateId) });
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
  // 4. CAMPAIGN CONTROLS (PAUSE / RESUME / STOP / RESCHEDULE)
  // ==========================================
  async pauseCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'pause');

    if (campaign.status === CampaignStatus.COMPLETED) {
      return { success: true, message: 'Campaign is already completed', campaign };
    }

    if (campaign.status === CampaignStatus.PAUSED) {
      return { success: true, message: 'Campaign is already paused', campaign };
    }

    if (
      campaign.status !== CampaignStatus.RUNNING &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      throw new BadRequestException(`Cannot pause a campaign that is in '${campaign.status}' state`);
    }

    campaign.status = CampaignStatus.PAUSED;
    campaign.pausedAt = new Date();
    await campaign.save();

    this.queueService.signalCampaignStop(id);

    // Reset any in-flight processing recipient back to pending so resume continues cleanly
    await this.recipientModel.updateMany(
      { campaignId: new Types.ObjectId(id), status: RecipientStatus.PROCESSING },
      { $set: { status: RecipientStatus.PENDING } },
    );

    const pendingRemaining = await this.recipientModel.countDocuments({
      campaignId: campaign._id,
      status: RecipientStatus.PENDING,
    });

    await this.auditService.log({
      userId: scope.userId,
      action: 'pause_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} paused by ${scope.userName} (${pendingRemaining} pending)`,
    });

    return {
      success: true,
      message: `Campaign paused at ${pendingRemaining} remaining recipient(s). Resume anytime to continue from this exact point.`,
      campaign,
    };
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

    // Ensure any orphaned PROCESSING recipients are PENDING and verify remaining count
    await this.recipientModel.updateMany(
      { campaignId: campaign._id, status: RecipientStatus.PROCESSING },
      { $set: { status: RecipientStatus.PENDING } },
    );
    const pendingRemaining = await this.recipientModel.countDocuments({
      campaignId: campaign._id,
      status: RecipientStatus.PENDING,
    });

    if (pendingRemaining === 0) {
      campaign.status = CampaignStatus.COMPLETED;
      campaign.completedAt = new Date();
      campaign.pausedAt = undefined;
      campaign.pendingCount = 0;
      await campaign.save();
      return {
        success: true,
        message: 'No pending recipients left. Campaign marked Completed.',
        campaign,
      };
    }

    campaign.status = CampaignStatus.RUNNING;
    campaign.pausedAt = undefined;
    campaign.startedAt = campaign.startedAt || new Date();
    campaign.pendingCount = pendingRemaining;
    await campaign.save();

    this.queueService.enqueueCampaign(id);

    await this.auditService.log({
      userId: scope.userId,
      action: 'resume_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} resumed by ${scope.userName} (${pendingRemaining} remaining)`,
    });

    return {
      success: true,
      message: `Campaign resumed from pause point (${pendingRemaining} remaining recipients queued).`,
      campaign,
    };
  }

  async stopCampaign(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'stop');

    if (campaign.status === CampaignStatus.COMPLETED || campaign.status === CampaignStatus.STOPPED) {
      return { success: true, message: `Campaign is already ${campaign.status}`, campaign };
    }

    this.queueService.signalCampaignStop(id);

    // Cancel remaining pending/processing recipients
    const cancelRes = await this.recipientModel.updateMany(
      {
        campaignId: new Types.ObjectId(id),
        status: { $in: [RecipientStatus.PENDING, RecipientStatus.PROCESSING] },
      },
      {
        $set: { status: RecipientStatus.SKIPPED, errorMessage: `Campaign stopped by ${scope.userName}` },
      },
    );

    campaign.status = CampaignStatus.STOPPED;
    campaign.completedAt = new Date();
    campaign.pendingCount = 0;
    campaign.skippedCount = (campaign.skippedCount || 0) + (cancelRes.modifiedCount || 0);
    await campaign.save();

    await this.auditService.log({
      userId: scope.userId,
      action: 'stop_campaign',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Campaign ${campaign.name} stopped by ${scope.userName}`,
    });

    return { success: true, message: 'Campaign stopped successfully', campaign };
  }

  async rescheduleCampaign(
    id: string,
    dto: {
      scheduleType?: 'now' | 'scheduled';
      scheduledAt?: string;
      name?: string;
      targetMode?: 'all' | 'unsent_or_failed';
      delaySeconds?: number;
    },
    user?: any,
  ) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'reschedule');

    const scheduleType = dto.scheduleType === 'now' ? 'now' : 'scheduled';
    const isNow = scheduleType === 'now';
    let parsedScheduleDate: Date | undefined;

    if (!isNow) {
      if (!dto.scheduledAt) {
        throw new BadRequestException('Please select a date and time to schedule the campaign');
      }
      parsedScheduleDate = new Date(dto.scheduledAt);
      if (isNaN(parsedScheduleDate.getTime())) {
        throw new BadRequestException('Invalid scheduled date/time');
      }
    }

    const targetMode = dto.targetMode === 'unsent_or_failed' ? 'unsent_or_failed' : 'all';
    const delaySeconds = Math.max(1, Number(dto.delaySeconds) || campaign.delaySeconds || 10);

    // If campaign hasn't run yet (SCHEDULED) and targeting all recipients, update schedule in place
    if (campaign.status === CampaignStatus.SCHEDULED && targetMode === 'all') {
      if (dto.name?.trim()) campaign.name = dto.name.trim();
      campaign.delaySeconds = delaySeconds;
      campaign.scheduleType = scheduleType;
      campaign.scheduledAt = isNow ? undefined : parsedScheduleDate;
      if (isNow) {
        campaign.status = CampaignStatus.RUNNING;
        campaign.startedAt = new Date();
      }
      await campaign.save();

      if (isNow) {
        this.queueService.enqueueCampaign(campaign._id.toString());
      }

      await this.auditService.log({
        userId: scope.userId,
        action: 'reschedule_campaign',
        module: 'whatsapp_campaigns',
        recordId: id,
        description: `Scheduled campaign ${campaign.name} updated by ${scope.userName}`,
      });

      return {
        success: true,
        mode: 'updated',
        message: isNow
          ? 'Scheduled campaign launched immediately!'
          : `Campaign schedule updated to ${parsedScheduleDate?.toLocaleString()}.`,
        data: campaign,
      };
    }

    // For completed / stopped / failed (or subset targets), create a clean rescheduled batch preserving past history
    const recipientQuery: any = { campaignId: campaign._id };
    if (targetMode === 'unsent_or_failed') {
      recipientQuery.status = {
        $in: [RecipientStatus.FAILED, RecipientStatus.SKIPPED, RecipientStatus.PENDING],
      };
    }

    const sourceRecipients = await this.recipientModel.find(recipientQuery).lean();
    if (!sourceRecipients || sourceRecipients.length === 0) {
      throw new BadRequestException(
        targetMode === 'unsent_or_failed'
          ? 'No failed or skipped recipients found in this campaign to reschedule.'
          : 'No recipients found in the original campaign.',
      );
    }

    // Verify template is still available & Meta-approved
    const freshTemplate = campaign.templateId
      ? await this.templateModel.findById(campaign.templateId).lean()
      : null;
    const templateSnapshot = freshTemplate || campaign.templateSnapshot;
    if (!templateSnapshot || templateSnapshot.status !== 'APPROVED') {
      throw new BadRequestException(
        'Cannot reschedule: the campaign template is missing or no longer APPROVED on Meta.',
      );
    }

    // Exclude currently opted-out numbers and deduplicate
    const suppressedSet = this.optoutService
      ? await this.optoutService.getOptedOutPhoneSet()
      : new Set<string>();
    const seenPhones = new Set<string>();
    const eligibleRecipients = sourceRecipients.filter((rec) => {
      const digits = String(rec.phoneNumber || '').replace(/\D/g, '');
      const normalized = digits.length > 10 ? digits.slice(-10) : digits;
      if (!normalized || normalized.length < 7 || normalized === '0000000000') return false;
      if (suppressedSet.has(normalized) || suppressedSet.has(rec.phoneNumber) || seenPhones.has(normalized)) {
        return false;
      }
      seenPhones.add(normalized);
      return true;
    });

    if (eligibleRecipients.length === 0) {
      throw new BadRequestException(
        'No eligible recipients remaining after excluding opted-out / invalid numbers.',
      );
    }

    const newCampaignCode = await this.generateCampaignCode();
    const newName =
      dto.name?.trim() ||
      `${campaign.name.replace(/\s*\(Rescheduled.*\)$/i, '')} (Rescheduled)`;

    const newCampaign = await new this.campaignModel({
      campaignId: newCampaignCode,
      name: newName,
      description: campaign.description,
      type: campaign.type || 'bulk_broadcast',
      leadSource: campaign.leadSource,
      templateId: campaign.templateId,
      templateSnapshot,
      variableMappings: campaign.variableMappings || {},
      scheduleType,
      scheduledAt: parsedScheduleDate,
      delaySeconds,
      status: isNow ? CampaignStatus.RUNNING : CampaignStatus.SCHEDULED,
      totalRecipients: eligibleRecipients.length,
      pendingCount: eligibleRecipients.length,
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
    }).save();

    const recipientDocs = eligibleRecipients.map((rec) => ({
      campaignId: newCampaign._id,
      recipientSource: rec.recipientSource,
      crmLeadId: rec.crmLeadId,
      importedLeadId: rec.importedLeadId,
      sourceType: rec.sourceType,
      sourceLeadId: rec.sourceLeadId,
      assignedEmployeeId: rec.assignedEmployeeId,
      ownerId: scope.userObjId,
      name: rec.name,
      phoneNumber: rec.phoneNumber,
      email: rec.email,
      company: rec.company,
      status: RecipientStatus.PENDING,
      retryCount: 0,
      maxRetries: 2,
    }));

    await this.recipientModel.insertMany(recipientDocs);

    if (isNow) {
      this.queueService.enqueueCampaign(newCampaign._id.toString());
    }

    await this.auditService.log({
      userId: scope.userId,
      action: 'reschedule_campaign',
      module: 'whatsapp_campaigns',
      recordId: newCampaign._id.toString(),
      description: `Rescheduled from ${campaign.campaignId} -> ${newCampaign.campaignId} (${eligibleRecipients.length} recipients) by ${scope.userName}`,
    });

    return {
      success: true,
      mode: 'cloned',
      message: isNow
        ? `Campaign re-launched now (${newCampaignCode}) with ${eligibleRecipients.length} eligible recipients!`
        : `Campaign rescheduled as ${newCampaignCode} for ${parsedScheduleDate?.toLocaleString()} (${eligibleRecipients.length} recipients).`,
      data: newCampaign,
    };
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

  async exportReportExcel(campaignId: string, status?: string, user?: any): Promise<Buffer> {
    await this.validateCampaignAccess(campaignId, user, 'export_report');

    const filter: any = { campaignId: new Types.ObjectId(campaignId) };
    if (status && status !== 'all') {
      filter.status = status;
    }

    const recipients = await this.recipientModel.find(filter).sort({ createdAt: 1 }).lean();
    const rows = recipients.map((r: any) => {
      const classified = r.status === 'failed' ? classifyMetaError(r.errorCode, r.errorMessage) : null;
      return {
        Name: r.name,
        Phone: r.phoneNumber,
        Email: r.email || '',
        Company: r.company || '',
        Status: r.status.toUpperCase(),
        WhatsAppMessageId: r.whatsappMessageId || '',
        ErrorCode: r.errorCode || '',
        ErrorCategory: classified?.label || '',
        ErrorMessage: r.errorMessage || '',
        Recommendation: classified?.recommendation || '',
        SentAt: r.sentAt ? new Date(r.sentAt).toLocaleString() : '',
        DeliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toLocaleString() : '',
        ReadAt: r.readAt ? new Date(r.readAt).toLocaleString() : '',
        FailedAt: r.failedAt ? new Date(r.failedAt).toLocaleString() : '',
      };
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Campaign Report');
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /**
   * Safely retry only transient/technical failures (never retries #131049, #131026, #132000, #132001, #190, or opt-outs)
   */
  async retryFailedRecipients(id: string, user?: any) {
    const { campaign, scope } = await this.validateCampaignAccess(id, user, 'retry_failed');
    const permanentCodes = ['131049', '131026', '132000', '132001', '132018', '100', '190', '131042'];

    const failedRecipients = await this.recipientModel
      .find({
        campaignId: new Types.ObjectId(id),
        status: RecipientStatus.FAILED,
        errorCode: { $nin: permanentCodes },
      })
      .lean();

    const suppressedSet = this.optoutService ? await this.optoutService.getOptedOutPhoneSet() : new Set<string>();
    const eligibleIds = failedRecipients
      .filter((r) => {
        const cls = classifyMetaError(r.errorCode, r.errorMessage);
        const norm = String(r.phoneNumber || '').replace(/\D/g, '').slice(-10);
        return cls.retryable && !suppressedSet.has(norm);
      })
      .map((r) => r._id);

    if (eligibleIds.length === 0) {
      return {
        success: false,
        retriedCount: 0,
        message: 'No eligible transient failed messages found to retry (permanent/policy failures like #131049 or #131026 are excluded).',
      };
    }

    await this.recipientModel.updateMany(
      { _id: { $in: eligibleIds } },
      {
        $set: {
          status: RecipientStatus.PENDING,
          retryCount: 0,
          nextRetryAt: null,
          errorMessage: undefined,
          errorCode: undefined,
          errorCategory: undefined,
        },
      },
    );

    campaign.status = CampaignStatus.RUNNING;
    campaign.failedCount = Math.max(0, (campaign.failedCount || 0) - eligibleIds.length);
    campaign.pendingCount = (campaign.pendingCount || 0) + eligibleIds.length;
    await campaign.save();

    this.queueService.enqueueCampaign(id);

    await this.auditService.log({
      userId: scope.userId,
      action: 'retry_failed_campaign_recipients',
      module: 'whatsapp_campaigns',
      recordId: id,
      description: `Re-queued ${eligibleIds.length} eligible transient failed recipients for campaign ${campaign.name}`,
    });

    return {
      success: true,
      retriedCount: eligibleIds.length,
      message: `Re-queued ${eligibleIds.length} eligible failed message(s) for retry.`,
    };
  }

  /**
   * Quick test-campaign dispatch for 1-5 opted-in test recipients
   */
  async sendTestCampaign(
    dto: { phoneNumbers: string[]; templateId: string; variableMappings?: Record<string, string> },
    user: any,
  ) {
    if (!this.metaService) {
      throw new BadRequestException('Meta Cloud API service unavailable');
    }
    const phones = (dto.phoneNumbers || [])
      .map((p) => String(p || '').replace(/\D/g, '').slice(-10))
      .filter((p) => p.length === 10);

    if (phones.length === 0 || phones.length > 5) {
      throw new BadRequestException('Provide between 1 and 5 valid 10-digit test phone numbers');
    }

    const template: any = await this.templateModel.findById(dto.templateId).lean();
    if (!template || template.status !== 'APPROVED') {
      throw new BadRequestException('Selected template must be Meta APPROVED');
    }

    const suppressedSet = this.optoutService ? await this.optoutService.getOptedOutPhoneSet(phones) : new Set<string>();
    const bodyText = template.body || '';
    const varMatches = Array.from(new Set(bodyText.match(/\{\{(\d+)\}\}/g) || []));
    const params: string[] = [];
    for (let i = 1; i <= varMatches.length; i++) {
      const mapped = dto.variableMappings?.[String(i)];
      params.push(mapped && mapped !== 'name' ? mapped : 'Test User');
    }

    const results: Array<{ phone: string; success: boolean; wamid?: string; error?: string }> = [];
    for (const phone of phones) {
      if (suppressedSet.has(phone)) {
        results.push({ phone, success: false, error: 'Skipped: Contact opted out / unsubscribed' });
        continue;
      }
      const res = await this.metaService.sendWhatsAppTemplateMessage(
        phone,
        template.name,
        params,
        template.language || 'en',
      );
      results.push({
        phone,
        success: res.success,
        wamid: res.whatsappMessageId,
        error: res.error,
      });
    }

    return { success: true, results };
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
      recipient.errorCategory = classifyMetaError(recipient.errorCode, recipient.errorMessage).category;
      await recipient.save();

      await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
        $inc: { failedCount: 1 },
      });
      this.logger.warn(`WhatsApp Recipient [${recipient.phoneNumber}] marked FAILED: ${recipient.errorMessage}`);
    }
  }
}
