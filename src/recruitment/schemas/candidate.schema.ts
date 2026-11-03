import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CandidateDocument = Candidate & Document;

export enum CandidateStage {
  APPLIED = 'APPLIED',
  SCREENING = 'SCREENING',
  INTERVIEW_SCHEDULED = 'INTERVIEW_SCHEDULED',
  OFFERED = 'OFFERED',
  HIRED = 'HIRED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class Candidate {
  @Prop({ unique: true })
  candidateId: string;

  @Prop({ type: Types.ObjectId, ref: 'JobRequisition', required: true, index: true })
  jobRequisition: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  email: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true })
  currentCompany: string;

  @Prop({ default: 0 })
  currentCtc: number;

  @Prop({ default: 0 })
  expectedCtc: number;

  @Prop({ default: 0 })
  noticePeriodDays: number;

  @Prop({ trim: true })
  resumeUrl: string;

  @Prop({
    type: String,
    enum: Object.values(CandidateStage),
    default: CandidateStage.APPLIED,
    index: true,
  })
  stage: string;

  @Prop({
    type: [
      {
        stage: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: Types.ObjectId, ref: 'User' },
        notes: String,
      },
    ],
    default: [],
  })
  stageHistory: Array<{
    stage: string;
    changedAt: Date;
    changedBy?: Types.ObjectId;
    notes?: string;
  }>;

  @Prop({
    type: [
      {
        roundName: { type: String, required: true },
        interviewer: { type: Types.ObjectId, ref: 'User' },
        rating: { type: Number, min: 1, max: 5 },
        strengths: String,
        weaknesses: String,
        recommendation: {
          type: String,
          enum: ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'],
        },
        notes: String,
        submittedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  scorecards: Array<{
    roundName: string;
    interviewer?: Types.ObjectId;
    rating: number;
    strengths?: string;
    weaknesses?: string;
    recommendation: string;
    notes?: string;
    submittedAt: Date;
  }>;

  @Prop({
    type: {
      offeredCtc: Number,
      joiningDate: Date,
      offerLetterUrl: String,
      offerStatus: {
        type: String,
        enum: ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'],
        default: 'DRAFT',
      },
    },
  })
  offerDetails?: {
    offeredCtc: number;
    joiningDate: Date;
    offerLetterUrl?: string;
    offerStatus: string;
  };

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  convertedUserId?: Types.ObjectId;

  @Prop({ trim: true })
  rejectionReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const CandidateSchema = SchemaFactory.createForClass(Candidate);

CandidateSchema.pre<CandidateDocument>('save', async function () {
  if (!this.candidateId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      candidateId: { $regex: /^CAN-\d+$/ },
    }).sort({ candidateId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.candidateId) {
      const match = lastDoc.candidateId.match(/CAN-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ candidateId: `CAN-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.candidateId = `CAN-${String(nextNum).padStart(4, '0')}`;
  }
});

