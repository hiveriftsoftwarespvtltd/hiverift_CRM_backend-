import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CertificationDocument = Certification & Document;

@Schema({ timestamps: true })
export class Certification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employee: Types.ObjectId;

  @Prop({ required: true, trim: true })
  certificationName: string;

  @Prop({ required: true, trim: true })
  issuingOrganization: string;

  @Prop({ trim: true })
  credentialId: string;

  @Prop({ trim: true })
  credentialUrl: string;

  @Prop({ type: Date, required: true })
  issueDate: Date;

  @Prop({ type: Date })
  expiryDate?: Date;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  verifiedBy?: Types.ObjectId;

  @Prop({ trim: true })
  notes?: string;
}

export const CertificationSchema = SchemaFactory.createForClass(Certification);

