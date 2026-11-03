import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ApprovalRecordDocument = ApprovalRecord & Document;

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REWORK_REQUESTED = 'REWORK_REQUESTED',
  CANCELLED = 'CANCELLED',
}

export enum ApprovalEntityType {
  QUOTATION = 'QUOTATION',
  TASK = 'TASK',
  LEAVE = 'LEAVE',
  TIMESHEET = 'TIMESHEET',
  EXPENSE = 'EXPENSE',
  PROJECT = 'PROJECT',
  DEAL = 'DEAL',
  CUSTOM = 'CUSTOM',
}

@Schema({ timestamps: true })
export class ApprovalRecord {
  @Prop({ required: true, enum: Object.values(ApprovalEntityType), index: true })
  entityType: string;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  entityId: Types.ObjectId;

  @Prop({ required: true, trim: true, default: 'COMMERCIAL' })
  approvalType: string;

  @Prop({
    required: true,
    enum: Object.values(ApprovalStatus),
    default: ApprovalStatus.PENDING,
    index: true,
  })
  status: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  requestedBy: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  requestedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedApprover?: Types.ObjectId;

  @Prop({ trim: true })
  approverRole?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actionBy?: Types.ObjectId;

  @Prop({ type: Date })
  actionAt?: Date;

  @Prop({ trim: true })
  comments?: string;

  @Prop({ trim: true })
  decisionReason?: string;

  @Prop({ trim: true })
  policyRef?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const ApprovalRecordSchema = SchemaFactory.createForClass(ApprovalRecord);

ApprovalRecordSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
ApprovalRecordSchema.index({ assignedApprover: 1, status: 1 });

