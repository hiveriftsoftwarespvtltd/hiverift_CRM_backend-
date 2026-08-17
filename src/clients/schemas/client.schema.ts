import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ClientDocument = Client & Document;

@Schema({ timestamps: true })
export class Client {
  @Prop({ unique: true })
  clientId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  company: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true, lowercase: true })
  email: string;

  @Prop({ trim: true })
  city: string;

  @Prop({ trim: true })
  address: string;

  @Prop({ trim: true })
  gstin: string;

  @Prop({ trim: true })
  gstNo: string;

  @Prop({ trim: true })
  whatsapp: string;

  @Prop({ type: [String], default: [] })
  services: string[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  accountManager: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedSales: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadRef: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  totalRevenue: number;

  @Prop({ type: Number, default: 0 })
  totalBusiness: number;

  @Prop({ type: Number, default: 0 })
  pendingAmount: number;

  @Prop({ type: String, enum: ['active', 'inactive'], default: 'active' })
  status: string;

  @Prop()
  notes: string;
}

export const ClientSchema = SchemaFactory.createForClass(Client);

ClientSchema.pre<ClientDocument>('save', async function () {
  if (!this.clientId) {
    const Model = this.constructor as any;
    const lastDoc = await Model.findOne({ clientId: { $regex: /^CLT-\d+$/ } }).sort({ clientId: -1, createdAt: -1 });
    let nextNum = 1;
    if (lastDoc && lastDoc.clientId) {
      const match = lastDoc.clientId.match(/CLT-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    while (await Model.findOne({ clientId: `CLT-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    this.clientId = `CLT-${String(nextNum).padStart(4, '0')}`;
  }
});
