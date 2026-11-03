import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JournalLineDto {
  @IsString()
  @IsNotEmpty()
  account: string; // Account ObjectId

  @IsNumber()
  @IsOptional()
  debit?: number;

  @IsNumber()
  @IsOptional()
  credit?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  referenceEntityType?: string;

  @IsString()
  @IsOptional()
  referenceEntityId?: string;
}

export class CreateJournalEntryDto {
  @IsDateString()
  @IsNotEmpty()
  entryDate: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class ReverseJournalDto {
  @IsString()
  @IsNotEmpty()
  reversalReason: string;
}

