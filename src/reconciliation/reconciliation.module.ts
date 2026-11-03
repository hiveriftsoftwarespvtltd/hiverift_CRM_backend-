import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CreditNote,
  CreditNoteSchema,
} from './schemas/credit-note.schema';
import {
  Invoice,
  InvoiceSchema,
} from '../invoices/schemas/invoice.schema';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from '../procurement/schemas/purchase-order.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { GeneralLedgerModule } from '../general-ledger/general-ledger.module';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    ApprovalsModule,
    GeneralLedgerModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}

