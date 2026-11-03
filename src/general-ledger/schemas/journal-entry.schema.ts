import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type JournalEntryDocument = JournalEntry & Document;

export enum JournalStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
}

@Schema({ timestamps: true })
export class JournalEntry {
  @Prop({ unique: true })
  journalNumber: string;

  @Prop({ required: true, type: Date, index: true })
  entryDate: Date;

  @Prop({ trim: true })
  reference: string; // e.g. "INV-0042", "SALARY-OCT2026", "EXPENSE-99"

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({
    required: true,
    enum: Object.values(JournalStatus),
    default: JournalStatus.DRAFT,
    index: true,
  })
  status: string;

  @Prop({
    type: [
      {
        account: { type: Types.ObjectId, ref: 'ChartOfAccount', required: true },
        accountCode: { type: String, required: true },
        accountName: { type: String, required: true },
        debit: { type: Number, default: 0 },
        credit: { type: Number, default: 0 },
        description: String,
        referenceEntity: {
          entityType: String,
          entityId: Types.ObjectId,
        },
      },
    ],
    required: true,
    validate: [
      (lines: any[]) => lines && lines.length >= 2,
      'A journal entry must have at least two balanced lines',
    ],
  })
  lines: Array<{
    account: Types.ObjectId;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description?: string;
    referenceEntity?: {
      entityType: string;
      entityId: Types.ObjectId;
    };
  }>;

  @Prop({ required: true, default: 0 })
  totalDebit: number;

  @Prop({ required: true, default: 0 })
  totalCredit: number;

  @Prop({ required: true, default: false })
  isBalanced: boolean;

  @Prop({ required: true, trim: true, index: true })
  accountingPeriod: string; // "YYYY-MM", e.g. "2026-10"

  @Prop({ type: Date })
  postedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  postedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'JournalEntry' })
  reversalOfJournal?: Types.ObjectId;

  @Prop({ trim: true })
  reversalReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const JournalEntrySchema = SchemaFactory.createForClass(JournalEntry);

JournalEntrySchema.index({ entryDate: -1, status: 1 });
JournalEntrySchema.index({ 'lines.account': 1 });

JournalEntrySchema.pre<JournalEntryDocument>('save', async function () {
  if (!this.journalNumber) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      journalNumber: { $regex: /^JRN-\d+$/ },
    }).sort({ journalNumber: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.journalNumber) {
      const match = lastDoc.journalNumber.match(/JRN-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ journalNumber: `JRN-${String(nextNum).padStart(5, '0')}` })
    ) {
      nextNum++;
    }
    this.journalNumber = `JRN-${String(nextNum).padStart(5, '0')}`;
  }
});

