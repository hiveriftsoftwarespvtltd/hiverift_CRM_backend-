import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ unique: true })
  paymentNo: string;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quotation' })
  quotation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project' })
  project: Types.ObjectId;

  @Prop({ required: true, type: Number })
  invoiceAmount: number;

  @Prop({ type: Number, default: 0 })
  receivedAmount: number;

  @Prop({ type: Number, default: 0 })
  pendingAmount: number;

  @Prop({ type: Date })
  invoiceDueDate: Date;

  @Prop({ type: Date })
  receivedDate: Date;

  @Prop({ type: String, enum: ['cash', 'bank_transfer', 'upi', 'cheque', 'online', 'other'] })
  paymentMethod: string;

  @Prop()
  reference: string;

  @Prop({ type: String, enum: ['paid', 'pending', 'partial', 'overdue', 'cancelled'], default: 'pending' })
  status: string;

  @Prop()
  notes: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop()
  invoiceNo: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.pre<PaymentDocument>('save', async function () {
  if (!this.paymentNo) {
    const Model = this.constructor as any;
    const year = new Date().getFullYear();
    const lastDoc = await Model.findOne({ paymentNo: { $regex: new RegExp(`^PAY-${year}-\\d+$`) } }).sort({ paymentNo: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.paymentNo) {
      const match = lastDoc.paymentNo.match(/PAY-\d+-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ paymentNo: `PAY-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.paymentNo = `PAY-${year}-${String(nextNum).padStart(4, '0')}`;
  }
  this.pendingAmount = this.invoiceAmount - this.receivedAmount;
  if (this.receivedAmount >= this.invoiceAmount) this.status = 'paid';
  else if (this.receivedAmount > 0) this.status = 'partial';
});
