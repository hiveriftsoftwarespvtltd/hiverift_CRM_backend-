import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TicketDocument = Ticket & Document;

export enum TicketStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  INVESTIGATING = 'INVESTIGATING',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TicketCategory {
  TECHNICAL = 'TECHNICAL',
  BILLING = 'BILLING',
  ACCOUNT = 'ACCOUNT',
  BUG = 'BUG',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  SUPPORT = 'SUPPORT',
  OTHER = 'OTHER',
}

@Schema({ _id: false })
export class TicketTimelineItem {
  @Prop({ required: true })
  action: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  performedBy: Types.ObjectId;

  @Prop()
  note: string;

  @Prop({ default: Date.now })
  timestamp: Date;
}
export const TicketTimelineItemSchema = SchemaFactory.createForClass(TicketTimelineItem);

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ unique: true })
  ticketId: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ enum: Object.values(TicketCategory), default: TicketCategory.TECHNICAL })
  category: string;

  @Prop({ enum: Object.values(TicketPriority), default: TicketPriority.MEDIUM })
  priority: string;

  @Prop({ enum: Object.values(TicketStatus), default: TicketStatus.OPEN })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project' })
  project: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  escalatedTo: Types.ObjectId;

  @Prop({ trim: true })
  escalationReason: string;

  @Prop({ type: Date })
  slaDueDate: Date;

  @Prop({ type: Date })
  resolvedAt: Date;

  @Prop({ type: Date })
  closedAt: Date;

  @Prop({ trim: true })
  resolutionNotes: string;

  @Prop({ type: Types.ObjectId, ref: 'Task' })
  linkedDevTask: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task' })
  linkedQaTask: Types.ObjectId;

  @Prop({ type: [TicketTimelineItemSchema], default: [] })
  timeline: TicketTimelineItem[];
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.pre<TicketDocument>('save', async function () {
  if (!this.ticketId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ ticketId: { $regex: /^TCK-\d+$/ } }).sort({ ticketId: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.ticketId) {
      const match = lastDoc.ticketId.match(/TCK-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ ticketId: `TCK-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.ticketId = `TCK-${String(nextNum).padStart(4, '0')}`;
  }
});
