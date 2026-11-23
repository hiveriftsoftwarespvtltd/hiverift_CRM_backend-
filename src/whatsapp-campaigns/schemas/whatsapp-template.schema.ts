import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappTemplateDocument = WhatsappTemplate & Document;

export enum TemplateCategory {
  MARKETING = 'MARKETING',
  UTILITY = 'UTILITY',
  AUTHENTICATION = 'AUTHENTICATION',
}

export enum TemplateStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
  DRAFT = 'DRAFT',
}

@Schema({ _id: false })
export class TemplateButton {
  @Prop({ required: true, enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] })
  type: string;

  @Prop({ required: true })
  text: string;

  @Prop()
  value?: string;
}

export const TemplateButtonSchema = SchemaFactory.createForClass(TemplateButton);

@Schema({ collection: 'whatsapp_templates', timestamps: true })
export class WhatsappTemplate {
  @Prop({ required: true, trim: true, unique: true })
  name: string; // e.g. "order_notification", "customer_welcome"

  @Prop({ required: true, trim: true })
  displayName: string;

  @Prop({ required: true, enum: Object.values(TemplateCategory), default: TemplateCategory.MARKETING })
  category: string;

  @Prop({ default: 'en', trim: true })
  language: string; // 'en', 'en_US', 'hi'

  @Prop({ default: 'NONE', enum: ['NONE', 'TEXT', 'IMAGE', 'DOCUMENT'] })
  headerType: string;

  @Prop({ trim: true })
  headerText?: string;

  @Prop({ required: true })
  body: string; // Message body with {{1}}, {{2}} variables

  @Prop({ trim: true })
  footer?: string;

  @Prop({ type: [TemplateButtonSchema], default: [] })
  buttons: TemplateButton[];

  @Prop({ type: [String], default: [] })
  variables: string[]; // ['name', 'company', 'service', etc.]

  @Prop({ default: TemplateStatus.APPROVED, enum: Object.values(TemplateStatus) })
  status: string;

  @Prop({ trim: true })
  metaTemplateId?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const WhatsappTemplateSchema = SchemaFactory.createForClass(WhatsappTemplate);
WhatsappTemplateSchema.index({ status: 1, isActive: 1 });
