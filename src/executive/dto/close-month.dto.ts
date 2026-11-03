import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CloseMonthDto {
  @IsString()
  @IsNotEmpty()
  period: string; // "YYYY-MM"

  @IsString()
  @IsOptional()
  closingNotes?: string;
}

