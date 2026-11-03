import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AccountType } from '../schemas/chart-of-account.schema';

export class CreateChartOfAccountDto {
  @IsString()
  @IsNotEmpty()
  accountCode: string;

  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsEnum(AccountType)
  @IsNotEmpty()
  accountType: AccountType;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class LockPeriodDto {
  @IsString()
  @IsNotEmpty()
  periodKey: string; // "YYYY-MM"

  @IsString()
  @IsOptional()
  closingNotes?: string;
}

