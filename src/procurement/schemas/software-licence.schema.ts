import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SoftwareLicenceDocument = SoftwareLicence & Document;

@Schema({ timestamps: true })
export class SoftwareLicence {
  @Prop({ unique: true })
  licenceId: string;

  @Prop({ required: true, trim: true })
  softwareName: string;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', index: true })
  vendor?: Types.ObjectId;

  @Prop({ trim: true })
  licenceKeyOrPlan: string;

  @Prop({ default: 1 })
  seatsPurchased: number;

  @Prop({ default: 0 })
  seatsAssigned: number;

  @Prop({
    type: String,
    enum: ['MONTHLY', 'ANNUAL', 'ONE_TIME'],
    default: 'MONTHLY',
  })
  billingFrequency: string;

  @Prop({ type: Date, required: true })
  renewalDate: Date;

  @Prop({ default: 0 })
  costPerBillingCycle: number;

  @Prop({
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
    default: 'ACTIVE',
    index: true,
  })
  status: string;

  @Prop({
    type: [
      {
        employee: { type: Types.ObjectId, ref: 'User' },
        assignedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  assignedEmployees: Array<{
    employee: Types.ObjectId;
    assignedAt: Date;
  }>;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const SoftwareLicenceSchema = SchemaFactory.createForClass(SoftwareLicence);

SoftwareLicenceSchema.pre<SoftwareLicenceDocument>('save', async function () {
  if (!this.licenceId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      licenceId: { $regex: /^LIC-\d+$/ },
    }).sort({ licenceId: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.licenceId) {
      const match = lastDoc.licenceId.match(/LIC-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ licenceId: `LIC-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.licenceId = `LIC-${String(nextNum).padStart(4, '0')}`;
  }
});

