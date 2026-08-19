import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MonitoringAppSessionDocument = MonitoringAppSession & Document;

@Schema({ timestamps: true })
export class MonitoringAppSession {
  @Prop({ type: Types.ObjectId, ref: 'MonitoringDevice', required: true })
  device: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({ required: true, trim: true })
  appName: string;

  @Prop({ required: true, trim: true })
  processName: string;

  @Prop({ trim: true })
  windowTitle: string;

  @Prop({
    type: String,
    enum: ['development', 'communication', 'productivity', 'browsing', 'utilities', 'other'],
    default: 'other',
  })
  category: string;

  @Prop({ required: true, type: Date })
  startTime: Date;

  @Prop({ required: true, type: Date })
  endTime: Date;

  @Prop({ required: true, type: Number, default: 0 })
  durationSeconds: number;

  @Prop({ required: true, type: Number, default: 0 })
  durationMinutes: number;

  @Prop({ required: true, type: String }) // Format: YYYY-MM-DD
  date: string;
}

export const MonitoringAppSessionSchema = SchemaFactory.createForClass(MonitoringAppSession);
MonitoringAppSessionSchema.index({ employee: 1, date: 1 });
MonitoringAppSessionSchema.index({ date: 1, appName: 1 });
