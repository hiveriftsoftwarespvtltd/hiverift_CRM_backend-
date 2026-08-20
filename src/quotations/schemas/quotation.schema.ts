import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QuotationDocument = Quotation & Document;

@Schema({ _id: false })
export class QuotationServiceItem {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, default: 1 })
  quantity: number;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  amount: number;
}
const QuotationServiceItemSchema = SchemaFactory.createForClass(QuotationServiceItem);

@Schema({ timestamps: true })
export class Quotation {
  @Prop({ unique: true })
  quotationNo: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client: Types.ObjectId;

  @Prop({ type: [QuotationServiceItemSchema], default: [] })
  services: QuotationServiceItem[];

  @Prop({ type: Number, default: 0 })
  subtotal: number;

  @Prop({ type: Number, default: 0 })
  discount: number;

  @Prop({ type: Number, default: 18 })
  taxPercent: number;

  @Prop({ type: Number, default: 0 })
  taxAmount: number;

  @Prop({ type: Number, default: 0 })
  totalAmount: number;

  @Prop({ required: true, type: Date })
  validUntil: Date;

  @Prop({
    enum: ['draft', 'pending_approval', 'approved', 'rejected_approval', 'sent', 'viewed', 'negotiation', 'accepted', 'rejected', 'expired'],
    default: 'draft',
  })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy: Types.ObjectId;

  @Prop({ type: Date })
  approvalRequestedAt: Date;

  @Prop({ type: Date })
  approvedAt: Date;

  @Prop({ type: String })
  rejectionReason: string;

  @Prop({ type: String, default: 'sales_standard' })
  templateType: string;

  @Prop()
  headerTitle: string;

  @Prop()
  subTitle: string;

  @Prop()
  customClientHeading: string;

  @Prop()
  section1Title: string;

  @Prop()
  section2Title: string;

  @Prop()
  section3Title: string;

  @Prop()
  section4Title: string;

  @Prop()
  section5Title: string;

  @Prop()
  executiveSummary: string;

  @Prop()
  notes: string;

  @Prop()
  termsAndConditions: string;

  @Prop()
  footerQuote: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Date })
  sentAt: Date;

  @Prop({ type: Date })
  viewedAt: Date;
}

export const QuotationSchema = SchemaFactory.createForClass(Quotation);

QuotationSchema.pre<QuotationDocument>('save', async function () {
  if (!this.quotationNo) {
    const Model = this.constructor as any;
    const year = new Date().getFullYear();
    const lastDoc = await Model.findOne({ quotationNo: { $regex: new RegExp(`^QUO-${year}-\\d+$`) } }).sort({ quotationNo: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.quotationNo) {
      const match = lastDoc.quotationNo.match(/QUO-\d+-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.quotationNo = `QUO-${year}-${String(nextNum).padStart(4, '0')}`;
  }
  // Calculate totals
  if (this.services?.length) {
    this.subtotal = this.services.reduce((s, svc) => s + (svc.amount || 0), 0);
    this.taxAmount = ((this.subtotal - this.discount) * this.taxPercent) / 100;
    this.totalAmount = this.subtotal - this.discount + this.taxAmount;
  }
});
