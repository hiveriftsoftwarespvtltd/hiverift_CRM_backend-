import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as bcrypt from 'bcryptjs';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MANAGEMENT = 'management',
  SALES = 'sales',
  DIGITAL_MARKETING = 'digital_marketing',
  DEVELOPMENT = 'development',
  HR = 'hr',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ trim: true })
  phone: string;

  @Prop({ required: true, enum: Object.values(UserRole), default: UserRole.SALES })
  role: string;

  @Prop({ trim: true })
  department: string;

  @Prop({ trim: true })
  designation: string;

  @Prop({ trim: true })
  employeeId: string;

  @Prop()
  avatar: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Date })
  joiningDate: Date;

  @Prop({ type: String, select: false })
  refreshToken: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Hash password before save
UserSchema.pre<UserDocument>('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};
