import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sprint, SprintSchema } from './schemas/sprint.schema';
import { Release, ReleaseSchema } from './schemas/release.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { SprintsService } from './sprints.service';
import { SprintsController } from './sprints.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Sprint.name, schema: SprintSchema },
      { name: Release.name, schema: ReleaseSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
    ApprovalsModule,
  ],
  controllers: [SprintsController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}

