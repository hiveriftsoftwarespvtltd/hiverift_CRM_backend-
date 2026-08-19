import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MonitoringPolicyDocument = MonitoringPolicy & Document;

@Schema({ timestamps: true })
export class MonitoringPolicy {
  @Prop({ type: Number, default: 10 }) // In minutes
  idleThresholdMinutes: number;

  @Prop({ type: Number, default: 20 }) // In seconds
  heartbeatIntervalSeconds: number;

  @Prop({ type: Boolean, default: true })
  trackApplicationSessions: boolean;

  @Prop({ type: Boolean, default: false })
  captureScreenshots: boolean;

  @Prop({ type: Number, default: 10 }) // Attendance weight %
  weightAttendance: number;

  @Prop({ type: Number, default: 40 }) // Active work time weight %
  weightActiveTime: number;

  @Prop({ type: Number, default: 30 }) // CRM/App productivity weight %
  weightProductivity: number;

  @Prop({ type: Number, default: 20 }) // Task completion weight %
  weightTasks: number;
}

export const MonitoringPolicySchema = SchemaFactory.createForClass(MonitoringPolicy);
