import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CompanyAccountDocument = CompanyAccount & Document;

@Schema({ timestamps: true, collection: 'company_accounts' })
export class CompanyAccount {
  @Prop({ required: true, trim: true })
  name: string; // e.g. "HDFC Current Account", "Petty Cash", "Razorpay / UPI"

  @Prop({
    required: true,
    enum: ['bank', 'cash', 'wallet', 'other'],
    default: 'bank',
  })
  accountType: string;

  @Prop({ trim: true })
  accountNumber?: string;

  @Prop({ trim: true })
  bankName?: string;

  @Prop({ trim: true })
  ifscCode?: string;

  @Prop({ type: Number, default: 0 })
  openingBalance: number;

  @Prop({ type: Number, default: 0 })
  currentBalance: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isDefault: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const CompanyAccountSchema = SchemaFactory.createForClass(CompanyAccount);
