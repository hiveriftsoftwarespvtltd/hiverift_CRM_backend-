import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AccountTransactionDocument = AccountTransaction & Document;

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
}

@Schema({ timestamps: true, collection: 'account_transactions' })
export class AccountTransaction {
  @Prop({ unique: true })
  transactionNo: string; // e.g. TXN-2026-0001

  @Prop({
    required: true,
    enum: Object.values(TransactionType),
    default: TransactionType.EXPENSE,
  })
  type: string;

  @Prop({ required: true })
  category: string;
  // Income: 'client_payment', 'consulting', 'retainer', 'interest', 'other_income'
  // Expense: 'software_tools', 'cloud_hosting', 'office_rent', 'payroll_salaries', 'marketing_ads', 'contractor_payout', 'office_supplies', 'tax_gst', 'utilities', 'other_expense'

  @Prop({ required: true, type: Number, min: 0 })
  amount: number;

  @Prop({ type: Types.ObjectId, ref: 'CompanyAccount', required: true })
  account: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CompanyAccount' })
  toAccount?: Types.ObjectId; // For 'transfer' type

  @Prop({ required: true, type: Date, default: Date.now })
  date: Date;

  @Prop({
    enum: ['bank_transfer', 'upi', 'cheque', 'cash', 'credit_card', 'other'],
    default: 'bank_transfer',
  })
  paymentMethod: string;

  @Prop({ trim: true })
  referenceNo?: string; // UTR / Cheque / Txn ID

  @Prop({ trim: true })
  payeeOrPayer?: string; // e.g. "AWS Cloud", "Landlord", "Client Name"

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoice?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  payment?: Types.ObjectId;

  @Prop({ trim: true })
  description?: string;

  @Prop()
  attachmentUrl?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const AccountTransactionSchema = SchemaFactory.createForClass(AccountTransaction);

AccountTransactionSchema.pre<AccountTransactionDocument>('save', async function () {
  if (!this.transactionNo) {
    const Model = this.constructor as any;
    const year = new Date().getFullYear();
    const lastDoc = await Model.findOne({ transactionNo: { $regex: new RegExp(`^TXN-${year}-\\d+$`) } }).sort({ transactionNo: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.transactionNo) {
      const match = lastDoc.transactionNo.match(/TXN-\d+-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ transactionNo: `TXN-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.transactionNo = `TXN-${year}-${String(nextNum).padStart(4, '0')}`;
  }
});
