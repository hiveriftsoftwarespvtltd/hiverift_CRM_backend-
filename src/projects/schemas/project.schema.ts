import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProjectDocument = Project & Document;

export enum ProjectStatus {
  ASSIGNED = 'assigned',
  STARTED = 'started',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  CLIENT_REVIEW = 'client_review',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
}

export enum ProjectDepartment {
  DIGITAL_MARKETING = 'digital_marketing',
  DEVELOPMENT = 'development',
  DESIGN = 'design',
  OTHER = 'other',
}

@Schema({ _id: false })
class ProjectNote {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  @Prop({ required: true })
  text: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;
}
const ProjectNoteSchema = SchemaFactory.createForClass(ProjectNote);

@Schema({ timestamps: true })
export class Project {
  @Prop({ unique: true })
  projectId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  client: Types.ObjectId;

  @Prop({ enum: Object.values(ProjectDepartment), required: true })
  department: string;

  @Prop({ trim: true })
  service: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedBy: Types.ObjectId;

  @Prop({ enum: Object.values(ProjectStatus), default: ProjectStatus.ASSIGNED })
  status: string;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  progress: number;

  @Prop({ required: true, type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  deadline: Date;

  @Prop({ type: Date })
  completionDate: Date;

  @Prop({ type: Number, default: 0 })
  value: number;

  @Prop()
  requirements: string;

  @Prop({ type: [Object], default: [] })
  attachments: any[];

  @Prop({ type: [ProjectNoteSchema], default: [] })
  notes: ProjectNote[];

  @Prop()
  clientReviewUrl: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadRef: Types.ObjectId;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

ProjectSchema.pre<ProjectDocument>('save', async function () {
  if (!this.projectId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ projectId: { $regex: /^PRJ-\d+$/ } }).sort({ projectId: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.projectId) {
      const match = lastDoc.projectId.match(/PRJ-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ projectId: `PRJ-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.projectId = `PRJ-${String(nextNum).padStart(4, '0')}`;
  }
});
