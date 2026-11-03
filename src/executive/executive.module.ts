import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExecutiveSnapshot,
  ExecutiveSnapshotSchema,
} from './schemas/executive-snapshot.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Timesheet, TimesheetSchema } from '../timesheets/schemas/timesheet.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { GeneralLedgerModule } from '../general-ledger/general-ledger.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ExecutiveService } from './executive.service';
import { ExecutiveController } from './executive.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExecutiveSnapshot.name, schema: ExecutiveSnapshotSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Timesheet.name, schema: TimesheetSchema },
      { name: User.name, schema: UserSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
    GeneralLedgerModule,
    ReconciliationModule,
    ApprovalsModule,
  ],
  controllers: [ExecutiveController],
  providers: [ExecutiveService],
  exports: [ExecutiveService],
})
export class ExecutiveModule {}

