import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RenewalsController } from './renewals.controller';
import { RenewalsService } from './renewals.service';
import { Renewal, RenewalSchema } from './schemas/renewal.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Renewal.name, schema: RenewalSchema }])],
  controllers: [RenewalsController],
  providers: [RenewalsService],
  exports: [RenewalsService],
})
export class RenewalsModule {}
