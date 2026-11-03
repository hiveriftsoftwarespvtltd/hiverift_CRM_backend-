import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApprovalEntityType } from '../schemas/approval-record.schema';

export class CreateApprovalRequestDto {
  @IsEnum(ApprovalEntityType)
  @IsNotEmpty()
  entityType: ApprovalEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;

  @IsString()
  @IsOptional()
  approvalType?: string;

  @IsString()
  @IsOptional()
  assignedApprover?: string;

  @IsString()
  @IsOptional()
  approverRole?: string;

  @IsString()
  @IsOptional()
  comments?: string;

  @IsString()
  @IsOptional()
  policyRef?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

