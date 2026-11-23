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

import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { LeadsModule } from '../leads/leads.module';
import { MetaModule } from '../meta/meta.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { WhatsappCampaignsController } from './whatsapp-campaigns.controller';
import { WhatsappLeadsService } from './services/whatsapp-leads.service';
import { WhatsappTemplatesService } from './services/whatsapp-templates.service';
import { WhatsappCampaignsService } from './services/whatsapp-campaigns.service';
import { WhatsappQueueService } from './services/whatsapp-queue.service';
import { WhatsappSettingsService } from './services/whatsapp-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappImportedLead.name, schema: WhatsappImportedLeadSchema },
      { name: WhatsappImportBatch.name, schema: WhatsappImportBatchSchema },
      { name: WhatsappTemplate.name, schema: WhatsappTemplateSchema },
      { name: WhatsappCampaign.name, schema: WhatsappCampaignSchema },
      { name: WhatsappCampaignRecipient.name, schema: WhatsappCampaignRecipientSchema },
      { name: WhatsappSetting.name, schema: WhatsappSettingSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    forwardRef(() => LeadsModule),
    MetaModule,
    NotificationsModule,
  ],
  controllers: [WhatsappCampaignsController],
  providers: [
    WhatsappLeadsService,
    WhatsappTemplatesService,
    WhatsappCampaignsService,
    WhatsappQueueService,
    WhatsappSettingsService,
  ],
  exports: [
    WhatsappCampaignsService,
    WhatsappLeadsService,
    WhatsappTemplatesService,
  ],
})
export class WhatsappCampaignsModule {}
