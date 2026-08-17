import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CallingController } from './calling.controller';
import { CallingService } from './calling.service';
import { CallingBatch, CallingBatchSchema, CallingContact, CallingContactSchema } from './schemas/calling.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallingBatch.name, schema: CallingBatchSchema },
      { name: CallingContact.name, schema: CallingContactSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CallingController],
  providers: [CallingService],
  exports: [CallingService],
})
export class CallingModule { }
