import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  EmploymentType,
  RequisitionStatus,
  WorkplaceType,
} from '../schemas/job-requisition.schema';

export class CreateJobRequisitionDto {
  @IsString()
  @IsNotEmpty()
  jobTitle: string;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsNumber()
  @IsOptional()
  openingsCount?: number;

  @IsNumber()
  @IsOptional()
  minExperienceYears?: number;

  @IsNumber()
  @IsOptional()
  maxExperienceYears?: number;

  @IsNumber()
  @IsOptional()
  minSalaryBudget?: number;

  @IsNumber()
  @IsOptional()
  maxSalaryBudget?: number;

  @IsEnum(EmploymentType)
  @IsOptional()
  employmentType?: EmploymentType;

  @IsEnum(WorkplaceType)
  @IsOptional()
  workplaceType?: WorkplaceType;

  @IsString()
  @IsOptional()
  jobDescription?: string;

  @IsArray()
  @IsOptional()
  skillsRequired?: string[];

  @IsEnum(RequisitionStatus)
  @IsOptional()
  status?: RequisitionStatus;

  @IsString()
  @IsOptional()
  hiringManager?: string;
}

