import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as xlsx from 'xlsx';

import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
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
    private readonly queueService: WhatsappQueueService,
  ) {}

  // ==========================================
  // 1. DASHBOARD STATS
  // ==========================================
  async getDashboardStats() {
    const [
      totalCrmLeads,
      totalImportedLeads,
      totalCampaigns,
      recipientsSummary,
      recentCampaigns,
      recentRecipients,
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
        .lean(),
      this.recipientModel
        .find({ status: { $in: ['sent', 'delivered', 'read', 'failed'] } })
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
    };
  }

  // ==========================================
  // 2. CAMPAIGN CREATION WIZARD
  // ==========================================
  async createCampaign(dto: CreateCampaignDto, user: any) {
    if (!dto.recipientIds || dto.recipientIds.length === 0) {
      throw new BadRequestException('Please select at least one lead for the campaign');
    }

    const template = await this.templateModel.findById(dto.templateId).lean();
    if (!template) {
      throw new NotFoundException('Selected WhatsApp template not found');
    }

    const count = await this.campaignModel.countDocuments();
    const campaignId = `CMP-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(count + 1).padStart(4, '0')}`;

    const delaySeconds = Math.max(5, dto.delaySeconds || 10);
    const isNow = !dto.scheduleType || dto.scheduleType === 'now';
    const status = isNow ? CampaignStatus.RUNNING : CampaignStatus.SCHEDULED;

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
      createdBy: user?._id ? new Types.ObjectId(user._id) : undefined,
      createdByName: user?.name || 'Super Admin',
    });

    const savedCampaign = await campaign.save();

    // Populate Recipients
    const recipientsToInsert: any[] = [];

    if (dto.leadSource === CampaignLeadSource.CRM_LEADS) {
      const crmLeads = await this.leadModel
        .find({ _id: { $in: dto.recipientIds.map((id) => new Types.ObjectId(id)) } })
        .lean();

      for (const lead of crmLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'crm_lead',
          crmLeadId: lead._id,
          name: lead.name,
          phoneNumber: lead.phone,
          email: lead.email,
          company: lead.company,
          status: RecipientStatus.PENDING,
          retryCount: 0,
          maxRetries: 2,
        });
      }
    } else {
      const importedLeads = await this.importedLeadModel
        .find({ _id: { $in: dto.recipientIds.map((id) => new Types.ObjectId(id)) } })
        .lean();

      for (const lead of importedLeads) {
        recipientsToInsert.push({
          campaignId: savedCampaign._id,
          recipientSource: 'imported_lead',
          importedLeadId: lead._id,
          name: lead.name,
          phoneNumber: lead.phoneNumber,
          email: lead.email,
          company: lead.company,
          status: RecipientStatus.PENDING,
          retryCount: 0,
          maxRetries: 2,
        });
      }
    }

    if (recipientsToInsert.length > 0) {
      await this.recipientModel.insertMany(recipientsToInsert);
    }

    // Trigger queue worker if starting now
    if (isNow) {
      this.queueService.enqueueCampaign(savedCampaign._id.toString());
    }

    return savedCampaign;
  }

  // ==========================================
  // 3. CAMPAIGNS LIST & DETAILS
  // ==========================================
  async findAllCampaigns(query: any) {
    const { status, search, page = 1, limit = 20 } = query;
    const filter: any = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { campaignId: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [campaigns, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .populate('templateId', 'displayName name')
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

  async findOneCampaign(id: string) {
    const campaign = await this.campaignModel
      .findById(id)
      .populate('templateId')
      .lean();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  // ==========================================
  // 4. CAMPAIGN CONTROLS (PAUSE / RESUME / STOP)
  // ==========================================
  async pauseCampaign(id: string) {
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status !== CampaignStatus.RUNNING && campaign.status !== CampaignStatus.SCHEDULED) {
      throw new BadRequestException(`Cannot pause a campaign that is in '${campaign.status}' state`);
    }

    campaign.status = CampaignStatus.PAUSED;
    campaign.pausedAt = new Date();
    await campaign.save();

    this.queueService.signalCampaignStop(id);
    return { success: true, message: 'Campaign paused successfully', campaign };
  }

  async resumeCampaign(id: string) {
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('Only paused campaigns can be resumed');
    }

    campaign.status = CampaignStatus.RUNNING;
    campaign.pausedAt = undefined;
    await campaign.save();

    this.queueService.enqueueCampaign(id);
    return { success: true, message: 'Campaign resumed successfully', campaign };
  }

  async stopCampaign(id: string) {
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) throw new NotFoundException('Campaign not found');

    campaign.status = CampaignStatus.STOPPED;
    campaign.completedAt = new Date();
    await campaign.save();

    this.queueService.signalCampaignStop(id);
    return { success: true, message: 'Campaign stopped successfully', campaign };
  }

  // ==========================================
  // 5. LIVE PROGRESS
  // ==========================================
  async getLiveProgress(id: string) {
    const campaign = await this.campaignModel.findById(id).lean();
    if (!campaign) throw new NotFoundException('Campaign not found');

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
  async getReportRecipients(campaignId: string, status?: string, query?: any) {
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

  async exportReportCsv(campaignId: string, status?: string) {
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
