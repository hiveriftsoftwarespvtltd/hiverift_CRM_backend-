import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappImportedLeadDocument = WhatsappImportedLead & Document;

@Schema({ collection: 'whatsapp_imported_leads', timestamps: true })
export class WhatsappImportedLead {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, index: true })
  phoneNumber: string; // 10 digits or with country code

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  company?: string;

  @Prop({ default: '91', trim: true })
  countryCode: string;

  @Prop({ default: 'manual', trim: true })
  source: string; // e.g. import_csv, import_xlsx, import_pdf, import_txt, import_docx, manual

  @Prop({ type: String, index: true })
  importBatchId?: string;

  @Prop({ type: Object, default: {} })
  customFields: Record<string, any>;

  @Prop({ default: true })
  whatsappOptIn: boolean;

  @Prop({ type: Date, default: Date.now })
  whatsappOptInAt: Date;

  @Prop({ default: 'active', enum: ['active', 'inactive', 'unsubscribed', 'bounced'] })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead', index: true })
  crmLeadId?: Types.ObjectId; // Reference if synced to CRM leads

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  ownerId?: Types.ObjectId; // Ownership identifier for access control

  @Prop({ trim: true })
  createdByName?: string;

  @Prop({ trim: true, default: 'sales' })
  createdByRole?: string;
}

export const WhatsappImportedLeadSchema = SchemaFactory.createForClass(WhatsappImportedLead);
WhatsappImportedLeadSchema.index({ phoneNumber: 1, importBatchId: 1 });
WhatsappImportedLeadSchema.index({ createdAt: -1 });
WhatsappImportedLeadSchema.index({ createdBy: 1, createdAt: -1 });
WhatsappImportedLeadSchema.index({ ownerId: 1, createdAt: -1 });
