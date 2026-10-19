import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsDateString } from 'class-validator';

export class CheckProjectCapacityDto {
  @IsString()
  @IsNotEmpty()
  projectName: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsOptional()
  @IsArray()
  requiredSkills?: string[];

  @IsNumber()
  estimatedHours: number;

  @IsDateString()
  proposedStartDate: string;

  @IsDateString()
  expectedDeliveryDate: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  complexity?: string;

  @IsOptional()
  @IsArray()
  requiredRoles?: string[];
}
