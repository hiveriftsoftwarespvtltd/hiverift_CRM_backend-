import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CallingBatchDocument = CallingBatch & Document;
export type CallingContactDocument = CallingContact & Document;

@Schema({ timestamps: true })
export class CallingBatch {
  @Prop({ unique: true })
  batchNo: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: 'CSV Upload' })
  source: string;

  @Prop({ type: Number, default: 0 })
  totalNumbers: number;

  @Prop({ type: Number, default: 0 })
  assignedCount: number;

  @Prop({ type: Number, default: 0 })
  calledCount: number;

  @Prop({ type: Number, default: 0 })
  pendingCount: number;

  @Prop({ type: Number, default: 0 })
  interestedCount: number;

  @Prop({ type: String, enum: ['active', 'completed', 'archived'], default: 'active' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  assignedTo: Types.ObjectId[];
}

export const CallingBatchSchema = SchemaFactory.createForClass(CallingBatch);

@Schema({ timestamps: true })
export class CallingContact {
  @Prop({ unique: true })
  contactNo: string;

  @Prop({ type: Types.ObjectId, ref: 'CallingBatch', required: true })
  batchId: Types.ObjectId;

  @Prop({ default: 'Prospect', trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true })
  city: string;

  @Prop({ trim: true })
  company: string;

  @Prop({ trim: true })
  requirement: string;

  @Prop({ trim: true })
  notes: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedBy: Types.ObjectId;

  @Prop({ type: Date })
  assignedAt: Date;

  @Prop({
    type: String,
    enum: [
      'pending',
      'interested',
      'callback',
      'not_interested',
      'ringing_no_answer',
      'busy',
      'switched_off',
      'invalid_wrong_number',
    ],
    default: 'pending',
  })
  callStatus: string;

  @Prop({
    type: [
      {
        calledAt: { type: Date, default: Date.now },
        status: String,
        remark: String,
        calledBy: { type: Types.ObjectId, ref: 'User' },
        callbackTime: Date,
      },
    ],
    default: [],
  })
  callHistory: {
    calledAt: Date;
    status: string;
    remark: string;
    calledBy: Types.ObjectId;
    callbackTime?: Date;
  }[];

  @Prop({ type: Date })
  callbackTime: Date;

  @Prop({ type: Boolean, default: false })
  isConvertedToLead: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  convertedLeadId: Types.ObjectId;
}

export const CallingContactSchema = SchemaFactory.createForClass(CallingContact);
