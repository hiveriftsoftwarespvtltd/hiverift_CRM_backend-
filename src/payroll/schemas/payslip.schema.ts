import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PayslipDocument = Payslip & Document;

@Schema({ timestamps: true })
export class Payslip {
  @Prop({ unique: true })
  payslipId: string;

  @Prop({ type: Types.ObjectId, ref: 'PayrollRun', required: true, index: true })
  payrollRun: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employee: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  monthYear: string;

  @Prop({
    type: [{ component: String, amount: Number }],
    default: [],
  })
  earnings: Array<{ component: string; amount: number }>;

  @Prop({
    type: [{ component: String, amount: Number }],
    default: [],
  })
  deductions: Array<{ component: string; amount: number }>;

  @Prop({ required: true, default: 0 })
  grossSalary: number;

  @Prop({ required: true, default: 0 })
  totalDeductions: number;

  @Prop({ required: true, default: 0 })
  netSalary: number;

  @Prop({
    type: String,
    enum: ['UNPAID', 'PAID'],
    default: 'UNPAID',
    index: true,
  })
  paymentStatus: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ trim: true })
  paymentReference?: string;
}

export const PayslipSchema = SchemaFactory.createForClass(Payslip);

PayslipSchema.index({ employee: 1, monthYear: 1 }, { unique: true });

PayslipSchema.pre<PayslipDocument>('save', async function () {
  if (!this.payslipId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      payslipId: { $regex: /^SLIP-\d+$/ },
    }).sort({ payslipId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.payslipId) {
      const match = lastDoc.payslipId.match(/SLIP-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ payslipId: `SLIP-${String(nextNum).padStart(5, '0')}` })
    ) {
      nextNum++;
    }
    this.payslipId = `SLIP-${String(nextNum).padStart(5, '0')}`;
  }
});

