import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  JobRequisition,
  JobRequisitionSchema,
} from './schemas/job-requisition.schema';
import { Candidate, CandidateSchema } from './schemas/candidate.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentController } from './recruitment.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobRequisition.name, schema: JobRequisitionSchema },
      { name: Candidate.name, schema: CandidateSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ApprovalsModule,
  ],
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}

