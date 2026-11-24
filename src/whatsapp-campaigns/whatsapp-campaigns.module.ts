import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WhatsappImportedLead,
  WhatsappImportedLeadSchema,
} from './schemas/whatsapp-imported-lead.schema';
import {
  WhatsappImportBatch,
  WhatsappImportBatchSchema,
} from './schemas/whatsapp-import-batch.schema';
import {
  WhatsappTemplate,
  WhatsappTemplateSchema,
} from './schemas/whatsapp-template.schema';
import {
  WhatsappCampaign,
  WhatsappCampaignSchema,
} from './schemas/whatsapp-campaign.schema';
import {
  WhatsappCampaignRecipient,
  WhatsappCampaignRecipientSchema,
} from './schemas/whatsapp-campaign-recipient.schema';
import {
  WhatsappSetting,
  WhatsappSettingSchema,
} from './schemas/whatsapp-setting.schema';
import {
  WhatsappConversation,
  WhatsappConversationSchema,
} from './schemas/whatsapp-conversation.schema';
import {
  WhatsappInboxMessage,
  WhatsappInboxMessageSchema,
} from './schemas/whatsapp-inbox-message.schema';
import {
  WhatsappWebhookEvent,
  WhatsappWebhookEventSchema,
} from './schemas/whatsapp-webhook-event.schema';

import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LeadsModule } from '../leads/leads.module';
import { MetaModule } from '../meta/meta.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

import { WhatsappCampaignsController } from './whatsapp-campaigns.controller';
import { WhatsappInboxController } from './whatsapp-inbox.controller';
import { WhatsappLeadsService } from './services/whatsapp-leads.service';
import { WhatsappTemplatesService } from './services/whatsapp-templates.service';
import { WhatsappCampaignsService } from './services/whatsapp-campaigns.service';
import { WhatsappQueueService } from './services/whatsapp-queue.service';
import { WhatsappSettingsService } from './services/whatsapp-settings.service';
import { WhatsappInboxService } from './services/whatsapp-inbox.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappImportedLead.name, schema: WhatsappImportedLeadSchema },
      { name: WhatsappImportBatch.name, schema: WhatsappImportBatchSchema },
      { name: WhatsappTemplate.name, schema: WhatsappTemplateSchema },
      { name: WhatsappCampaign.name, schema: WhatsappCampaignSchema },
      { name: WhatsappCampaignRecipient.name, schema: WhatsappCampaignRecipientSchema },
      { name: WhatsappSetting.name, schema: WhatsappSettingSchema },
      { name: WhatsappConversation.name, schema: WhatsappConversationSchema },
      { name: WhatsappInboxMessage.name, schema: WhatsappInboxMessageSchema },
      { name: WhatsappWebhookEvent.name, schema: WhatsappWebhookEventSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => LeadsModule),
    MetaModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [WhatsappCampaignsController, WhatsappInboxController],
  providers: [
    WhatsappLeadsService,
    WhatsappTemplatesService,
    WhatsappCampaignsService,
    WhatsappQueueService,
    WhatsappSettingsService,
    WhatsappInboxService,
  ],
  exports: [
    WhatsappCampaignsService,
    WhatsappLeadsService,
    WhatsappTemplatesService,
    WhatsappInboxService,
  ],
})
export class WhatsappCampaignsModule {}
