import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ClientPortalService } from './client-portal.service';
import { DeliverableSignoffDto } from './dto/deliverable-signoff.dto';
import { ClientCreateTicketDto } from './dto/client-create-ticket.dto';

@Controller('client-portal')
@UseGuards(JwtAuthGuard)
export class ClientPortalController {
  constructor(private readonly clientPortalService: ClientPortalService) {}

  @Get('overview')
  async getOverview(@Request() req: any) {
    return this.clientPortalService.getOverview(req.user);
  }

  @Get('projects')
  async getProjects(@Request() req: any) {
    return this.clientPortalService.getProjects(req.user);
  }

  @Get('projects/:id')
  async getProjectDetails(@Request() req: any, @Param('id') id: string) {
    return this.clientPortalService.getProjectDetails(req.user, id);
  }

  @Get('deliverables')
  async getDeliverables(@Request() req: any) {
    return this.clientPortalService.getDeliverables(req.user);
  }

  @Post('deliverables/:id/signoff')
  async signoffDeliverable(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: DeliverableSignoffDto,
  ) {
    return this.clientPortalService.signoffDeliverable(req.user, id, dto);
  }

  @Get('tickets')
  async getTickets(@Request() req: any) {
    return this.clientPortalService.getTickets(req.user);
  }

  @Post('tickets')
  async createTicket(
    @Request() req: any,
    @Body() dto: ClientCreateTicketDto,
  ) {
    return this.clientPortalService.createTicket(req.user, dto);
  }

  @Get('invoices')
  async getInvoices(@Request() req: any) {
    return this.clientPortalService.getInvoices(req.user);
  }
}

