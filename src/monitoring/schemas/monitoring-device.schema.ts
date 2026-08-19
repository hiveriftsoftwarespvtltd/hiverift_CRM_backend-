import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MonitoringDeviceDocument = MonitoringDevice & Document;

@Schema({ timestamps: true })
export class MonitoringDevice {
  @Prop({ required: true, unique: true, trim: true })
  deviceId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  employee: Types.ObjectId;

  @Prop({ trim: true })
  deviceName: string;

  @Prop({ trim: true })
  os: string;

  @Prop({ trim: true, default: '1.0.0' })
  agentVersion: string;

  @Prop({ trim: true })
  pairingToken: string;

  @Prop({ type: Date })
  tokenExpiresAt: Date;

  @Prop({
    type: String,
    enum: ['connected', 'disconnected', 'revoked'],
    default: 'connected',
  })
  status: string;

  @Prop({ type: Date, default: Date.now })
  lastHeartbeat: Date;

  @Prop({ trim: true })
  ipAddress: string;

  @Prop({ trim: true })
  deviceSecret: string;
}

export const MonitoringDeviceSchema = SchemaFactory.createForClass(MonitoringDevice);
