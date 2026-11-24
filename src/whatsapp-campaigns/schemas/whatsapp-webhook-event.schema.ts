import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WhatsappWebhookEventDocument = WhatsappWebhookEvent & Document;

@Schema({ timestamps: true, collection: 'whatsapp_webhook_events' })
export class WhatsappWebhookEvent {
  @Prop({ type: String, required: true, unique: true, index: true })
  eventId: string; // e.g. messageId or timestamp-event hash

  @Prop({ type: String, index: true, trim: true })
  whatsappMessageId?: string;

  @Prop({ type: String, required: true, enum: ['message', 'status'] })
  eventType: string;

  @Prop({ type: Boolean, default: false })
  processed: boolean;

  @Prop({ type: Date, default: Date.now })
  receivedAt: Date;

  @Prop({ type: Date, default: null })
  processedAt?: Date;

  @Prop({ type: Object, default: {} })
  payload?: Record<string, any>;
}

export const WhatsappWebhookEventSchema = SchemaFactory.createForClass(WhatsappWebhookEvent);

WhatsappWebhookEventSchema.index({ whatsappMessageId: 1, eventType: 1 });
