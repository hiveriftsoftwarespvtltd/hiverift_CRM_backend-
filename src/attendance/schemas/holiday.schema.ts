import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type HolidayDocument = Holiday & Document;

@Schema({ timestamps: true })
export class Holiday {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ required: true, type: String, trim: true })
  dateStr: string; // YYYY-MM-DD in IST

  @Prop({ type: String, enum: ['all', 'individual'], default: 'all' })
  scope: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  employee?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  notes?: string;
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);
HolidaySchema.index({ dateStr: 1, scope: 1, employee: 1 });
