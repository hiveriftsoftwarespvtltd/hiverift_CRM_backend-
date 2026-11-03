import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type JobRequisitionDocument = JobRequisition & Document;

export enum RequisitionStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  ON_HOLD = 'ON_HOLD',
  CLOSED = 'CLOSED',
}

export enum WorkplaceType {
  ON_SITE = 'ON_SITE',
  REMOTE = 'REMOTE',
  HYBRID = 'HYBRID',
}

export enum EmploymentType {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  CONTRACT = 'CONTRACT',
  INTERN = 'INTERN',
}

@Schema({ timestamps: true })
export class JobRequisition {
  @Prop({ unique: true })
  requisitionId: string;

  @Prop({ required: true, trim: true })
  jobTitle: string;

  @Prop({ required: true, trim: true })
  department: string;

  @Prop({ default: 1 })
  openingsCount: number;

  @Prop({ default: 0 })
  minExperienceYears: number;

  @Prop({ default: 0 })
  maxExperienceYears: number;

  @Prop({ default: 0 })
  minSalaryBudget: number;

  @Prop({ default: 0 })
  maxSalaryBudget: number;

  @Prop({
    type: String,
    enum: Object.values(EmploymentType),
    default: EmploymentType.FULL_TIME,
  })
  employmentType: string;

  @Prop({
    type: String,
    enum: Object.values(WorkplaceType),
    default: WorkplaceType.ON_SITE,
  })
  workplaceType: string;

  @Prop({ trim: true })
  jobDescription: string;

  @Prop({ type: [String], default: [] })
  skillsRequired: string[];

  @Prop({
    type: String,
    enum: Object.values(RequisitionStatus),
    default: RequisitionStatus.OPEN,
    index: true,
  })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  hiringManager: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const JobRequisitionSchema = SchemaFactory.createForClass(JobRequisition);

JobRequisitionSchema.pre<JobRequisitionDocument>('save', async function () {
  if (!this.requisitionId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      requisitionId: { $regex: /^REQ-\d+$/ },
    }).sort({ requisitionId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.requisitionId) {
      const match = lastDoc.requisitionId.match(/REQ-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ requisitionId: `REQ-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.requisitionId = `REQ-${String(nextNum).padStart(4, '0')}`;
  }
});

