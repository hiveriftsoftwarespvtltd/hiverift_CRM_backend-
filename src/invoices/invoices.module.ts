import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';
import { CompanyAccount, CompanyAccountSchema } from '../accounts/schemas/account.schema';
import { AccountTransaction, AccountTransactionSchema } from '../accounts/schemas/transaction.schema';
import { MailService } from '../common/services/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: CompanyAccount.name, schema: CompanyAccountSchema },
      { name: AccountTransaction.name, schema: AccountTransactionSchema },
    ]),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, MailService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
