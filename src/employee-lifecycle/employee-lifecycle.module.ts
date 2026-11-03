import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Checklist,
  ChecklistSchema,
} from './schemas/checklist.schema';
import {
  EquipmentCustody,
  EquipmentCustodySchema,
} from './schemas/equipment-custody.schema';
import {
  Certification,
  CertificationSchema,
} from './schemas/certification.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { EmployeeLifecycleService } from './employee-lifecycle.service';
import { EmployeeLifecycleController } from './employee-lifecycle.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Checklist.name, schema: ChecklistSchema },
      { name: EquipmentCustody.name, schema: EquipmentCustodySchema },
      { name: Certification.name, schema: CertificationSchema },
    ]),
    ApprovalsModule,
  ],
  controllers: [EmployeeLifecycleController],
  providers: [EmployeeLifecycleService],
  exports: [EmployeeLifecycleService],
})
export class EmployeeLifecycleModule {}

