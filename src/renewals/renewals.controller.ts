import { Controller, Get, Post, Body, Put, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { RenewalsService } from './renewals.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('renewals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RenewalsController {
  constructor(private readonly renewalsService: RenewalsService) {}

  @Post()
  async create(@Body() dto: any, @CurrentUser() user: any) {
    const renewal = await this.renewalsService.create(dto, user._id.toString());
    return { message: 'Renewal created', data: renewal };
  }

  @Get()
  async findAll(@Query() query: any) {
    const result = await this.renewalsService.findAll(query);
    return { message: 'Renewals fetched', data: result };
  }

  @Get('dashboard')
  async getDashboard() {
    const data = await this.renewalsService.getDashboard();
    return { message: 'Renewal dashboard', data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const renewal = await this.renewalsService.findOne(id);
    return { message: 'Renewal fetched', data: renewal };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    const renewal = await this.renewalsService.update(id, dto);
    return { message: 'Renewal updated', data: renewal };
  }

  @Put(':id/renew')
  async renew(@Param('id') id: string, @Body() body: { newExpiryDate: Date; amount?: number }) {
    const renewal = await this.renewalsService.renew(id, body.newExpiryDate, body.amount);
    return { message: 'Service renewed successfully', data: renewal };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const renewal = await this.renewalsService.delete(id);
    return { message: 'Renewal deleted successfully', data: renewal };
  }
}
