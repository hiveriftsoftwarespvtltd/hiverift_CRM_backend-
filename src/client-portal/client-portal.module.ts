import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ClientPortalService } from './client-portal.service';
import { ClientPortalController } from './client-portal.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
    ApprovalsModule,
  ],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
  exports: [ClientPortalService],
})
export class ClientPortalModule {}

