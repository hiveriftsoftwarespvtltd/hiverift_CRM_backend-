import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RequestReassignDto {
  @IsString()
  @IsNotEmpty()
  newAssignee: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class RejectReassignDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
