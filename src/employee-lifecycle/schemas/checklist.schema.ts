import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChecklistDocument = Checklist & Document;

export enum ChecklistType {
  ONBOARDING = 'ONBOARDING',
  OFFBOARDING = 'OFFBOARDING',
}

@Schema({ timestamps: true })
export class Checklist {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employee: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ChecklistType),
    required: true,
    index: true,
  })
  checklistType: string;

  @Prop({
    type: [
      {
        taskName: { type: String, required: true },
        category: { type: String, default: 'HR' },
        isCompleted: { type: Boolean, default: false },
        completedAt: Date,
        completedBy: { type: Types.ObjectId, ref: 'User' },
        notes: String,
      },
    ],
    default: [],
  })
  items: Array<{
    taskName: string;
    category: string;
    isCompleted: boolean;
    completedAt?: Date;
    completedBy?: Types.ObjectId;
    notes?: string;
  }>;

  @Prop({
    type: String,
    enum: ['IN_PROGRESS', 'COMPLETED'],
    default: 'IN_PROGRESS',
    index: true,
  })
  status: string;

  @Prop({ type: Date })
  targetCompletionDate?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedCoordinator?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const ChecklistSchema = SchemaFactory.createForClass(Checklist);

