import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { MonitoringDevice, MonitoringDeviceSchema } from './schemas/monitoring-device.schema';
import { MonitoringHeartbeat, MonitoringHeartbeatSchema } from './schemas/monitoring-heartbeat.schema';
import { MonitoringAppSession, MonitoringAppSessionSchema } from './schemas/monitoring-app-session.schema';
import { MonitoringActivity, MonitoringActivitySchema } from './schemas/monitoring-activity.schema';
import { MonitoringPolicy, MonitoringPolicySchema } from './schemas/monitoring-policy.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MonitoringDevice.name, schema: MonitoringDeviceSchema },
      { name: MonitoringHeartbeat.name, schema: MonitoringHeartbeatSchema },
      { name: MonitoringAppSession.name, schema: MonitoringAppSessionSchema },
      { name: MonitoringActivity.name, schema: MonitoringActivitySchema },
      { name: MonitoringPolicy.name, schema: MonitoringPolicySchema },
      { name: User.name, schema: UserSchema },
      { name: Attendance.name, schema: AttendanceSchema },
    ]),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
