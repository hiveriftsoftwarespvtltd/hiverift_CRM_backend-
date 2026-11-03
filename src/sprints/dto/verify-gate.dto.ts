import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyGateDto {
  @IsString()
  @IsNotEmpty()
  gateName: string;

  @IsBoolean()
  @IsNotEmpty()
  passed: boolean;

  @IsString()
  @IsOptional()
  evidenceUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class GoNoGoDecisionDto {
  @IsString()
  @IsNotEmpty()
  decision: 'GO' | 'NO_GO';

  @IsString()
  @IsOptional()
  notes?: string;
}

