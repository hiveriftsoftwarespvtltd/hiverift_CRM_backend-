import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray } from 'class-validator';
import { TemplateCategory, TemplateStatus } from '../schemas/whatsapp-template.schema';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsEnum(TemplateCategory)
  @IsNotEmpty()
  category: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  headerType?: string;

  @IsOptional()
  @IsString()
  headerText?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsOptional()
  @IsArray()
  buttons?: any[];

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  headerType?: string;

  @IsOptional()
  @IsString()
  headerText?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsOptional()
  @IsArray()
  buttons?: any[];

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: string;

  @IsOptional()
  isActive?: boolean;
}
