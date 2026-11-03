import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SalaryStructure,
  SalaryStructureSchema,
} from './schemas/salary-structure.schema';
import {
  PayrollRun,
  PayrollRunSchema,
} from './schemas/payroll-run.schema';
import {
  Payslip,
  PayslipSchema,
} from './schemas/payslip.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { GeneralLedgerModule } from '../general-ledger/general-ledger.module';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: PayrollRun.name, schema: PayrollRunSchema },
      { name: Payslip.name, schema: PayslipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ApprovalsModule,
    GeneralLedgerModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}

