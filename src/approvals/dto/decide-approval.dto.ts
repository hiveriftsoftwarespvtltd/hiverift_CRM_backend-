import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApprovalStatus } from '../schemas/approval-record.schema';

export class DecideApprovalDto {
  @IsEnum(ApprovalStatus)
  @IsNotEmpty()
  status: ApprovalStatus;

  @IsString()
  @IsOptional()
  decisionReason?: string;

  @IsString()
  @IsOptional()
  comments?: string;
}

