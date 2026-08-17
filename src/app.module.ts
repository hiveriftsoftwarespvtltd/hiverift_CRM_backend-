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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI') || configService.get<string>('MONGO_ATLAS_URI'),
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
    
  ],
})
export class AppModule {}
