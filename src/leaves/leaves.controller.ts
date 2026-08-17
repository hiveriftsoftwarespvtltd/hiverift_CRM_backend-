import { Controller, Get, Post, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('leaves')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Post()
  async apply(@Body() dto: any, @CurrentUser() user: any) {
    const leave = await this.leavesService.apply(dto, user._id.toString());
    return { message: 'Leave application submitted', data: leave };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.leavesService.findAll(query, user);
    return { message: 'Leaves fetched', data: result };
  }

  @Put(':id/approve')
  @Roles('admin', 'management', 'hr')
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const leave = await this.leavesService.approve(id, user._id.toString());
    return { message: 'Leave approved', data: leave };
  }

  @Put(':id/reject')
  @Roles('admin', 'management', 'hr')
  async reject(@Param('id') id: string, @CurrentUser() user: any, @Body() body: { reason: string }) {
    const leave = await this.leavesService.reject(id, user._id.toString(), body.reason);
    return { message: 'Leave rejected', data: leave };
  }
}
