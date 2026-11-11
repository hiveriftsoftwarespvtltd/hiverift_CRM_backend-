import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadRoundRobinService } from './lead-round-robin.service';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { LeadRoundRobin, LeadRoundRobinSchema } from './schemas/lead-round-robin.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { Quotation, QuotationSchema } from '../quotations/schemas/quotation.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: LeadRoundRobin.name, schema: LeadRoundRobinSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Quotation.name, schema: QuotationSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService, LeadRoundRobinService],
  exports: [LeadsService, LeadRoundRobinService],
})
export class LeadsModule {}

