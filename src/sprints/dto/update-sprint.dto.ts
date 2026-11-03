import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { SprintStatus } from '../schemas/sprint.schema';

export class UpdateSprintDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsEnum(SprintStatus)
  @IsOptional()
  status?: SprintStatus;

  @IsNumber()
  @IsOptional()
  capacityHours?: number;

  @IsNumber()
  @IsOptional()
  completedHours?: number;

  @IsString()
  @IsOptional()
  retrospectiveNotes?: string;
}

