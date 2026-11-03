import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PurchaseOrderDocument = PurchaseOrder & Document;

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  ORDERED = 'ORDERED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class PurchaseOrder {
  @Prop({ unique: true })
  poNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendor: Types.ObjectId;

  @Prop({ required: true, type: Date })
  orderDate: Date;

  @Prop({ type: Date })
  expectedDeliveryDate?: Date;

  @Prop({
    type: [
      {
        itemName: { type: String, required: true },
        description: String,
        quantity: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true, default: 0 },
        taxRate: { type: Number, default: 18 },
        taxAmount: { type: Number, default: 0 },
        total: { type: Number, required: true },
      },
    ],
    required: true,
  })
  items: Array<{
    itemName: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxAmount: number;
    total: number;
  }>;

  @Prop({ required: true, default: 0 })
  subtotal: number;

  @Prop({ required: true, default: 0 })
  taxAmount: number;

  @Prop({ required: true, default: 0 })
  totalAmount: number;

  @Prop({
    type: String,
    enum: Object.values(PurchaseOrderStatus),
    default: PurchaseOrderStatus.DRAFT,
    index: true,
  })
  status: string;

  @Prop({
    type: String,
    enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID'],
    default: 'UNPAID',
    index: true,
  })
  paymentStatus: string;

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

export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);

PurchaseOrderSchema.pre<PurchaseOrderDocument>('save', async function () {
  if (!this.poNumber) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      poNumber: { $regex: /^PO-\d+$/ },
    }).sort({ poNumber: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.poNumber) {
      const match = lastDoc.poNumber.match(/PO-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ poNumber: `PO-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.poNumber = `PO-${String(nextNum).padStart(4, '0')}`;
  }
});

