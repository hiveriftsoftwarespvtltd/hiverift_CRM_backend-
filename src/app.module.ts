import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { QuotationsModule } from './quotations/quotations.module';
import { ClientsModule } from './clients/clients.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { PaymentsModule } from './payments/payments.module';
import { RenewalsModule } from './renewals/renewals.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LeavesModule } from './leaves/leaves.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CallingModule } from './calling/calling.module';
import { SeedModule } from './seed/seed.module';
import { InvoicesModule } from './invoices/invoices.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { MetaModule } from './meta/meta.module';
import { SettingsModule } from './settings/settings.module';
import { TicketsModule } from './tickets/tickets.module';
import { CapacityModule } from './capacity/capacity.module';
import { AccountsModule } from './accounts/accounts.module';
import { DealsModule } from './deals/deals.module';
import { ServicePackagesModule } from './service-packages/service-packages.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { SprintsModule } from './sprints/sprints.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { EmployeeLifecycleModule } from './employee-lifecycle/employee-lifecycle.module';
import { DocumentsModule } from './documents/documents.module';
import { TimesheetsModule } from './timesheets/timesheets.module';
import { GeneralLedgerModule } from './general-ledger/general-ledger.module';
import { ProcurementModule } from './procurement/procurement.module';
import { PayrollModule } from './payroll/payroll.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ExecutiveModule } from './executive/executive.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI') || configService.get<string>('MONGO_ATLAS_URI'),
        maxPoolSize: 15,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        family: 4,
        connectionFactory: (connection) => {
          connection.on('connected', () => {
            console.log('✅ MongoDB Atlas Connected');
          });
          connection.on('error', (err) => {
            console.error('❌ MongoDB Connection Error:', err);
          });
          return connection;
        },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    LeadsModule,
    QuotationsModule,
    ClientsModule,
    ProjectsModule,
    TasksModule,
    TicketsModule,
    PaymentsModule,
    RenewalsModule,
    AttendanceModule,
    LeavesModule,
    NotificationsModule,
    AuditModule,
    ReportsModule,
    DashboardModule,
    CallingModule,
    SeedModule,
    InvoicesModule,
    MonitoringModule,
    MetaModule,
    SettingsModule,
    CapacityModule,
    AccountsModule,
    DealsModule,
    ServicePackagesModule,
    ApprovalsModule,
    ClientPortalModule,
    SprintsModule,
    RecruitmentModule,
    EmployeeLifecycleModule,
    DocumentsModule,
    TimesheetsModule,
    GeneralLedgerModule,
    ProcurementModule,
    PayrollModule,
    ReconciliationModule,
    ExecutiveModule,
  ],
})
export class AppModule {}
