import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RenewalDocument = Renewal & Document;

@Schema({ timestamps: true })
export class Renewal {
  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  client: Types.ObjectId;

  @Prop({ required: true })
  service: string;

  @Prop({ required: true, type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  expiryDate: Date;

  @Prop({ type: String, enum: ['active', 'due_today', 'next_7_days', 'next_30_days', 'renewed', 'expired'], default: 'active' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedSales: Types.ObjectId;

  @Prop({ type: Date })
  renewedAt: Date;

  @Prop({ type: Date })
  newExpiryDate: Date;

  @Prop()
  notes: string;

  @Prop({ type: Number })
  amount: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const RenewalSchema = SchemaFactory.createForClass(Renewal);
