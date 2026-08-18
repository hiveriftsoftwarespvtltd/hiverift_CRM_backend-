import { Controller, Get, Post, Body, Put, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async create(@Body() dto: any, @CurrentUser() user: any) {
    const p = await this.paymentsService.create(dto, user._id.toString());
    return { message: 'Payment recorded', data: p };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.paymentsService.findAll(query, user);
    return { message: 'Payments fetched', data: result };
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: any) {
    const summary = await this.paymentsService.getSummary(user);
    return { message: 'Payment summary', data: summary };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    const p = await this.paymentsService.findOne(id, user);
    return { message: 'Payment fetched', data: p };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) {
    const p = await this.paymentsService.update(id, dto, user);
    return { message: 'Payment updated', data: p };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.paymentsService.remove(id, user);
    return { message: 'Payment deleted', data: null };
  }
}
