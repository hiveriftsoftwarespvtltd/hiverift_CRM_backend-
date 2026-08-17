import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Renewal, RenewalSchema } from '../renewals/schemas/renewal.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Leave, LeaveSchema } from '../leaves/schemas/leave.schema';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Quotation, QuotationSchema } from '../quotations/schemas/quotation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Renewal.name, schema: RenewalSchema },
      { name: Attendance.name, schema: AttendanceSchema },
      { name: User.name, schema: UserSchema },
      { name: Leave.name, schema: LeaveSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Quotation.name, schema: QuotationSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
