import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('quotations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  async create(@Body() dto: any, @CurrentUser() user: any) {
    const q = await this.quotationsService.create(dto, user._id.toString(), user.role);
    return { message: 'Quotation created', data: q };
  }
  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.quotationsService.findAll(query, user);
    return { message: 'Quotations fetched', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.findOne(id, user);
    return { message: 'Quotation fetched', data: q };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) {
    const q = await this.quotationsService.update(id, dto, user);
    return { message: 'Quotation updated', data: q };
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }, @CurrentUser() user: any) {
    const q = await this.quotationsService.updateStatus(id, body.status, user);
    return { message: 'Quotation status updated', data: q };
  }

  @Post(':id/request-approval')
  async requestApproval(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.requestApproval(id, user);
    return { message: 'Approval request submitted to SuperAdmin', data: q };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const q = await this.quotationsService.approve(id, user);
    return { message: 'Quotation approved successfully', data: q };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: any) {
    const q = await this.quotationsService.reject(id, body.reason, user);
    return { message: 'Quotation rejected', data: q };
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.quotationsService.sendEmail(id, user);
    return { message: result.message, data: result };
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.quotationsService.sendEmail(id, user);
    return { message: result.message, data: result };
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: string[] }, @CurrentUser() user: any) {
    const result = await this.quotationsService.bulkDelete(body.ids || [], user);
    return { message: `${result.count} Quotations deleted successfully`, data: result };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.quotationsService.remove(id, user);
    return { message: 'Quotation deleted', data: null };
  }
}
