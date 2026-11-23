import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappImportBatchDocument = WhatsappImportBatch & Document;

@Schema({ collection: 'whatsapp_import_batches', timestamps: true })
export class WhatsappImportBatch {
  @Prop({ required: true, unique: true, index: true })
  batchId: string; // e.g. BATCH-20261121-001

  @Prop({ required: true })
  fileName: string;

  @Prop({ default: 'csv' })
  fileType: string; // csv, xlsx, xls, pdf, txt, docx, manual

  @Prop({ default: 0 })
  totalRecords: number;

  @Prop({ default: 0 })
  importedCount: number;

  @Prop({ default: 0 })
  duplicateCount: number;

  @Prop({ default: 0 })
  invalidCount: number;

  @Prop({ default: 0 })
  skippedCount: number;

  @Prop({ default: false })
  savedToCrm: boolean;

  @Prop({ default: 0 })
  crmCreatedCount: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  importedBy: Types.ObjectId;

  @Prop({ trim: true })
  importedByName?: string;
}

export const WhatsappImportBatchSchema = SchemaFactory.createForClass(WhatsappImportBatch);
WhatsappImportBatchSchema.index({ createdAt: -1 });
