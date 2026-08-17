import { IsString, IsOptional, IsArray, IsEnum, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  requirement?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UploadBatchDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactItemDto)
  contacts: ContactItemDto[];

  @IsOptional()
  @IsString()
  assignedTo?: string; // If assigned to a single user

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  splitAmongUsers?: string[]; // If auto-split equally among multiple sales users
}

export class AssignContactsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsArray()
  @IsString({ each: true })
  assignToUsers: string[];

  @IsOptional()
  @IsString()
  mode?: 'equal_split' | 'single'; // default equal_split
}

export class LogCallDto {
  @IsString()
  status: string; // 'interested' | 'callback' | 'not_interested' | 'ringing_no_answer' | 'busy' | 'switched_off' | 'invalid_wrong_number'

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  callbackTime?: string;
}
