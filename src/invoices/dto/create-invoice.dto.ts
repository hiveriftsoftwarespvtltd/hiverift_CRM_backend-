import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsEnum, IsDateString } from 'class-validator';

export class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  rate: number;

  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class CreateInvoiceDto {
  @IsString()
  @IsOptional()
  invoiceNo?: string;

  @IsString()
  @IsOptional()
  logo?: string;

  @IsString()
  @IsOptional()
  from?: string;

  @IsString()
  @IsNotEmpty()
  billTo: string;

  @IsString()
  @IsOptional()
  shipTo?: string;

  @IsOptional()
  date?: string | Date;

  @IsString()
  @IsOptional()
  paymentTerms?: string;

  @IsOptional()
  dueDate?: string | Date;

  @IsString()
  @IsOptional()
  poNumber?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsArray()
  @IsOptional()
  items?: InvoiceItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  terms?: string;

  @IsNumber()
  @IsOptional()
  subtotal?: number;

  @IsNumber()
  @IsOptional()
  taxRate?: number;

  @IsNumber()
  @IsOptional()
  taxAmount?: number;

  @IsString()
  @IsOptional()
  discountType?: string;

  @IsNumber()
  @IsOptional()
  discountValue?: number;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsNumber()
  @IsOptional()
  shipping?: number;

  @IsNumber()
  @IsOptional()
  total?: number;

  @IsNumber()
  @IsOptional()
  amountPaid?: number;

  @IsNumber()
  @IsOptional()
  balanceDue?: number;

  @IsEnum(['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  client?: string;

  @IsString()
  @IsOptional()
  lead?: string;
}

export class SendInvoiceEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  customMessage?: string;
}
