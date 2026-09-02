import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InvoiceDocument = Invoice & Document;

@Schema({ _id: false })
export class InvoiceItem {
  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true, default: 1, min: 1 })
  quantity: number;

  @Prop({ required: true, default: 0, min: 0 })
  rate: number;

  @Prop({ required: true, default: 0 })
  amount: number;
}

export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true, trim: true })
  invoiceNo: string;

  @Prop({ trim: true })
  logo: string;

  @Prop({ trim: true, default: 'HiveRift Softwares Pvt Ltd\ninfo@hiverift.com\n+91 9667106291' })
  from: string;

  @Prop({ required: true, trim: true })
  billTo: string;

  @Prop({ trim: true })
  shipTo: string;

  @Prop({ type: Date, default: Date.now })
  date: Date;

  @Prop({ trim: true, default: 'Due on Receipt' })
  paymentTerms: string;

  @Prop({ type: Date })
  dueDate: Date;

  @Prop({ trim: true })
  poNumber: string;

  @Prop({ trim: true, default: '₹' })
  currency: string;

  @Prop({ type: [InvoiceItemSchema], default: [] })
  items: InvoiceItem[];

  @Prop({ trim: true, default: 'Thank you for your business!' })
  notes: string;

  @Prop({ trim: true, default: 'Payment is due within 15 days of invoice date. Please transfer payment to our registered company account.' })
  terms: string;

  @Prop({ required: true, default: 0 })
  subtotal: number;

  @Prop({ default: 0 })
  taxRate: number;

  @Prop({ default: 0 })
  taxAmount: number;

  @Prop({ default: 'percentage', enum: ['percentage', 'fixed'] })
  discountType: string;

  @Prop({ default: 0 })
  discountValue: number;

  @Prop({ default: 0 })
  discountAmount: number;

  @Prop({ default: 0 })
  shipping: number;

  @Prop({ required: true, default: 0 })
  total: number;

  @Prop({ default: 0 })
  amountPaid: number;

  @Prop({ required: true, default: 0 })
  balanceDue: number;

  @Prop({
    default: 'draft',
    enum: ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'],
  })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
