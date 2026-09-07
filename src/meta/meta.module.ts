import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MetaWebhookService } from './meta-webhook.service';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [MetaController],
  providers: [MetaService, MetaWebhookService],
  exports: [MetaService, MetaWebhookService],
})
export class MetaModule {}
