import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { TicketPriority, TicketCategory } from '../schemas/ticket.schema';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  project?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  slaDueDate?: string | Date;
}

export class AssignTicketDto {
  @IsString()
  @IsNotEmpty()
  assignedTo: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class EscalateTicketDto {
  @IsString()
  @IsNotEmpty()
  escalatedTo: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ResolveTicketDto {
  @IsString()
  @IsNotEmpty()
  resolutionNotes: string;
}
