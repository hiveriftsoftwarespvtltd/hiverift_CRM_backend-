import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappInboxMessageDocument = WhatsappInboxMessage & Document;

export enum InboxMessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export enum InboxMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  AUDIO = 'audio',
  VIDEO = 'video',
  LOCATION = 'location',
  CONTACTS = 'contacts',
  INTERACTIVE = 'interactive',
  TEMPLATE = 'template',
  BUTTON = 'button',
}

export enum InboxMessageStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
  INCOMING = 'incoming',
}

@Schema({ timestamps: true, collection: 'whatsapp_inbox_messages' })
export class WhatsappInboxMessage {
  @Prop({ type: Types.ObjectId, ref: 'WhatsappConversation', required: true, index: true })
  conversationId: Types.ObjectId;

  @Prop({ type: String, unique: true, sparse: true, index: true, trim: true })
  whatsappMessageId?: string; // e.g. wamid.HBg...

  @Prop({
    type: String,
    enum: Object.values(InboxMessageDirection),
    required: true,
    index: true,
  })
  direction: InboxMessageDirection;

  @Prop({
    type: String,
    enum: Object.values(InboxMessageType),
    default: InboxMessageType.TEXT,
  })
  messageType: InboxMessageType;

  @Prop({ trim: true, default: '' })
  messageContent: string;

  @Prop({ trim: true, default: '' })
  mediaId?: string;

  @Prop({ trim: true, default: '' })
  mediaUrl?: string;

  @Prop({ trim: true, default: '' })
  fileName?: string;

  @Prop({ trim: true, default: '' })
  mimeType?: string;

  @Prop({ trim: true, default: '' })
  senderPhone: string;

  @Prop({ trim: true, default: '' })
  recipientPhone: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  sentBy?: Types.ObjectId; // Employee who sent this reply

  @Prop({ trim: true, default: '' })
  sentByName?: string;

  // Campaign context
  @Prop({ type: Types.ObjectId, ref: 'WhatsappCampaign', default: null, index: true })
  campaignId?: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  campaignName?: string;

  @Prop({ type: Types.ObjectId, ref: 'WhatsappTemplate', default: null })
  templateId?: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  templateName?: string;

  @Prop({ type: [String], default: [] })
  templateParameters?: string[];

  @Prop({
    type: String,
    enum: Object.values(InboxMessageStatus),
    default: InboxMessageStatus.SENT,
    index: true,
  })
  status: InboxMessageStatus;

  @Prop({ type: Date, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ type: Date, default: null })
  deliveredAt?: Date;

  @Prop({ type: Date, default: null })
  readAt?: Date;

  @Prop({ type: Date, default: null })
  failedAt?: Date;

  @Prop({ trim: true, default: '' })
  errorMessage?: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean; // For CRM inbox unread tracking

  @Prop({ type: Object, default: {} })
  webhookMetadata?: Record<string, any>;
}

export const WhatsappInboxMessageSchema = SchemaFactory.createForClass(WhatsappInboxMessage);

WhatsappInboxMessageSchema.index({ conversationId: 1, timestamp: -1 });
WhatsappInboxMessageSchema.index({ conversationId: 1, isRead: 1 });
