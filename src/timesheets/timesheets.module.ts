import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Timesheet,
  TimesheetSchema,
} from './schemas/timesheet.schema';
import {
  TimeEntry,
  TimeEntrySchema,
} from '../tasks/schemas/time-entry.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { TimesheetsService } from './timesheets.service';
import { TimesheetsController } from './timesheets.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Timesheet.name, schema: TimesheetSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
    ]),
    ApprovalsModule,
  ],
  controllers: [TimesheetsController],
  providers: [TimesheetsService],
  exports: [TimesheetsService],
})
export class TimesheetsModule {}

