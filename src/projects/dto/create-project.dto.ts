import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, ValidateIf } from 'class-validator';
import { ProjectDepartment } from '../schemas/project.schema';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  client: string;

  @IsEnum(ProjectDepartment)
  department: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.assignedTo)
  @IsString()
  assignedTo?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  deadline: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.leadRef)
  @IsString()
  leadRef?: string;

  @IsOptional()
  attachments?: any[];
}
