import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ExecutiveSnapshotDocument = ExecutiveSnapshot & Document;

@Schema({ timestamps: true })
export class ExecutiveSnapshot {
  @Prop({ unique: true })
  snapshotId: string;

  @Prop({ required: true, unique: true, trim: true, index: true })
  period: string; // "YYYY-MM", e.g. "2026-10"

  @Prop({ required: true, type: Date })
  asOfDate: Date;

  @Prop({
    type: {
      totalRevenue: { type: Number, default: 0 },
      directCosts: { type: Number, default: 0 },
      payrollCosts: { type: Number, default: 0 },
      operatingExpenses: { type: Number, default: 0 },
      grossProfit: { type: Number, default: 0 },
      operatingProfit: { type: Number, default: 0 },
      operatingMarginPercentage: { type: Number, default: 0 },
    },
    default: {},
  })
  financialSummary: {
    totalRevenue: number;
    directCosts: number;
    payrollCosts: number;
    operatingExpenses: number;
    grossProfit: number;
    operatingProfit: number;
    operatingMarginPercentage: number;
  };

  @Prop({
    type: {
      accountsReceivable: { type: Number, default: 0 },
      accountsPayable: { type: Number, default: 0 },
      cashAndBank: { type: Number, default: 0 },
      netWorkingCapital: { type: Number, default: 0 },
    },
    default: {},
  })
  workingCapital: {
    accountsReceivable: number;
    accountsPayable: number;
    cashAndBank: number;
    netWorkingCapital: number;
  };

  @Prop({
    type: {
      activeProjectsCount: { type: Number, default: 0 },
      completedTasksCount: { type: Number, default: 0 },
      timesheetLoggedHours: { type: Number, default: 0 },
      billableUtilizationPercentage: { type: Number, default: 0 },
      newClientsAcquired: { type: Number, default: 0 },
      activeEmployeeHeadcount: { type: Number, default: 0 },
    },
    default: {},
  })
  operationalKPIs: {
    activeProjectsCount: number;
    completedTasksCount: number;
    timesheetLoggedHours: number;
    billableUtilizationPercentage: number;
    newClientsAcquired: number;
    activeEmployeeHeadcount: number;
  };

  @Prop({ default: false, index: true })
  isClosed: boolean;

  @Prop({ type: Date })
  closedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  closedBy?: Types.ObjectId;

  @Prop({ trim: true })
  closingNotes?: string;
}

export const ExecutiveSnapshotSchema = SchemaFactory.createForClass(ExecutiveSnapshot);

ExecutiveSnapshotSchema.pre<ExecutiveSnapshotDocument>('save', async function () {
  if (!this.snapshotId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      snapshotId: { $regex: /^SNAP-\d+$/ },
    }).sort({ snapshotId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.snapshotId) {
      const match = lastDoc.snapshotId.match(/SNAP-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ snapshotId: `SNAP-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.snapshotId = `SNAP-${String(nextNum).padStart(4, '0')}`;
  }
});

