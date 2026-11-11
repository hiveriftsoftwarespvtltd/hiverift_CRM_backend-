import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeadRoundRobinDocument = LeadRoundRobin & Document;

/**
 * Stores atomic round-robin state for automatic incoming lead distribution.
 */
@Schema({ timestamps: true })
export class LeadRoundRobin {
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  @Prop({ type: Number, default: 0 })
  assignmentCount: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastAssignedUserId?: Types.ObjectId;
}

export const LeadRoundRobinSchema = SchemaFactory.createForClass(LeadRoundRobin);

