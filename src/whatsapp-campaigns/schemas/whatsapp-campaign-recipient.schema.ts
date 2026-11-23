import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappCampaignRecipientDocument = WhatsappCampaignRecipient & Document;

export enum RecipientStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Schema({ collection: 'whatsapp_campaign_recipients', timestamps: true })
export class WhatsappCampaignRecipient {
  @Prop({ type: Types.ObjectId, ref: 'WhatsappCampaign', required: true, index: true })
  campaignId: Types.ObjectId;

  @Prop({ required: true, enum: ['crm_lead', 'imported_lead'] })
  recipientSource: string;

  @Prop({ type: String })
  sourceType?: string; // 'crm_lead' | 'imported_lead'

  @Prop({ type: Types.ObjectId, index: true })
  sourceLeadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead', index: true })
  crmLeadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WhatsappImportedLead', index: true })
  importedLeadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedEmployeeId?: Types.ObjectId; // Lead assignee (for CRM lead) or importer

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  ownerId?: Types.ObjectId; // Campaign creator/owner

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, index: true })
  phoneNumber: string;

  @Prop({ trim: true })
  email?: string;

  @Prop({ trim: true })
  company?: string;

  @Prop()
  renderedMessage?: string;

  @Prop({ index: true })
  whatsappMessageId?: string; // wamid from Meta Cloud API

  @Prop({ default: RecipientStatus.PENDING, enum: Object.values(RecipientStatus), index: true })
  status: string;

  @Prop({ type: Date })
  scheduledFor?: Date;

  @Prop({ type: Date })
  sentAt?: Date;

  @Prop({ type: Date })
  deliveredAt?: Date;

  @Prop({ type: Date })
  readAt?: Date;

  @Prop({ type: Date })
  failedAt?: Date;

  @Prop({ trim: true })
  errorMessage?: string;

  @Prop({ trim: true })
  errorCode?: string;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: 2 })
  maxRetries: number;
}

export const WhatsappCampaignRecipientSchema = SchemaFactory.createForClass(WhatsappCampaignRecipient);
WhatsappCampaignRecipientSchema.index({ campaignId: 1, status: 1 });
WhatsappCampaignRecipientSchema.index({ whatsappMessageId: 1 });
WhatsappCampaignRecipientSchema.index({ assignedEmployeeId: 1 });
WhatsappCampaignRecipientSchema.index({ ownerId: 1 });
