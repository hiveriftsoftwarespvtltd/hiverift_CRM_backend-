import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailService } from '../common/services/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quotation.name, schema: QuotationSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService, MailService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
