import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SprintDocument = Sprint & Document;

export enum SprintStatus {
  PLANNING = 'PLANNING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class Sprint {
  @Prop({ unique: true })
  sprintId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  goal: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  project: Types.ObjectId;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({
    type: String,
    enum: Object.values(SprintStatus),
    default: SprintStatus.PLANNING,
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  capacityHours: number;

  @Prop({ default: 0 })
  committedHours: number;

  @Prop({ default: 0 })
  completedHours: number;

  @Prop({ trim: true })
  retrospectiveNotes: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const SprintSchema = SchemaFactory.createForClass(Sprint);

SprintSchema.pre<SprintDocument>('save', async function () {
  if (!this.sprintId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      sprintId: { $regex: /^SPR-\d+$/ },
    }).sort({ sprintId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.sprintId) {
      const match = lastDoc.sprintId.match(/SPR-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ sprintId: `SPR-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.sprintId = `SPR-${String(nextNum).padStart(4, '0')}`;
  }
});

