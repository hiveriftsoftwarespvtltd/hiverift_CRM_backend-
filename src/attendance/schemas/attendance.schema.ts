import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

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

  @Prop()
  notes: string;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
