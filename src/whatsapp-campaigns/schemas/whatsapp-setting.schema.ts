import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappSettingDocument = WhatsappSetting & Document;

@Schema({ collection: 'whatsapp_settings', timestamps: true })
export class WhatsappSetting {
  @Prop({ trim: true, default: '' })
  wabaId: string; // WhatsApp Business Account ID

  @Prop({ trim: true, default: '' })
  phoneNumberId: string; // Phone Number ID

  @Prop({ trim: true, default: '' })
  businessAccountId: string;

  @Prop({ trim: true, default: '' })
  accessToken: string;

  @Prop({ trim: true, default: 'hivecrm_webhook_2026_secure' })
  webhookVerifyToken: string;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ type: Date })
  lastTestedAt?: Date;

  @Prop({ trim: true, default: 'v20.0' })
  apiVersion?: string;

  @Prop({ trim: true, default: '91' })
  defaultCountryCode?: string;

  @Prop({ type: Number, default: 10 })
  defaultDelaySeconds?: number;

  @Prop({ trim: true, default: '' })
  metaAppId?: string;

  @Prop({ trim: true, default: '' })
  lastQualityRating?: string;

  @Prop({ trim: true, default: '' })
  lastMessagingLimit?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const WhatsappSettingSchema = SchemaFactory.createForClass(WhatsappSetting);
