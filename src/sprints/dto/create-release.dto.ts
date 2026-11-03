import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { TargetEnvironment } from '../schemas/release.schema';

export class CreateReleaseDto {
  @IsString()
  @IsNotEmpty()
  version: string;

  @IsString()
  @IsOptional()
  releaseName?: string;

  @IsString()
  @IsOptional()
  project?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  sprint?: string;

  @IsEnum(TargetEnvironment)
  @IsOptional()
  targetEnvironment?: TargetEnvironment;

  @IsDateString()
  @IsOptional()
  scheduledDate?: string;

  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @IsString()
  @IsOptional()
  gitBranch?: string;

  @IsString()
  @IsOptional()
  gitCommitSha?: string;

  @IsString()
  @IsOptional()
  prUrl?: string;

  @IsArray()
  @IsOptional()
  gates?: Array<{ gateName: string; notes?: string }>;

  @IsString()
  @IsOptional()
  releaseNotes?: string;
}

