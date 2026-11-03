import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EquipmentCustodyDocument = EquipmentCustody & Document;

export enum EquipmentType {
  LAPTOP = 'LAPTOP',
  MONITOR = 'MONITOR',
  ACCESSORY = 'ACCESSORY',
  MOBILE = 'MOBILE',
  SECURITY_KEY = 'SECURITY_KEY',
  OTHER = 'OTHER',
}

export enum EquipmentStatus {
  AVAILABLE = 'AVAILABLE',
  ASSIGNED = 'ASSIGNED',
  UNDER_MAINTENANCE = 'UNDER_MAINTENANCE',
  RETURNED = 'RETURNED',
  LOST = 'LOST',
}

@Schema({ timestamps: true })
export class EquipmentCustody {
  @Prop({ unique: true })
  assetTag: string;

  @Prop({ required: true, trim: true })
  assetName: string;

  @Prop({
    type: String,
    enum: Object.values(EquipmentType),
    default: EquipmentType.LAPTOP,
  })
  assetType: string;

  @Prop({ trim: true })
  serialNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedTo?: Types.ObjectId;

  @Prop({ type: Date })
  issuedDate?: Date;

  @Prop({ trim: true, default: 'GOOD' })
  conditionAtIssue: string;

  @Prop({
    type: String,
    enum: Object.values(EquipmentStatus),
    default: EquipmentStatus.AVAILABLE,
    index: true,
  })
  status: string;

  @Prop({ type: Date })
  returnedDate?: Date;

  @Prop({ trim: true })
  conditionAtReturn?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  returnVerifiedBy?: Types.ObjectId;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}

export const EquipmentCustodySchema = SchemaFactory.createForClass(EquipmentCustody);

EquipmentCustodySchema.pre<EquipmentCustodyDocument>('save', async function () {
  if (!this.assetTag) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({
      assetTag: { $regex: /^AST-\d+$/ },
    }).sort({ assetTag: -1, createdAt: -1 });

    let nextNum = 1;
    if (lastDoc && lastDoc.assetTag) {
      const match = lastDoc.assetTag.match(/AST-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (
      await Model.findOne({ assetTag: `AST-${String(nextNum).padStart(4, '0')}` })
    ) {
      nextNum++;
    }
    this.assetTag = `AST-${String(nextNum).padStart(4, '0')}`;
  }
});

