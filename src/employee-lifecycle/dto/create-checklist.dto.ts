import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ChecklistType } from '../schemas/checklist.schema';

export class CreateChecklistDto {
  @IsString()
  @IsNotEmpty()
  employee: string;

  @IsEnum(ChecklistType)
  @IsNotEmpty()
  checklistType: ChecklistType;

  @IsDateString()
  @IsOptional()
  targetCompletionDate?: string;

  @IsString()
  @IsOptional()
  assignedCoordinator?: string;

  @IsArray()
  @IsOptional()
  customItems?: Array<{ taskName: string; category?: string }>;
}

export class ToggleChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  taskName: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

