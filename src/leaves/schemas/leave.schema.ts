import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeaveDocument = Leave & Document;

@Schema({ timestamps: true })
export class Leave {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({ type: String, enum: ['casual', 'sick', 'annual', 'unpaid', 'maternity', 'other'], required: true })
  type: string;

  @Prop({ required: true, type: Date })
  fromDate: Date;

  @Prop({ required: true, type: Date })
  toDate: Date;

  @Prop({ type: Number, default: 1 })
  days: number;

  @Prop({ required: true })
  reason: string;

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  requestedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt: Date;

  @Prop()
  rejectionReason: string;
}

export const LeaveSchema = SchemaFactory.createForClass(Leave);
