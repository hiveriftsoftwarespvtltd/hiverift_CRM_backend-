import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type SettingDocument = Setting & Document;

@Schema({ timestamps: true })
export class Setting {
  @Prop({ default: 'HiveRift Softwares Pvt. Ltd.' })
  companyName: string;

  @Prop({ default: 'info@hiverift.com' })
  companyEmail: string;

  @Prop({ default: 'info@hiverift.com' })
  receiverEmail: string;

  @Prop({ default: '+91 8005550199' })
  companyPhone: string;

  @Prop({ default: 'HiveRift Tower, Tech Park' })
  companyAddress: string;

  @Prop({ default: 'https://hiverift.com' })
  companyWebsite: string;

  @Prop({ default: '₹ (INR)' })
  currencySymbol: string;

  @Prop({ default: 18 })
  taxRate: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy: MongooseSchema.Types.ObjectId;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
