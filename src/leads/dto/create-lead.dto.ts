import { IsString, IsOptional, IsEmail, IsEnum, IsNumber, IsDateString, ValidateIf } from 'class-validator';
import { LeadSource } from '../schemas/lead.schema';
import { Type } from 'class-transformer';

export class CreateLeadDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.email)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  requirement?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.source)
  @IsEnum(LeadSource)
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedValue?: number;

  @IsOptional()
  @ValidateIf((o) => !!o.assignedTo)
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.nextFollowup)
  @IsDateString()
  nextFollowup?: string;
}
