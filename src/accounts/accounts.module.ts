import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { CompanyAccount, CompanyAccountSchema } from './schemas/account.schema';
import { AccountTransaction, AccountTransactionSchema } from './schemas/transaction.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CompanyAccount.name, schema: CompanyAccountSchema },
      { name: AccountTransaction.name, schema: AccountTransactionSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
