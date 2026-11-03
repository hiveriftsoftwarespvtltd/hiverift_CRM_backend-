import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ApprovalRecord,
  ApprovalRecordSchema,
} from './schemas/approval-record.schema';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApprovalRecord.name, schema: ApprovalRecordSchema },
    ]),
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}

