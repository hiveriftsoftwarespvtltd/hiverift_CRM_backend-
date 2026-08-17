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
    const q = await this.quotationsService.create(dto, user._id.toString());
    return { message: 'Quotation created', data: q };
  }
  @Get()
  async findAll(@Query() query: any) {
    const result = await this.quotationsService.findAll(query);
    return { message: 'Quotations fetched', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const q = await this.quotationsService.findOne(id);
    return { message: 'Quotation fetched', data: q };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    const q = await this.quotationsService.update(id, dto);
    return { message: 'Quotation updated', data: q };
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const q = await this.quotationsService.updateStatus(id, body.status);
    return { message: 'Quotation status updated', data: q };
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string) {
    const result = await this.quotationsService.sendEmail(id);
    return { message: result.message, data: result };
  }

  @Post(':id/send')
  async send(@Param('id') id: string) {
    const result = await this.quotationsService.sendEmail(id);
    return { message: result.message, data: result };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.quotationsService.remove(id);
    return { message: 'Quotation deleted', data: null };
  }
}
