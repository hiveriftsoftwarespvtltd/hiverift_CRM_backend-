import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { EntryType } from '../schemas/time-entry.schema';

export class LogTimeSessionDto {
  @IsEnum(EntryType)
  entryType: EntryType;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsNumber()
  durationSeconds: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
