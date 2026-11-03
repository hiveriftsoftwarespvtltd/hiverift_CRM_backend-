import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DealDocument = Deal & Document;

export enum DealStage {
  DISCOVERY = 'discovery',
  QUALIFICATION = 'qualification',
  PROPOSAL_SENT = 'proposal_sent',
  NEGOTIATION = 'negotiation',
  CLOSED_WON = 'closed_won',
  CLOSED_LOST = 'closed_lost',
}

export enum DealType {
  NEW_BUSINESS = 'new_business',
  EXISTING_BUSINESS = 'existing_business',
  RENEWAL = 'renewal',
  UPGRADE = 'upgrade',
}

export enum RevenueType {
  ONE_TIME = 'one_time',
  RECURRING_MONTHLY = 'recurring_monthly',
  RECURRING_ANNUAL = 'recurring_annual',
}

@Schema({ _id: false })
export class DealStageHistory {
  @Prop({ type: String, enum: Object.values(DealStage), required: true })
  stage: string;

  @Prop({ type: Date, default: Date.now })
  changedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  changedBy?: Types.ObjectId;

  @Prop({ type: String })
  notes?: string;
}
export const DealStageHistorySchema = SchemaFactory.createForClass(DealStageHistory);

@Schema({ timestamps: true })
export class Deal {
  @Prop({ unique: true })
  dealId: string; // e.g. DEAL-0001

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client' })
  client?: Types.ObjectId;

  @Prop({ required: true, type: Number, min: 0 })
  amount: number;

  @Prop({ type: String, default: 'INR' })
  currency: string;

  @Prop({ enum: Object.values(RevenueType), default: RevenueType.ONE_TIME })
  revenueType: string;

  @Prop({ enum: Object.values(DealType), default: DealType.NEW_BUSINESS })
  dealType: string;

  @Prop({ enum: Object.values(DealStage), default: DealStage.DISCOVERY })
  stage: string;

  @Prop({ type: Number, default: 20, min: 0, max: 100 })
  probability: number;

  @Prop({ type: Number, default: 0 })
  forecastValue: number; // amount * (probability / 100)

  @Prop({ type: Date })
  expectedCloseDate: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: [DealStageHistorySchema], default: [] })
  stageHistory: DealStageHistory[];

  @Prop({ trim: true })
  lostReason?: string;

  @Prop({ trim: true })
  notes?: string;
}

export const DealSchema = SchemaFactory.createForClass(Deal);

// Auto-generate Unique Sequential Deal ID
DealSchema.pre<DealDocument>('save', async function () {
  if (!this.dealId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ dealId: { $regex: /^DEAL-\d+$/ } }).sort({ dealId: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.dealId) {
      const match = lastDoc.dealId.match(/DEAL-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ dealId: `DEAL-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.dealId = `DEAL-${String(nextNum).padStart(4, '0')}`;
  }

  // Calculate weighted forecast value
  const prob = typeof this.probability === 'number' ? this.probability : 20;
  const amt = Number(this.amount) || 0;
  this.forecastValue = Number(((amt * prob) / 100).toFixed(2));
});

