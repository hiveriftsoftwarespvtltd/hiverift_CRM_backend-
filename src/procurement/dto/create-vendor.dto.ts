import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { VendorCategory } from '../schemas/vendor.schema';

export class CreateVendorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  gstin?: string;

  @IsString()
  @IsOptional()
  pan?: string;

  @IsEnum(VendorCategory)
  @IsOptional()
  category?: VendorCategory;

  @IsNumber()
  @IsOptional()
  paymentTermsDays?: number;

  @IsOptional()
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branch?: string;
  };
}

