import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappOptoutDocument = WhatsappOptout & Document;

@Schema({ collection: 'whatsapp_optouts', timestamps: true })
export class WhatsappOptout {
  @Prop({ required: true, unique: true, trim: true, index: true })
  phoneNumber: string; // Normalized 10-digit phone

  @Prop({ trim: true, default: '' })
  contactName: string;

  @Prop({
    default: 'whatsapp_reply',
    enum: ['whatsapp_reply', 'manual_admin', 'campaign_bounce'],
  })
  source: string;

  @Prop({ trim: true, default: 'stop' })
  reason: string; // 'stop' | 'unsubscribe' | 'not_interested' | 'manual'

  @Prop({ trim: true, default: '' })
  triggerMessage?: string;

  @Prop({ default: true, index: true })
  isActive: boolean; // true = currently suppressed/opted out

  @Prop({ type: Date, default: Date.now })
  optedOutAt: Date;

  @Prop({ type: Date })
  reSubscribedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reSubscribedBy?: Types.ObjectId;

  @Prop({ trim: true })
  reSubscribedByName?: string;

  @Prop({ trim: true })
  reSubscribedReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const WhatsappOptoutSchema = SchemaFactory.createForClass(WhatsappOptout);
WhatsappOptoutSchema.index({ isActive: 1, optedOutAt: -1 });
