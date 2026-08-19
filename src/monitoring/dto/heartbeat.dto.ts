import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class HeartbeatDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  deviceSecret: string;

  @IsString()
  @IsOptional()
  status?: string; // 'active' | 'idle' | 'break' | 'offline'

  @IsString()
  @IsOptional()
  currentApp?: string;

  @IsString()
  @IsOptional()
  windowTitle?: string;

  @IsNumber()
  @IsOptional()
  idleSeconds?: number;
}
