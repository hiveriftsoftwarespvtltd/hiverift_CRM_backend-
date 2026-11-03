import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { EquipmentType } from '../schemas/equipment-custody.schema';

export class CreateEquipmentDto {
  @IsString()
  @IsNotEmpty()
  assetName: string;

  @IsEnum(EquipmentType)
  @IsOptional()
  assetType?: EquipmentType;

  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @IsString()
  @IsOptional()
  conditionAtIssue?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AssignEquipmentDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  @IsOptional()
  issuedDate?: string;

  @IsString()
  @IsOptional()
  conditionAtIssue?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReturnEquipmentDto {
  @IsString()
  @IsNotEmpty()
  conditionAtReturn: string;

  @IsDateString()
  @IsOptional()
  returnedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateCertificationDto {
  @IsString()
  @IsNotEmpty()
  employee: string;

  @IsString()
  @IsNotEmpty()
  certificationName: string;

  @IsString()
  @IsNotEmpty()
  issuingOrganization: string;

  @IsString()
  @IsOptional()
  credentialId?: string;

  @IsString()
  @IsOptional()
  credentialUrl?: string;

  @IsDateString()
  @IsNotEmpty()
  issueDate: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

