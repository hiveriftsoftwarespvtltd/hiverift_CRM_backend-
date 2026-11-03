import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChartOfAccountDocument = ChartOfAccount & Document;

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

@Schema({ timestamps: true })
export class ChartOfAccount {
  @Prop({ required: true, unique: true, trim: true, index: true })
  accountCode: string; // e.g. "1010", "1100", "2010", "4000"

  @Prop({ required: true, trim: true })
  accountName: string; // e.g. "HDFC Bank Operating", "Accounts Receivable"

  @Prop({
    required: true,
    enum: Object.values(AccountType),
    index: true,
  })
  accountType: string;

  @Prop({ required: true, trim: true })
  category: string; // e.g. "CURRENT_ASSET", "OPERATING_REVENUE", "DIRECT_EXPENSE"

  @Prop({ default: 'INR' })
  currency: string;

  @Prop({ default: 0 })
  currentBalance: number;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const ChartOfAccountSchema = SchemaFactory.createForClass(ChartOfAccount);

