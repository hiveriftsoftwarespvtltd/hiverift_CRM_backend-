import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeadDocument = Lead & Document;

export enum LeadStatus {
  NEW = 'new',
  ASSIGNED = 'assigned',
  CONTACTED = 'contacted',
  INTERESTED = 'interested',
  REQUIREMENT = 'requirement',
  QUOTATION = 'quotation',
  NEGOTIATION = 'negotiation',
  WON = 'won',
  LOST = 'lost',
}

export enum LeadSource {
  FACEBOOK = 'facebook',
  GOOGLE = 'google',
  WEBSITE = 'website',
  REFERRAL = 'referral',
  CALLING = 'calling',
  WHATSAPP = 'whatsapp',
  OTHER = 'other',
}

@Schema({ _id: false })
class FollowUp {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: String, enum: ['call', 'whatsapp', 'email', 'meeting'], default: 'call' })
  type: string;

  @Prop()
  notes: string;

  @Prop()
  outcome: string;

  @Prop()
  nextAction: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;
}

const FollowUpSchema = SchemaFactory.createForClass(FollowUp);

@Schema({ _id: false })
class Note {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  @Prop({ required: true })
  text: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;
}
const NoteSchema = SchemaFactory.createForClass(Note);

@Schema({ timestamps: true })
export class Lead {
  @Prop({ unique: true })
  leadId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  company: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true })
  whatsapp: string;

  @Prop({ trim: true, lowercase: true })
  email: string;

  @Prop({ trim: true })
  city: string;

  @Prop({ trim: true })
  address: string;

  @Prop()
  requirement: string;

  @Prop({ enum: Object.values(LeadSource), default: LeadSource.OTHER })
  source: string;

  @Prop({ type: Number, default: 0 })
  estimatedValue: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ enum: Object.values(LeadStatus), default: LeadStatus.NEW })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Date })
  nextFollowup: Date;

  @Prop({ type: [FollowUpSchema], default: [] })
  followups: FollowUp[];

  @Prop({ type: [NoteSchema], default: [] })
  notes: Note[];

  @Prop({ default: false })
  isConverted: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  clientRef: Types.ObjectId;

  @Prop()
  lostReason: string;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Auto-generate Unique Sequential Lead ID
LeadSchema.pre<LeadDocument>('save', async function () {
  if (!this.leadId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ leadId: { $regex: /^LEAD-\d+$/ } }).sort({ leadId: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.leadId) {
      const match = lastDoc.leadId.match(/LEAD-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    // Safeguard against any existing ID collision
    while (await Model.findOne({ leadId: `LEAD-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.leadId = `LEAD-${String(nextNum).padStart(4, '0')}`;
  }
});
