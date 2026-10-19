import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Leave, LeaveSchema } from '../leaves/schemas/leave.schema';
import { TimeEntry, TimeEntrySchema } from '../tasks/schemas/time-entry.schema';
import { Setting, SettingSchema } from '../settings/schemas/setting.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: User.name, schema: UserSchema },
      { name: Leave.name, schema: LeaveSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      { name: Setting.name, schema: SettingSchema },
    ]),
  ],
  controllers: [CapacityController],
  providers: [CapacityService],
  exports: [CapacityService],
})
export class CapacityModule {}
