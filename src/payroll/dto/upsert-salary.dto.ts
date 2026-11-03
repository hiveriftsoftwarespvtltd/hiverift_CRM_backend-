import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpsertSalaryStructureDto {
  @IsString()
  @IsNotEmpty()
  employee: string;

  @IsNumber()
  @IsNotEmpty()
  monthlyCtc: number;

  @IsNumber()
  @IsOptional()
  basic?: number;

  @IsNumber()
  @IsOptional()
  hra?: number;

  @IsNumber()
  @IsOptional()
  specialAllowance?: number;

  @IsNumber()
  @IsOptional()
  providentFund?: number;

  @IsNumber()
  @IsOptional()
  professionalTax?: number;

  @IsNumber()
  @IsOptional()
  tds?: number;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;
}

export class RunPayrollDto {
  @IsString()
  @IsNotEmpty()
  monthYear: string; // "YYYY-MM", e.g. "2026-10"

  @IsString()
  @IsOptional()
  notes?: string;
}

