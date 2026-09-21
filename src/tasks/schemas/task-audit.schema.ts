import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TaskAuditDocument = TaskAudit & Document;

@Schema({ timestamps: true })
export class TaskAudit {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task: Types.ObjectId;

  @Prop({ required: true, trim: true })
  action: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  performedBy: Types.ObjectId;

  @Prop({ trim: true })
  oldValue: string;

  @Prop({ trim: true })
  newValue: string;

  @Prop({ trim: true })
  comment: string;

  @Prop({ trim: true })
  requestingDepartment: string;

  @Prop({ trim: true })
  targetDepartment: string;
}

export const TaskAuditSchema = SchemaFactory.createForClass(TaskAudit);
