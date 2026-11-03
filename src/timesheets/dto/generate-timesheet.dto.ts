import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateTimesheetDto {
  @IsDateString()
  @IsNotEmpty()
  periodStartDate: string; // YYYY-MM-DD (Monday)

  @IsDateString()
  @IsNotEmpty()
  periodEndDate: string; // YYYY-MM-DD (Sunday)

  @IsString()
  @IsOptional()
  employeeId?: string; // Optional for admin generating on behalf
}

export class ApproveTimesheetDto {
  @IsNotEmpty()
  action: 'APPROVE' | 'REJECT';

  @IsString()
  @IsOptional()
  comments?: string;

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

