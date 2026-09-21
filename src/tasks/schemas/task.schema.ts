import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TaskDocument = Task & Document;

export enum TaskType {
  PERSONAL = 'PERSONAL',
  DEPARTMENT = 'DEPARTMENT',
  PROJECT = 'PROJECT',
  CLIENT_DELIVERABLE = 'CLIENT_DELIVERABLE',
  CROSS_DEPARTMENT = 'CROSS_DEPARTMENT',
  BUG = 'BUG',
  SUPPORT = 'SUPPORT',
  RECURRING = 'RECURRING',
}

export enum TaskStatus {
  DRAFT = 'DRAFT',
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  REVIEW = 'REVIEW',
  REWORK = 'REWORK',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  ON_HOLD = 'ON_HOLD',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum CrossDeptStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ReassignmentStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  description: string;

  @Prop({ enum: Object.values(TaskType), default: TaskType.DEPARTMENT })
  taskType: string;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project' })
  project: Types.ObjectId;

  @Prop({ trim: true })
  milestone: string;

  @Prop({ trim: true })
  department: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedManager: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewer: Types.ObjectId;

  @Prop({ enum: Object.values(TaskPriority), default: TaskPriority.MEDIUM })
  priority: string;

  @Prop({ enum: Object.values(TaskStatus), default: TaskStatus.TODO })
  status: string;

  @Prop({ type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  dueDate: Date;

  @Prop({ default: 0 })
  estimatedHours: number;

  @Prop({ default: 0 })
  actualHours: number;

  @Prop({ default: 0 })
  progress: number;

  @Prop({ type: Date })
  completedAt: Date;

  @Prop({ trim: true })
  onHoldReason: string;

  @Prop({ trim: true })
  reworkNotes: string;

  // Cross-Department Request Fields
  @Prop({ trim: true })
  requestingDepartment: string;

  @Prop({ trim: true })
  targetDepartment: string;

  @Prop({ enum: Object.values(CrossDeptStatus) })
  crossDeptStatus: string;

  @Prop({ trim: true })
  crossDeptReason: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  crossDeptApprovedBy: Types.ObjectId;

  @Prop({ type: Date })
  crossDeptApprovedAt: Date;

  // Deliverable & Marketing Integration
  @Prop({ trim: true })
  deliverableType: string;

  @Prop({ default: false })
  clientReviewRequired: boolean;

  @Prop({ default: false })
  clientApproved: boolean;

  // Bug Tracking & Defect Management Fields
  @Prop({ trim: true })
  bugSeverity: string;

  @Prop({ trim: true })
  bugEnvironment: string;

  @Prop({ trim: true })
  bugStepsToReproduce: string;

  @Prop({ trim: true })
  bugFixSummary: string;

  @Prop({ trim: true })
  bugFixCommitLink: string;

  @Prop({ default: false })
  bugQaApproved: boolean;

  // Task Transfer / Reassignment Approval Workflow
  @Prop({ enum: Object.values(ReassignmentStatus), default: ReassignmentStatus.NONE })
  reassignmentStatus: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  pendingNewAssignee: Types.ObjectId;

  @Prop({ trim: true })
  reassignmentReason: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reassignmentRequestedBy: Types.ObjectId;

  // Checklist & Dependencies
  @Prop([
    {
      title: { type: String, required: true },
      completed: { type: Boolean, default: false },
      completedAt: { type: Date },
    },
  ])
  checklist: Array<{ title: string; completed: boolean; completedAt?: Date }>;

  @Prop({ type: Types.ObjectId, ref: 'Task' })
  parentTask: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task' })
  dependsOnTask: Types.ObjectId;

  @Prop({ default: false })
  isDependencyResolved: boolean;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop([
    {
      user: { type: Types.ObjectId, ref: 'User' },
      comment: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ])
  comments: Array<{ user: Types.ObjectId; comment: string; createdAt: Date }>;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
