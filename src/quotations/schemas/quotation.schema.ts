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

  @Prop({ index: true })
  rootQuotationNo: string;

  @Prop({ type: Number, default: 1 })
  version: number;

  @Prop({ type: Types.ObjectId, ref: 'Quotation' })
  parentQuotation: Types.ObjectId;

  @Prop({ type: Boolean, default: true, index: true })
  isLatest: boolean;

  @Prop({ type: String })
  revisionReason: string;

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
    enum: [
      'draft',
      'pending_approval',
      'approved',
      'rejected_approval',
      'sent',
      'viewed',
      'negotiation',
      'accepted',
      'rejected',
      'expired',
      'superseded',
      'revised',
    ],
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

  @Prop({ type: Date })
  clientAcceptedAt: Date;

  @Prop({ type: String })
  clientAcceptedNotes: string;

  // Client Approval & Authorization Details (M03 - Approved By)
  @Prop({ type: String })
  approvedByName?: string;

  @Prop({ type: String })
  approvedByEmail?: string;

  @Prop({ type: String })
  approvedByPhone?: string;

  @Prop({ type: String })
  approvedByIpAddress?: string;

  // Backward-compat aliases
  @Prop({ type: String })
  signerName?: string;

  @Prop({ type: String })
  signerEmail?: string;

  @Prop({ type: String })
  clientFeedback: string;

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
    const lastDoc = await Model.findOne({ quotationNo: { $regex: new RegExp(`^QUO-${year}-\\d+`) } }).sort({ quotationNo: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.quotationNo) {
      const match = lastDoc.quotationNo.match(/QUO-\d+-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({
        $or: [
          { quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` },
          { quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}-V1` },
          { rootQuotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` },
        ],
      })
    ) {
      nextNum++;
    }
    const root = `QUO-${year}-${String(nextNum).padStart(4, '0')}`;
    this.rootQuotationNo = root;
    this.quotationNo = `${root}-V1`;
    this.version = 1;
    this.isLatest = true;
  }

  if (!this.rootQuotationNo && this.quotationNo) {
    const match = this.quotationNo.match(/^(QUO-\d+-\d+)/i);
    this.rootQuotationNo = match ? match[1].toUpperCase() : this.quotationNo;
  }
  if (!this.version) this.version = 1;
  if (this.isLatest === undefined) this.isLatest = true;

  // Calculate totals
  if (this.services?.length) {
    this.subtotal = this.services.reduce((s, svc) => s + (Number(svc.amount) || ((Number(svc.quantity) || 1) * (Number(svc.rate) || 0))), 0);
    this.taxAmount = Math.max(0, ((this.subtotal - (this.discount || 0)) * (this.taxPercent || 0)) / 100);
    this.totalAmount = Math.max(0, this.subtotal - (this.discount || 0) + this.taxAmount);
  }
});
