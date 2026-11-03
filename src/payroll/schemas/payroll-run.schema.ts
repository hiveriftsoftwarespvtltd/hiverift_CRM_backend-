import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PayrollRunDocument = PayrollRun & Document;

export enum PayrollStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  PROCESSED = 'PROCESSED',
}

@Schema({ timestamps: true })
export class PayrollRun {
  @Prop({ unique: true })
  payrollRunId: string;

  @Prop({ required: true, trim: true, index: true })
  monthYear: string; // "YYYY-MM", e.g. "2026-10"

  @Prop({
    type: String,
    enum: Object.values(PayrollStatus),
    default: PayrollStatus.DRAFT,
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  totalEmployees: number;

  @Prop({ default: 0 })
  totalGrossPay: number;

  @Prop({ default: 0 })
  totalDeductions: number;

  @Prop({ default: 0 })
  totalNetPay: number;

  @Prop({ type: Date })
  processedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'JournalEntry' })
  linkedJournalEntry?: Types.ObjectId;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const PayrollRunSchema = SchemaFactory.createForClass(PayrollRun);

PayrollRunSchema.pre<PayrollRunDocument>('save', async function () {
  if (!this.payrollRunId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      payrollRunId: { $regex: /^PAYRUN-\d+$/ },
    }).sort({ payrollRunId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.payrollRunId) {
      const match = lastDoc.payrollRunId.match(/PAYRUN-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ payrollRunId: `PAYRUN-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.payrollRunId = `PAYRUN-${String(nextNum).padStart(4, '0')}`;
  }
});

