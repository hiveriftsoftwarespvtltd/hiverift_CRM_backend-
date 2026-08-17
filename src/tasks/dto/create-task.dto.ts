import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { TaskPriority } from '../schemas/task.schema';

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  project: string;

  @IsString()
  assignedTo: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
