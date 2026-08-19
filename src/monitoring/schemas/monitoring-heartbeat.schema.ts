import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MonitoringHeartbeatDocument = MonitoringHeartbeat & Document;

@Schema({ timestamps: true })
export class MonitoringHeartbeat {
  @Prop({ type: Types.ObjectId, ref: 'MonitoringDevice', required: true })
  device: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['active', 'idle', 'break', 'offline'],
    default: 'active',
  })
  status: string;

  @Prop({ trim: true })
  currentApp: string;

  @Prop({ trim: true })
  windowTitle: string;

  @Prop({ type: Number, default: 0 })
  idleSeconds: number;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;
}

export const MonitoringHeartbeatSchema = SchemaFactory.createForClass(MonitoringHeartbeat);
MonitoringHeartbeatSchema.index({ employee: 1, timestamp: -1 });
MonitoringHeartbeatSchema.index({ device: 1, timestamp: -1 });
