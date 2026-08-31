import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { MailService } from '../common/services/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quotation.name, schema: QuotationSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService, MailService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
