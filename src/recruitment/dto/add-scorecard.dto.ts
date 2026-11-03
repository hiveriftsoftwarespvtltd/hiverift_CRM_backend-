import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AddScorecardDto {
  @IsString()
  @IsNotEmpty()
  roundName: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsNotEmpty()
  rating: number;

  @IsIn(['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'])
  @IsNotEmpty()
  recommendation: 'STRONG_HIRE' | 'HIRE' | 'NO_HIRE' | 'STRONG_NO_HIRE';

  @IsString()
  @IsOptional()
  strengths?: string;

  @IsString()
  @IsOptional()
  weaknesses?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

