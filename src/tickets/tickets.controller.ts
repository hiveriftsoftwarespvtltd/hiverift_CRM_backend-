import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto, AssignTicketDto, EscalateTicketDto, ResolveTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  async create(@Body() dto: CreateTicketDto, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.create(dto, user._id ? user._id.toString() : user.id);
    return { message: 'Support ticket created successfully', data: ticket };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.ticketsService.findAll(query, user);
    return { message: 'Support tickets fetched', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const ticket = await this.ticketsService.findOne(id);
    return { message: 'Support ticket fetched', data: ticket };
  }

  @Put(':id/assign')
  async assign(@Param('id') id: string, @Body() dto: AssignTicketDto, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.assign(id, dto, user);
    return { message: 'Ticket assigned successfully', data: ticket };
  }

  @Put(':id/investigate')
  async investigate(@Param('id') id: string, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.investigate(id, user);
    return { message: 'Ticket moved to investigating status', data: ticket };
  }

  @Put(':id/escalate')
  async escalate(@Param('id') id: string, @Body() dto: EscalateTicketDto, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.escalate(id, dto, user);
    return { message: 'Ticket escalated successfully', data: ticket };
  }

  @Put(':id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ResolveTicketDto, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.resolve(id, dto, user);
    return { message: 'Ticket marked as resolved', data: ticket };
  }

  @Put(':id/close')
  async close(@Param('id') id: string, @CurrentUser() user: any) {
    const ticket = await this.ticketsService.close(id, user);
    return { message: 'Ticket closed successfully', data: ticket };
  }

  // Workflow 10: Create linked Development and QA tasks
  @Post(':id/create-linked-tasks')
  async createLinkedTasks(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.ticketsService.createLinkedTasks(id, user);
    return {
      message: 'Linked Development task and QA task created and attached to ticket successfully',
      data: result,
    };
  }
}
