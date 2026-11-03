import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VendorDocument = Vendor & Document;

export enum VendorCategory {
  HARDWARE = 'HARDWARE',
  SOFTWARE_SAAS = 'SOFTWARE_SAAS',
  FACILITY = 'FACILITY',
  CONSULTING = 'CONSULTING',
  MARKETING = 'MARKETING',
  OTHER = 'OTHER',
}

@Schema({ timestamps: true })
export class Vendor {
  @Prop({ unique: true })
  vendorId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  contactPerson: string;

  @Prop({ trim: true, lowercase: true })
  email: string;

  @Prop({ trim: true })
  phone: string;

  @Prop({ trim: true })
  gstin: string;

  @Prop({ trim: true })
  pan: string;

  @Prop({
    type: {
      bankName: String,
      accountNumber: String,
      ifscCode: String,
      branch: String,
    },
  })
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branch: string;
  };

  @Prop({
    type: String,
    enum: Object.values(VendorCategory),
    default: VendorCategory.OTHER,
    index: true,
  })
  category: string;

  @Prop({ default: 30 })
  paymentTermsDays: number;

  @Prop({ default: 'ACTIVE', index: true })
  status: string;

  @Prop({ default: 0 })
  totalSpend: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);

VendorSchema.pre<VendorDocument>('save', async function () {
  if (!this.vendorId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      vendorId: { $regex: /^VND-\d+$/ },
    }).sort({ vendorId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.vendorId) {
      const match = lastDoc.vendorId.match(/VND-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ vendorId: `VND-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.vendorId = `VND-${String(nextNum).padStart(4, '0')}`;
  }
});

