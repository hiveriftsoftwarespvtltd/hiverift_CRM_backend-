import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AccountingPeriodDocument = AccountingPeriod & Document;

@Schema({ timestamps: true })
export class AccountingPeriod {
  @Prop({ required: true, unique: true, trim: true, index: true })
  periodKey: string; // "YYYY-MM", e.g. "2026-10"

  @Prop({ required: true, type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  endDate: Date;

  @Prop({ default: false, index: true })
  isLocked: boolean;

  @Prop({ type: Date })
  lockedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lockedBy?: Types.ObjectId;

  @Prop({ trim: true })
  closingNotes?: string;
}

export const AccountingPeriodSchema = SchemaFactory.createForClass(AccountingPeriod);

