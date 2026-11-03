import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReleaseDocument = Release & Document;

export enum ReleaseStatus {
  PLANNED = 'PLANNED',
  TESTING = 'TESTING',
  GO = 'GO',
  NO_GO = 'NO_GO',
  RELEASED = 'RELEASED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum TargetEnvironment {
  STAGING = 'STAGING',
  PRODUCTION = 'PRODUCTION',
  UAT = 'UAT',
}

@Schema({ timestamps: true })
export class Release {
  @Prop({ unique: true })
  releaseId: string;

  @Prop({ required: true, trim: true })
  version: string; // e.g. "v1.2.0"

  @Prop({ required: true, trim: true })
  releaseName: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  project: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Sprint', index: true })
  sprint?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(TargetEnvironment),
    default: TargetEnvironment.STAGING,
  })
  targetEnvironment: string;

  @Prop({ type: Date, required: true })
  scheduledDate: Date;

  @Prop({ type: Date })
  releasedAt?: Date;

  @Prop({
    type: String,
    enum: Object.values(ReleaseStatus),
    default: ReleaseStatus.PLANNED,
    index: true,
  })
  status: string;

  @Prop({ trim: true })
  gitBranch?: string;

  @Prop({ trim: true })
  gitCommitSha?: string;

  @Prop({ trim: true })
  prUrl?: string;

  @Prop({
    type: [
      {
        gateName: { type: String, required: true },
        passed: { type: Boolean, default: false },
        evidenceUrl: String,
        verifiedBy: { type: Types.ObjectId, ref: 'User' },
        verifiedAt: Date,
        notes: String,
      },
    ],
    default: [],
  })
  gates: Array<{
    gateName: string;
    passed: boolean;
    evidenceUrl?: string;
    verifiedBy?: Types.ObjectId;
    verifiedAt?: Date;
    notes?: string;
  }>;

  @Prop({
    type: String,
    enum: ['PENDING', 'GO', 'NO_GO'],
    default: 'PENDING',
  })
  goNoGoDecision: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  goNoGoDecidedBy?: Types.ObjectId;

  @Prop({ type: Date })
  goNoGoDecidedAt?: Date;

  @Prop({ trim: true })
  goNoGoNotes?: string;

  @Prop({ trim: true })
  releaseNotes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const ReleaseSchema = SchemaFactory.createForClass(Release);

ReleaseSchema.pre<ReleaseDocument>('save', async function () {
  if (!this.releaseId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      releaseId: { $regex: /^REL-\d+$/ },
    }).sort({ releaseId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.releaseId) {
      const match = lastDoc.releaseId.match(/REL-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ releaseId: `REL-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.releaseId = `REL-${String(nextNum).padStart(4, '0')}`;
  }
});

