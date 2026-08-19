import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppSessionDto {
  @IsString()
  appName: string;

  @IsString()
  processName: string;

  @IsString()
  @IsOptional()
  windowTitle?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;
}

export class SyncActivityDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  deviceSecret: string;

  @IsArray()
  @IsOptional()
  sessions?: AppSessionDto[];
}
