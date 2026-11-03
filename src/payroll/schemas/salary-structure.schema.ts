import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SalaryStructureDocument = SalaryStructure & Document;

@Schema({ timestamps: true })
export class SalaryStructure {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  employee: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  monthlyCtc: number;

  @Prop({ required: true, default: 0 })
  basic: number;

  @Prop({ required: true, default: 0 })
  hra: number;

  @Prop({ default: 0 })
  specialAllowance: number;

  @Prop({ default: 0 })
  providentFund: number; // PF deduction

  @Prop({ default: 200 })
  professionalTax: number; // PT deduction

  @Prop({ default: 0 })
  tds: number; // Income tax deduction

  @Prop({ type: Date, default: Date.now })
  effectiveFrom: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const SalaryStructureSchema = SchemaFactory.createForClass(SalaryStructure);

