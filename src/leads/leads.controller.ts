import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateFollowupDto } from './dto/create-followup.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LeadStatus } from './schemas/lead.schema';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @Roles('admin', 'management', 'sales')
  async create(@Body() createLeadDto: CreateLeadDto, @CurrentUser() user: any) {
    const lead = await this.leadsService.create(createLeadDto, user._id.toString(), user);
    return { message: 'Lead created successfully', data: lead };
  }

  @Post('import')
  @Roles('admin', 'management', 'sales')
  async importLeads(@Body() body: { leads: any[] }, @CurrentUser() user: any) {
    const result = await this.leadsService.importLeads(body.leads || [], user._id.toString(), user);
    return { message: `${result.importedCount} Leads imported successfully`, data: result };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.leadsService.findAll(query, user);
    return { message: 'Leads fetched successfully', data: result };
  }

  @Get('stats')
  async getStats(@CurrentUser() user: any) {
    const stats = await this.leadsService.getStats(user);
    return { message: 'Lead stats', data: stats };
  }

  @Get('today-followups')
  async getTodayFollowups(@CurrentUser() user: any) {
    const followups = await this.leadsService.getTodayFollowups(user);
    return { message: 'Today follow-ups', data: followups };
  }

  @Get('upcoming-reminders')
  async getUpcomingReminders(@CurrentUser() user: any) {
    const reminders = await this.leadsService.getUpcomingReminders(user);
    return { message: 'Upcoming due reminders', data: reminders };
  }

  @Post(':id/reminder-outcome')
  @Roles('admin', 'management', 'sales')
  async logReminderOutcome(
    @Param('id') id: string,
    @Body() body: { note: string; nextFollowup?: string; status?: string },
    @CurrentUser() user: any,
  ) {
    const lead = await this.leadsService.logReminderOutcome(id, body, user);
    return { message: 'Reminder outcome logged successfully and notification sent to admin', data: lead };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const lead = await this.leadsService.findOne(id);
    return { message: 'Lead fetched', data: lead };
  }

  @Put(':id')
  @Roles('admin', 'management', 'sales')
  async update(@Param('id') id: string, @Body() updateLeadDto: UpdateLeadDto, @CurrentUser() user: any) {
    const lead = await this.leadsService.update(id, updateLeadDto, user?._id?.toString(), user);
    return { message: 'Lead updated', data: lead };
  }

  @Put(':id/status')
  @Roles('admin', 'management', 'sales')
  async updateStatus(@Param('id') id: string, @Body() body: { status: LeadStatus }, @CurrentUser() user: any) {
    const lead = await this.leadsService.updateStatus(id, body.status, undefined, user?._id?.toString());
    return { message: 'Lead status updated', data: lead };
  }

  @Put(':id/assign')
  @Roles('admin', 'management')
  async assign(@Param('id') id: string, @Body() body: { assignedTo: string }) {
    const lead = await this.leadsService.assign(id, body.assignedTo);
    return { message: 'Lead assigned successfully', data: lead };
  }

  @Post(':id/followups')
  @Roles('admin', 'management', 'sales')
  async addFollowup(@Param('id') id: string, @Body() followupDto: CreateFollowupDto, @CurrentUser() user: any) {
    const lead = await this.leadsService.addFollowup(id, followupDto, user._id.toString());
    return { message: 'Follow-up added', data: lead };
  }

  @Post(':id/notes')
  async addNote(@Param('id') id: string, @Body() body: { text: string }, @CurrentUser() user: any) {
    const lead = await this.leadsService.addNote(id, body.text, user._id.toString());
    return { message: 'Note added', data: lead };
  }

  @Delete(':id')
  @Roles('admin', 'management', 'sales')
  async remove(@Param('id') id: string) {
    await this.leadsService.remove(id);
    return { message: 'Lead deleted', data: null };
  }
}
