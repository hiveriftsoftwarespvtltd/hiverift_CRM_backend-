import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from './schemas/purchase-order.schema';
import {
  SoftwareLicence,
  SoftwareLicenceSchema,
} from './schemas/software-licence.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { GeneralLedgerModule } from '../general-ledger/general-ledger.module';
import { ProcurementService } from './procurement.service';
import { ProcurementController } from './procurement.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: SoftwareLicence.name, schema: SoftwareLicenceSchema },
    ]),
    ApprovalsModule,
    GeneralLedgerModule,
  ],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}

