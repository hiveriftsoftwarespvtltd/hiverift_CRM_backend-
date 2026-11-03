import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOfferDto {
  @IsNumber()
  @IsNotEmpty()
  offeredCtc: number;

  @IsDateString()
  @IsNotEmpty()
  joiningDate: string;

  @IsString()
  @IsOptional()
  offerLetterUrl?: string;

  @IsString()
  @IsOptional()
  offerStatus?: string; // DRAFT, SENT, ACCEPTED, DECLINED
}

export class ConvertEmployeeDto {
  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsString()
  @IsOptional()
  designation?: string;

  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsOptional()
  initialPassword?: string;
}

