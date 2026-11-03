import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ClientCreateTicketDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  priority?: string; // LOW, MEDIUM, HIGH, URGENT

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  project?: string;
}

