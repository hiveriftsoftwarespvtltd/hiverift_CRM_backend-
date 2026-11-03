import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TimeEntryDocument = TimeEntry & Document;

export enum EntryType {
  TASK_SESSION = 'TASK_SESSION',
  PROJECT_TIMER = 'PROJECT_TIMER',
}

@Schema({ timestamps: true })
export class TimeEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task' })
  task: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project' })
  project: Types.ObjectId;

  @Prop({ required: true, type: Date })
  startTime: Date;

  @Prop({ type: Date })
  endTime: Date;

  @Prop({ default: 0 })
  durationSeconds: number;

  @Prop({ enum: Object.values(EntryType), default: EntryType.TASK_SESSION })
  entryType: string;

  @Prop({ trim: true })
  notes: string;

  @Prop({ default: false })
  isLive: boolean;

  @Prop({ default: 'live_timer' })
  source: string;

  @Prop({ default: true, index: true })
  isBillable: boolean;

  @Prop({ default: false, index: true })
  isLocked: boolean;
}

export const TimeEntrySchema = SchemaFactory.createForClass(TimeEntry);

// Index to quickly locate active/paused timers and support concurrency enforcement
TimeEntrySchema.index({ user: 1, endTime: 1, isLive: 1 });
TimeEntrySchema.index({ user: 1, isLive: 1 });

