import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappConversationDocument = WhatsappConversation & Document;

export enum ConversationSourceType {
  CRM_LEAD = 'crm_lead',
  IMPORTED_LEAD = 'imported_lead',
  DIRECT_WHATSAPP = 'direct_whatsapp',
}

export enum ConversationStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  CLOSED = 'closed',
}

@Schema({ timestamps: true, collection: 'whatsapp_conversations' })
export class WhatsappConversation {
  @Prop({ required: true, index: true, trim: true })
  phoneNumber: string; // Normalized 10-digit or E.164 phone

  @Prop({ trim: true, default: 'WhatsApp Contact' })
  contactName: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead', default: null, index: true })
  crmLeadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WhatsappImportedLead', default: null, index: true })
  importedLeadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerId?: Types.ObjectId; // Original lead owner / creator

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  assignedEmployeeId?: Types.ObjectId; // Current conversation assignee

  @Prop({
    type: String,
    enum: Object.values(ConversationSourceType),
    default: ConversationSourceType.DIRECT_WHATSAPP,
    index: true,
  })
  sourceType: ConversationSourceType;

  @Prop({ trim: true, default: '' })
  lastMessage: string;

  @Prop({ type: Date, default: Date.now, index: true })
  lastMessageAt: Date;

  @Prop({ type: String, enum: ['incoming', 'outgoing'], default: 'incoming' })
  lastMessageDirection: string;

  @Prop({ type: Number, default: 0 })
  unreadCount: number;

  @Prop({
    type: String,
    enum: Object.values(ConversationStatus),
    default: ConversationStatus.ACTIVE,
    index: true,
  })
  status: ConversationStatus;

  // 24-hour Customer Service Window Tracking
  @Prop({ type: Date, default: null })
  lastCustomerMessageAt?: Date;

  @Prop({ type: Date, default: null, index: true })
  windowExpiresAt?: Date; // 24 hours from lastCustomerMessageAt

  // Campaign context
  @Prop({ type: Types.ObjectId, ref: 'WhatsappCampaign', default: null })
  lastCampaignId?: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  lastCampaignName?: string;

  @Prop({ trim: true, default: '' })
  lastTemplateName?: string;

  @Prop({ type: [Object], default: [] })
  notes: Array<{
    _id?: Types.ObjectId;
    authorName?: string;
    text: string;
    createdAt?: Date;
  }>;
}

export const WhatsappConversationSchema = SchemaFactory.createForClass(WhatsappConversation);

WhatsappConversationSchema.index({ assignedEmployeeId: 1, lastMessageAt: -1 });
WhatsappConversationSchema.index({ unreadCount: -1, lastMessageAt: -1 });
