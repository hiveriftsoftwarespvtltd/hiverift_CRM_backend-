import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ServicePackageDocument = ServicePackage & Document;

export enum ServiceCategory {
  WEB_DEVELOPMENT = 'web_development',
  MOBILE_DEVELOPMENT = 'mobile_development',
  UI_UX_DESIGN = 'ui_ux_design',
  DIGITAL_MARKETING = 'digital_marketing',
  SEO = 'seo',
  CLOUD_DEVOPS = 'cloud_devops',
  MAINTENANCE = 'maintenance',
  CONSULTING = 'consulting',
  OTHER = 'other',
}

export enum BillingModel {
  FIXED_PRICE = 'fixed_price',
  HOURLY = 'hourly',
  MONTHLY_RETAINER = 'monthly_retainer',
  ANNUAL_RETAINER = 'annual_retainer',
}

@Schema({ timestamps: true })
export class ServicePackage {
  @Prop({ unique: true })
  packageCode: string; // e.g. PKG-0001

  @Prop({ required: true, trim: true })
  name: string; // e.g. "Full Stack Web App Development"

  @Prop({ trim: true })
  description?: string;

  @Prop({ enum: Object.values(ServiceCategory), default: ServiceCategory.WEB_DEVELOPMENT })
  category: string;

  @Prop({ enum: Object.values(BillingModel), default: BillingModel.FIXED_PRICE })
  billingModel: string;

  @Prop({ required: true, type: Number, min: 0 })
  baseRate: number; // e.g. 50000 or 1500 (hourly)

  @Prop({ type: String, default: 'INR' })
  currency: string;

  @Prop({ type: Number, default: 0 })
  estimatedHours?: number;

  @Prop({ type: [String], default: [] })
  deliverables: string[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const ServicePackageSchema = SchemaFactory.createForClass(ServicePackage);

ServicePackageSchema.pre<ServicePackageDocument>('save', async function () {
  if (!this.packageCode) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ packageCode: { $regex: /^PKG-\d+$/ } }).sort({ packageCode: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.packageCode) {
      const match = lastDoc.packageCode.match(/PKG-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ packageCode: `PKG-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.packageCode = `PKG-${String(nextNum).padStart(4, '0')}`;
  }
});

