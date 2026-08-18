import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

@Schema({ _id: false })
export class BreakItem {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true, type: Date })
  startTime: Date;

  @Prop({ type: Date })
  endTime?: Date;

  @Prop({ type: Number, default: 0 })
  durationMinutes?: number;
}

export const BreakItemSchema = SchemaFactory.createForClass(BreakItem);

@Schema({ _id: false })
export class ActiveBreakItem {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true, type: Date })
  startTime: Date;
}

export const ActiveBreakItemSchema = SchemaFactory.createForClass(ActiveBreakItem);

@Schema({ timestamps: true })
export class Attendance {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ type: Date })
  checkIn: Date;

  @Prop({ type: Date })
  checkOut: Date;

  @Prop({ type: Number, default: 0 })
  workingHours: number;

  @Prop({ type: String, enum: ['present', 'absent', 'half_day', 'leave', 'wfh', 'late'], default: 'present' })
  status: string;

  @Prop({ type: [BreakItemSchema], default: [] })
  breaks: BreakItem[];

  @Prop({ type: Number, default: 0 })
  totalBreakMinutes: number;

  @Prop({ type: ActiveBreakItemSchema, required: false })
  activeBreak?: ActiveBreakItem;

  @Prop()
  notes: string;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
