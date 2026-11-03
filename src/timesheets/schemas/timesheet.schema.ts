import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TimesheetDocument = Timesheet & Document;

export enum TimesheetStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class Timesheet {
  @Prop({ unique: true })
  timesheetId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employee: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  periodStartDate: Date;

  @Prop({ type: Date, required: true, index: true })
  periodEndDate: Date;

  @Prop({
    type: String,
    enum: Object.values(TimesheetStatus),
    default: TimesheetStatus.DRAFT,
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  totalLoggedHours: number;

  @Prop({ default: 0 })
  totalBillableHours: number;

  @Prop({ default: 0 })
  utilizationPercentage: number; // e.g. 92.5%

  @Prop({ default: 0 })
  billableUtilizationPercentage: number; // e.g. 85.0%

  @Prop({
    type: [
      {
        timeEntry: { type: Types.ObjectId, ref: 'TimeEntry' },
        date: { type: Date, required: true },
        hours: { type: Number, required: true },
        taskTitle: String,
        projectTitle: String,
        isBillable: { type: Boolean, default: true },
        notes: String,
      },
    ],
    default: [],
  })
  entries: Array<{
    timeEntry?: Types.ObjectId;
    date: Date;
    hours: number;
    taskTitle?: string;
    projectTitle?: string;
    isBillable: boolean;
    notes?: string;
  }>;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ trim: true })
  rejectionReason?: string;

  @Prop({ trim: true })
  managerComments?: string;

  @Prop({ default: false, index: true })
  isLocked: boolean;
}

export const TimesheetSchema = SchemaFactory.createForClass(Timesheet);

TimesheetSchema.index({ employee: 1, periodStartDate: 1 }, { unique: true });

TimesheetSchema.pre<TimesheetDocument>('save', async function () {
  if (!this.timesheetId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      timesheetId: { $regex: /^TS-\d+$/ },
    }).sort({ timesheetId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.timesheetId) {
      const match = lastDoc.timesheetId.match(/TS-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ timesheetId: `TS-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.timesheetId = `TS-${String(nextNum).padStart(4, '0')}`;
  }
});

