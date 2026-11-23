import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';
import { CampaignLeadSource } from '../schemas/whatsapp-campaign.schema';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsEnum(CampaignLeadSource)
  @IsNotEmpty()
  leadSource: string;

  @IsString()
  @IsNotEmpty()
  templateId: string;

  @IsOptional()
  variableMappings?: Record<string, string>;

  @IsOptional()
  @IsString()
  scheduleType?: string;

  @IsOptional()
  scheduledAt?: string;

  @IsOptional()
  @IsNumber()
  delaySeconds?: number;

  @IsArray()
  @IsNotEmpty()
  recipientIds: string[]; // Either Lead IDs or ImportedLead IDs depending on leadSource
}
