import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeliverableSignoffDto {
  @IsBoolean()
  @IsNotEmpty()
  approved: boolean;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  approvedBy?: string;
}

