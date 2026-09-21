import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsBoolean, IsArray } from 'class-validator';
import { TaskPriority, TaskType } from '../schemas/task.schema';

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskType)
  taskType?: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  project?: string;

  @IsOptional()
  @IsString()
  milestone?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  // Cross-Department fields
  @IsOptional()
  @IsString()
  targetDepartment?: string;

  @IsOptional()
  @IsString()
  crossDeptReason?: string;

  // Deliverable fields
  @IsOptional()
  @IsString()
  deliverableType?: string;

  @IsOptional()
  @IsBoolean()
  clientReviewRequired?: boolean;

  @IsOptional()
  @IsArray()
  checklist?: Array<{ title: string; completed?: boolean }>;

  @IsOptional()
  @IsString()
  dependsOnTask?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Bug tracking fields
  @IsOptional()
  @IsString()
  bugSeverity?: string;

  @IsOptional()
  @IsString()
  bugEnvironment?: string;

  @IsOptional()
  @IsString()
  bugStepsToReproduce?: string;
}

