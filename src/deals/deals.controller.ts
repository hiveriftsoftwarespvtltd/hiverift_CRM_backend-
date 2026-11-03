import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('deals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @Roles('admin', 'management', 'sales')
  async create(@Body() dto: CreateDealDto, @CurrentUser() user: any) {
    const deal = await this.dealsService.create(dto, user);
    return { success: true, message: 'Deal created successfully', data: deal };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.dealsService.findAll(query, user);
    return { success: true, message: 'Deals fetched successfully', data: result };
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: any) {
    const summary = await this.dealsService.getPipelineSummary(user);
    return { success: true, message: 'Deal pipeline summary fetched', data: summary };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const deal = await this.dealsService.findOne(id);
    return { success: true, message: 'Deal fetched', data: deal };
  }

  @Put(':id')
  @Roles('admin', 'management', 'sales')
  async update(@Param('id') id: string, @Body() dto: UpdateDealDto, @CurrentUser() user: any) {
    const deal = await this.dealsService.update(id, dto, user);
    return { success: true, message: 'Deal updated successfully', data: deal };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async remove(@Param('id') id: string) {
    await this.dealsService.remove(id);
    return { success: true, message: 'Deal deleted successfully', data: null };
  }
}

