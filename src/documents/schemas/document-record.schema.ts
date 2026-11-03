import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DocumentRecordDocument = DocumentRecord & Document;

export enum DocumentCategory {
  CONTRACT = 'CONTRACT',
  POLICY = 'POLICY',
  PROPOSAL = 'PROPOSAL',
  TECHNICAL_SPEC = 'TECHNICAL_SPEC',
  DELIVERABLE = 'DELIVERABLE',
  FINANCIAL = 'FINANCIAL',
  HR = 'HR',
  GENERAL = 'GENERAL',
}

@Schema({ timestamps: true })
export class DocumentRecord {
  @Prop({ unique: true })
  docId: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  description: string;

  @Prop({
    type: String,
    enum: Object.values(DocumentCategory),
    default: DocumentCategory.GENERAL,
    index: true,
  })
  category: string;

  @Prop({ required: true, trim: true })
  fileUrl: string;

  @Prop({ required: true, trim: true })
  fileName: string;

  @Prop({ default: 0 })
  fileSize: number;

  @Prop({ trim: true })
  mimeType: string;

  @Prop({ default: 1 })
  currentVersion: number;

  @Prop({
    type: [
      {
        versionNumber: { type: Number, required: true },
        fileUrl: { type: String, required: true },
        fileName: { type: String, required: true },
        fileSize: { type: Number, default: 0 },
        uploadedBy: { type: Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
        changeSummary: String,
      },
    ],
    default: [],
  })
  versions: Array<{
    versionNumber: number;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    uploadedBy?: Types.ObjectId;
    uploadedAt: Date;
    changeSummary?: string;
  }>;

  @Prop({
    type: {
      allowedRoles: { type: [String], default: [] },
      allowedDepartments: { type: [String], default: [] },
      isPublicToAllEmployees: { type: Boolean, default: true },
      linkedClient: { type: Types.ObjectId, ref: 'Client' },
    },
    default: { isPublicToAllEmployees: true },
  })
  permissions: {
    allowedRoles: string[];
    allowedDepartments: string[];
    isPublicToAllEmployees: boolean;
    linkedClient?: Types.ObjectId;
  };

  @Prop({
    type: {
      entityType: String,
      entityId: Types.ObjectId,
    },
  })
  linkedEntity?: {
    entityType: string;
    entityId: Types.ObjectId;
  };

  @Prop({ type: Date })
  expiryDate?: Date;

  @Prop({ default: false, index: true })
  isArchived: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy: Types.ObjectId;
}

export const DocumentRecordSchema = SchemaFactory.createForClass(DocumentRecord);

DocumentRecordSchema.index({ 'permissions.linkedClient': 1 });
DocumentRecordSchema.index({ 'permissions.isPublicToAllEmployees': 1 });
DocumentRecordSchema.index({ 'linkedEntity.entityType': 1, 'linkedEntity.entityId': 1 });

DocumentRecordSchema.pre<DocumentRecordDocument>('save', async function () {
  if (!this.docId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      docId: { $regex: /^DOC-\d+$/ },
    }).sort({ docId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.docId) {
      const match = lastDoc.docId.match(/DOC-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ docId: `DOC-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.docId = `DOC-${String(nextNum).padStart(4, '0')}`;
  }
});

