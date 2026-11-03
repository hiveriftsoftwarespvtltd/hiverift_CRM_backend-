import { PartialType } from '@nestjs/mapped-types';
import { CreateDealDto } from './create-deal.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateDealDto extends PartialType(CreateDealDto) {
  @IsOptional()
  @IsString()
  lostReason?: string;
}

