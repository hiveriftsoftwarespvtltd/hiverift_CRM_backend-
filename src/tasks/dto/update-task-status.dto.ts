import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '../schemas/task.schema';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status: TaskStatus;

  @IsOptional()
  @IsString()
  onHoldReason?: string;

  @IsOptional()
  @IsString()
  reworkNotes?: string;

  @IsOptional()
  @IsString()
  reviewComment?: string;

  @IsOptional()
  @IsString()
  bugFixSummary?: string;

  @IsOptional()
  @IsString()
  bugFixCommitLink?: string;
}
