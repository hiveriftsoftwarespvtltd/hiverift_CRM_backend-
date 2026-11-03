import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseOrderItemDto {
  @IsString()
  @IsNotEmpty()
  itemName: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsNumber()
  @IsNotEmpty()
  unitPrice: number;

  @IsNumber()
  @IsOptional()
  taxRate?: number; // e.g. 18 for 18%
}

export class CreatePurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  vendor: string;

  @IsDateString()
  @IsNotEmpty()
  orderDate: string;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateSoftwareLicenceDto {
  @IsString()
  @IsNotEmpty()
  softwareName: string;

  @IsString()
  @IsOptional()
  vendor?: string;

  @IsString()
  @IsOptional()
  licenceKeyOrPlan?: string;

  @IsNumber()
  @IsOptional()
  seatsPurchased?: number;

  @IsString()
  @IsOptional()
  billingFrequency?: string;

  @IsDateString()
  @IsNotEmpty()
  renewalDate: string;

  @IsNumber()
  @IsOptional()
  costPerBillingCycle?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AssignSeatDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;
}

