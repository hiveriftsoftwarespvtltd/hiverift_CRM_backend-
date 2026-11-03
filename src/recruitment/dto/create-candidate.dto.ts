import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { CandidateStage } from '../schemas/candidate.schema';

export class CreateCandidateDto {
  @IsString()
  @IsNotEmpty()
  jobRequisition: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  currentCompany?: string;

  @IsNumber()
  @IsOptional()
  currentCtc?: number;

  @IsNumber()
  @IsOptional()
  expectedCtc?: number;

  @IsNumber()
  @IsOptional()
  noticePeriodDays?: number;

  @IsString()
  @IsOptional()
  resumeUrl?: string;

  @IsEnum(CandidateStage)
  @IsOptional()
  stage?: CandidateStage;
}

