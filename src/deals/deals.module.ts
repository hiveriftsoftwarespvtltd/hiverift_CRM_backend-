import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { Deal, DealSchema } from './schemas/deal.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Client.name, schema: ClientSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}

