import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappCampaignDocument = WhatsappCampaign & Document;

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  FAILED = 'failed',
}

export enum CampaignLeadSource {
  CRM_LEADS = 'crm_leads',
  IMPORTED_LEADS = 'imported_leads',
  MIXED = 'mixed',
}

@Schema({ collection: 'whatsapp_campaigns', timestamps: true })
export class WhatsappCampaign {
  @Prop({ required: true, unique: true, index: true })
  campaignId: string; // e.g. CMP-202611-0001

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: 'bulk_broadcast', enum: ['bulk_broadcast', 'promotional', 'follow_up'] })
  type: string;

  @Prop({ required: true, enum: Object.values(CampaignLeadSource), default: CampaignLeadSource.CRM_LEADS })
  leadSource: string;

  @Prop({ type: Types.ObjectId, ref: 'WhatsappTemplate', required: true })
  templateId: Types.ObjectId;

  @Prop({ type: Object })
  templateSnapshot: any; // Frozen snapshot of template at campaign creation

  @Prop({ type: Object, default: {} })
  variableMappings: Record<string, string>; // { "1": "name", "2": "company" }

  @Prop({ default: 'now', enum: ['now', 'scheduled'] })
  scheduleType: string;

  @Prop({ type: Date })
  scheduledAt?: Date;

  @Prop({ default: 10 })
  delaySeconds: number; // Configurable interval: 10s, 30s, 60s, 120s, custom

  @Prop({ default: CampaignStatus.DRAFT, enum: Object.values(CampaignStatus), index: true })
  status: string;

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 0 })
  deliveredCount: number;

  @Prop({ default: 0 })
  readCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ default: 0 })
  pendingCount: number;

  @Prop({ default: 0 })
  skippedCount: number;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  pausedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  ownerId?: Types.ObjectId; // Campaign owner

  @Prop({ trim: true })
  createdByName?: string;

  @Prop({ trim: true, default: 'sales' })
  createdByRole?: string;
}

export const WhatsappCampaignSchema = SchemaFactory.createForClass(WhatsappCampaign);
WhatsappCampaignSchema.index({ status: 1, createdAt: -1 });
WhatsappCampaignSchema.index({ createdBy: 1, createdAt: -1 });
WhatsappCampaignSchema.index({ ownerId: 1, createdAt: -1 });
