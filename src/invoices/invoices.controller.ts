import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, SendInvoiceEmailDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'management')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  async create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: any) {
    const data = await this.invoicesService.create(dto, user._id.toString());
    return { message: 'Invoice created successfully', data };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.invoicesService.findAll(query, user);
    return { message: 'Invoices fetched', data: result };
  }

  @Get('stats')
  async getStats() {
    const data = await this.invoicesService.getStats();
    return { message: 'Invoice stats fetched', data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.invoicesService.findOne(id);
    return { message: 'Invoice fetched', data };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<CreateInvoiceDto>) {
    const data = await this.invoicesService.update(id, dto);
    return { message: 'Invoice updated successfully', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.invoicesService.delete(id);
    return { message: 'Invoice deleted successfully', data: null };
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @Body() emailDto: SendInvoiceEmailDto) {
    const result = await this.invoicesService.sendEmail(id, emailDto);
    return result;
  }
}
