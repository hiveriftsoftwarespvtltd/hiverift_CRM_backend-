import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class ApproveCrossDeptDto {
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectCrossDeptDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}
