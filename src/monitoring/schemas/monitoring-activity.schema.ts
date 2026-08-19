import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MonitoringActivityDocument = MonitoringActivity & Document;

@Schema({ timestamps: true })
export class MonitoringActivity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({ required: true, type: String }) // YYYY-MM-DD
  date: string;

  @Prop({ type: Number, default: 0 })
  totalActiveMinutes: number;

  @Prop({ type: Number, default: 0 })
  totalIdleMinutes: number;

  @Prop({ type: Number, default: 0 })
  totalBreakMinutes: number;

  @Prop({ type: Number, default: 0 })
  totalShiftMinutes: number;

  @Prop({ type: Number, default: 0 })
  productivityScore: number;

  @Prop({ type: Array, default: [] })
  topApplications: Array<{
    appName: string;
    durationMinutes: number;
    percentage: number;
    category: string;
  }>;
}

export const MonitoringActivitySchema = SchemaFactory.createForClass(MonitoringActivity);
MonitoringActivitySchema.index({ employee: 1, date: 1 }, { unique: true });
