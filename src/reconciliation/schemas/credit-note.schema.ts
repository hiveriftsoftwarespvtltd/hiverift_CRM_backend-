import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CreditNoteDocument = CreditNote & Document;

export enum CreditNoteReason {
  DISCOUNT = 'DISCOUNT',
  SERVICE_DEFICIENCY = 'SERVICE_DEFICIENCY',
  ORDER_CANCELLATION = 'ORDER_CANCELLATION',
  BILLING_ERROR = 'BILLING_ERROR',
  GOODWILL = 'GOODWILL',
}

@Schema({ timestamps: true })
export class CreditNote {
  @Prop({ unique: true })
  creditNoteNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Invoice', required: true, index: true })
  invoice: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  client: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  amount: number;

  @Prop({ default: 0 })
  taxAdjustment: number;

  @Prop({ required: true, default: 0 })
  totalAmount: number;

  @Prop({
    type: String,
    enum: Object.values(CreditNoteReason),
    default: CreditNoteReason.BILLING_ERROR,
  })
  reason: string;

  @Prop({
    type: String,
    enum: ['DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED'],
    default: 'APPLIED',
    index: true,
  })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'JournalEntry' })
  linkedJournalEntry?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const CreditNoteSchema = SchemaFactory.createForClass(CreditNote);

CreditNoteSchema.pre<CreditNoteDocument>('save', async function () {
  if (!this.creditNoteNumber) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      creditNoteNumber: { $regex: /^CN-\d+$/ },
    }).sort({ creditNoteNumber: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.creditNoteNumber) {
      const match = lastDoc.creditNoteNumber.match(/CN-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ creditNoteNumber: `CN-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.creditNoteNumber = `CN-${String(nextNum).padStart(4, '0')}`;
  }
});

