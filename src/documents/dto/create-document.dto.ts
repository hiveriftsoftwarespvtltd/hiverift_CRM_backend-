import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { DocumentCategory } from '../schemas/document-record.schema';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DocumentCategory)
  @IsOptional()
  category?: DocumentCategory;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsArray()
  @IsOptional()
  allowedRoles?: string[];

  @IsArray()
  @IsOptional()
  allowedDepartments?: string[];

  @IsBoolean()
  @IsOptional()
  isPublicToAllEmployees?: boolean;

  @IsString()
  @IsOptional()
  linkedClient?: string;

  @IsString()
  @IsOptional()
  linkedEntityType?: string;

  @IsString()
  @IsOptional()
  linkedEntityId?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}

export class AddDocumentVersionDto {
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  changeSummary?: string;
}

