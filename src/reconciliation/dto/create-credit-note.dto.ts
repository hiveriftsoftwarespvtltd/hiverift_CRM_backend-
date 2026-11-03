import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { CreditNoteReason } from '../schemas/credit-note.schema';

export class CreateCreditNoteDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsNumber()
  @IsOptional()
  taxAdjustment?: number;

  @IsEnum(CreditNoteReason)
  @IsOptional()
  reason?: CreditNoteReason;

  @IsString()
  @IsOptional()
  notes?: string;
}

