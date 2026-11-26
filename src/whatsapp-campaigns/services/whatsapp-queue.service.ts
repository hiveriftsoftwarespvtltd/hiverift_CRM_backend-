import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WhatsappCampaign,
  WhatsappCampaignDocument,
  CampaignStatus,
} from '../schemas/whatsapp-campaign.schema';
import {
  WhatsappCampaignRecipient,
  WhatsappCampaignRecipientDocument,
  RecipientStatus,
} from '../schemas/whatsapp-campaign-recipient.schema';
import { MetaService } from '../../meta/meta.service';
import { WhatsappInboxService } from './whatsapp-inbox.service';

@Injectable()
export class WhatsappQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappQueueService.name);
  private isProcessing = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private activeCampaignTasks = new Map<string, boolean>(); // campaignId -> isRunning

  constructor(
    @InjectModel(WhatsappCampaign.name)
    private readonly campaignModel: Model<WhatsappCampaignDocument>,
    @InjectModel(WhatsappCampaignRecipient.name)
    private readonly recipientModel: Model<WhatsappCampaignRecipientDocument>,
    private readonly metaService: MetaService,
    private readonly whatsappInboxService: WhatsappInboxService,
  ) {}

  onModuleInit() {
    this.logger.log('Starting WhatsApp Queue Worker heartbeat...');
    // Check every 5 seconds for scheduled or running campaigns
    this.intervalTimer = setInterval(() => this.processNextBatch(), 5000);
  }

  onModuleDestroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
  }

  /**
   * Enqueue or resume a campaign immediately
   */
  async enqueueCampaign(campaignId: string) {
    this.logger.log(`Queueing WhatsApp Campaign: ${campaignId}`);
    try {
      // Reset any orphaned PROCESSING recipients back to PENDING so they are dispatched cleanly
      await this.recipientModel.updateMany(
        { campaignId: new Types.ObjectId(campaignId), status: RecipientStatus.PROCESSING },
        { $set: { status: RecipientStatus.PENDING } },
      );
    } catch (e: any) {
      this.logger.warn(`Could not reset processing recipients for ${campaignId}: ${e?.message}`);
    }
    // Start processing in background without blocking caller
    setImmediate(() => this.processCampaign(campaignId));
  }

  /**
   * Stops an active campaign loop
   */
  signalCampaignStop(campaignId: string) {
    this.activeCampaignTasks.set(campaignId, false);
  }

  private async processNextBatch() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Check scheduled campaigns ready to run
      const now = new Date();
      const scheduledCampaigns = await this.campaignModel.find({
        status: CampaignStatus.SCHEDULED,
        scheduledAt: { $lte: now },
      });

      for (const camp of scheduledCampaigns) {
        camp.status = CampaignStatus.RUNNING;
        camp.startedAt = new Date();
        await camp.save();
        this.enqueueCampaign(camp._id.toString());
      }

      // 2. Check running campaigns that may have stalled (e.g. server restart)
      const runningCampaigns = await this.campaignModel.find({
        status: CampaignStatus.RUNNING,
      });

      for (const camp of runningCampaigns) {
        const campId = camp._id.toString();
        if (!this.activeCampaignTasks.get(campId)) {
          this.enqueueCampaign(campId);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in WhatsApp queue heartbeat: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Sequential background processor for an individual campaign
   */
  async processCampaign(campaignIdStr: string) {
    if (this.activeCampaignTasks.get(campaignIdStr)) {
      return; // Already being processed
    }

    this.activeCampaignTasks.set(campaignIdStr, true);
    this.logger.log(`Worker starting execution for Campaign: ${campaignIdStr}`);

    try {
      const campaignId = new Types.ObjectId(campaignIdStr);

      while (this.activeCampaignTasks.get(campaignIdStr)) {
        // Reload fresh campaign state
        const campaign = await this.campaignModel.findById(campaignId);
        if (!campaign) break;

        // If paused, stopped, or completed, break out
        if (campaign.status === CampaignStatus.PAUSED || campaign.status === CampaignStatus.STOPPED) {
          this.logger.log(`Campaign ${campaignIdStr} is ${campaign.status}. Pausing execution.`);
          break;
        }

        // Fetch the next pending recipient atomically
        const recipient: any = await this.recipientModel.findOneAndUpdate(
          {
            campaignId,
            status: RecipientStatus.PENDING,
          },
          {
            $set: { status: RecipientStatus.PROCESSING },
          },
          { new: true, sort: { createdAt: 1 } },
        );

        if (!recipient) {
          // Check if any recipients are still in processing or if everything is done
          const remainingPending = await this.recipientModel.countDocuments({
            campaignId,
            status: { $in: [RecipientStatus.PENDING, RecipientStatus.PROCESSING] },
          });

          if (remainingPending === 0) {
            this.logger.log(`All recipients processed for Campaign: ${campaignIdStr}. Marking COMPLETED.`);
            campaign.status = CampaignStatus.COMPLETED;
            campaign.completedAt = new Date();
            await campaign.save();
          }
          break;
        }

        // Process message sending
        await this.dispatchRecipientMessage(campaign, recipient);

        // Configurable delay interval (e.g. 10s, 30s, 60s)
        const delayMs = Math.max(1000, (campaign.delaySeconds || 10) * 1000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err: any) {
      this.logger.error(`Exception during Campaign ${campaignIdStr} processing: ${err.message}`);
    } finally {
      this.activeCampaignTasks.delete(campaignIdStr);
    }
  }

  /**
   * Dispatches the WhatsApp message for a single recipient
   */
  private async dispatchRecipientMessage(
    campaign: WhatsappCampaignDocument,
    recipient: WhatsappCampaignRecipientDocument,
  ) {
    try {
      const template = campaign.templateSnapshot;
      const mappings = campaign.variableMappings || {};

      // Detect exactly how many body variables {{1}}, {{2}} are in the template
      const bodyText = template?.body || '';
      const varMatches = Array.from(new Set(bodyText.match(/\{\{(\d+)\}\}/g) || []));
      const expectedVarCount = varMatches.length;

      // Prepare template parameters strictly matching template placeholder count
      const params: string[] = [];
      if (expectedVarCount > 0) {
        for (let i = 1; i <= expectedVarCount; i++) {
          const field = mappings[String(i)] || mappings[i];
          let val = '';
          if (field === 'name') val = recipient.name || '';
          else if (field === 'company') val = recipient.company || '';
          else if (field === 'email') val = recipient.email || '';
          else if (field === 'phoneNumber') val = recipient.phoneNumber || '';
          else if (field) val = (recipient as any)[field] || '';
          else val = recipient.name || 'Customer';
          const sanitizedVal = String(val || '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/ {2,}/g, ' ')
            .trim();
          params.push(sanitizedVal || 'Customer');
        }
      }

      // Build dynamic URL button components if template has {{1}} in button URL
      const extraComponents: any[] = [];
      if (Array.isArray(template?.buttons)) {
        template.buttons.forEach((btn: any, idx: number) => {
          if (btn?.type === 'URL' && typeof btn?.value === 'string' && /\{\{\d+\}\}/.test(btn.value)) {
            extraComponents.push({
              type: 'button',
              sub_type: 'url',
              index: String(idx),
              parameters: [{ type: 'text', text: 'services' }],
            });
          }
        });
      }

      // If template snapshot exists, render text preview for storage
      let renderedText = bodyText || 'Hello from HiveRift';
      params.forEach((param, idx) => {
        renderedText = renderedText.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), param);
      });
      recipient.renderedMessage = renderedText;

      // Send via Meta WhatsApp Cloud API
      const templateName = template?.name;
      if (!templateName) {
        throw new Error('Campaign template snapshot is missing template name');
      }
      const lang = template?.language || 'en';

      this.logger.log(
        `Sending Campaign [${campaign.name}] message to ${recipient.phoneNumber} (${recipient.name})...`,
      );

      const result = await this.metaService.sendWhatsAppTemplateMessage(
        recipient.phoneNumber,
        templateName,
        params,
        lang,
        extraComponents,
      );

      if (result.success && result.whatsappMessageId) {
        // Mark as SENT (Official Meta standard: SENT until webhook reports DELIVERED or READ)
        recipient.status = RecipientStatus.SENT;
        recipient.whatsappMessageId = result.whatsappMessageId;
        recipient.sentAt = new Date();
        recipient.errorMessage = undefined;
        recipient.errorCode = undefined;
        await recipient.save();

        // Update campaign counters atomically
        await this.campaignModel.findByIdAndUpdate(campaign._id, {
          $inc: { sentCount: 1, pendingCount: -1 },
        });

        // Record outgoing campaign message in WhatsApp Inbox thread
        await this.whatsappInboxService.recordCampaignMessage({
          recipientPhone: recipient.phoneNumber,
          recipientName: recipient.name,
          whatsappMessageId: result.whatsappMessageId,
          renderedMessage: recipient.renderedMessage || renderedText,
          campaignId: campaign._id,
          campaignName: campaign.name,
          templateName,
          templateParameters: params,
          sentBy: campaign.createdBy,
          crmLeadId: recipient.crmLeadId || (recipient.recipientSource === 'crm_lead' ? recipient.sourceLeadId : undefined),
          importedLeadId: recipient.importedLeadId || (recipient.recipientSource === 'imported_lead' ? recipient.sourceLeadId : undefined),
        });
      } else {
        const nonRetryableCodes = [132001, 132000, 190];
        const isPermanentFailure =
          (result.errorCode && nonRetryableCodes.includes(result.errorCode)) ||
          (result.error && result.error.includes('does not exist in the translation'));

        // Check retry
        recipient.retryCount = isPermanentFailure
          ? (recipient.maxRetries || 2)
          : (recipient.retryCount || 0) + 1;
        recipient.errorMessage = result.error || 'Failed to dispatch WhatsApp message';
        if (result.errorCode) {
          recipient.errorCode = String(result.errorCode);
        }

        if (recipient.retryCount < (recipient.maxRetries || 2)) {
          // Re-queue for next attempt
          recipient.status = RecipientStatus.PENDING;
          await recipient.save();
          this.logger.warn(
            `Message failed for ${recipient.phoneNumber}. Retry ${recipient.retryCount}/${recipient.maxRetries}.`,
          );
        } else {
          recipient.status = RecipientStatus.FAILED;
          recipient.failedAt = new Date();
          await recipient.save();

          await this.campaignModel.findByIdAndUpdate(campaign._id, {
            $inc: { failedCount: 1, pendingCount: -1 },
          });
          this.logger.error(
            `Message permanently failed for ${recipient.phoneNumber}: ${recipient.errorMessage}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error sending message to ${recipient.phoneNumber}: ${err.message}`);
      recipient.status = RecipientStatus.FAILED;
      recipient.errorMessage = err.message;
      recipient.failedAt = new Date();
      await recipient.save();

      await this.campaignModel.findByIdAndUpdate(campaign._id, {
        $inc: { failedCount: 1, pendingCount: -1 },
      });
    }
  }
}
