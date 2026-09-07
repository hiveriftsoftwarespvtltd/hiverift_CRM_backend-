import { IsString, IsOptional } from 'class-validator';

export class MetaVerificationDto {
  @IsOptional()
  @IsString()
  'hub.mode'?: string;

  @IsOptional()
  @IsString()
  'hub.verify_token'?: string;

  @IsOptional()
  @IsString()
  'hub.challenge'?: string;
}

export class TestMetaIngestDto {
  @IsString()
  leadgen_id: string;

  @IsOptional()
  @IsString()
  page_id?: string;

  @IsOptional()
  @IsString()
  form_id?: string;

  @IsOptional()
  @IsString()
  ad_id?: string;

  @IsOptional()
  @IsString()
  campaign_id?: string;
}
