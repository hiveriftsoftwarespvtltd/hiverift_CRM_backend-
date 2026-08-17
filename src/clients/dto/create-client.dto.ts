import { IsString, IsOptional, IsEmail, IsArray, IsNumber, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClientDto {
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
  address?: string;

  @IsOptional()
  @IsString()
  gstNo?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.leadRef)
  @IsString()
  leadRef?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.assignedSales)
  @IsString()
  assignedSales?: string;

  @IsOptional()
  @IsArray()
  services?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
