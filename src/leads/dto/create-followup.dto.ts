import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFollowupDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsEnum(['call', 'whatsapp', 'email', 'meeting'])
  type?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;
}
