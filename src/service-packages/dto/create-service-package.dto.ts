import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum, IsBoolean, IsArray, Min } from 'class-validator';
import { ServiceCategory, BillingModel } from '../schemas/service-package.schema';

export class CreateServicePackageDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ServiceCategory)
  category?: ServiceCategory;

  @IsOptional()
  @IsEnum(BillingModel)
  billingModel?: BillingModel;

  @IsNumber()
  @Min(0)
  baseRate: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsArray()
  deliverables?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

