import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ChartOfAccount,
  ChartOfAccountSchema,
} from './schemas/chart-of-account.schema';
import {
  JournalEntry,
  JournalEntrySchema,
} from './schemas/journal-entry.schema';
import {
  AccountingPeriod,
  AccountingPeriodSchema,
} from './schemas/accounting-period.schema';
import { GeneralLedgerService } from './general-ledger.service';
import { GeneralLedgerController } from './general-ledger.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChartOfAccount.name, schema: ChartOfAccountSchema },
      { name: JournalEntry.name, schema: JournalEntrySchema },
      { name: AccountingPeriod.name, schema: AccountingPeriodSchema },
    ]),
  ],
  controllers: [GeneralLedgerController],
  providers: [GeneralLedgerService],
  exports: [GeneralLedgerService],
})
export class GeneralLedgerModule {}

