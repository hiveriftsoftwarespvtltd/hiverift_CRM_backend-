import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { CheckProjectCapacityDto } from './dto/check-project.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('capacity')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CapacityController {
  constructor(private readonly capacityService: CapacityService) {}

  @Get('overview')
  async getOverview(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.capacityService.getCapacityOverview(query, user);
    return { success: true, message: 'Capacity overview fetched successfully', data };
  }

  @Get('calendar')
  async getCalendar(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.capacityService.getCalendarEvents(query, user);
    return { success: true, message: 'Calendar events fetched successfully', data };
  }

  @Post('check-project')
  async checkProjectCapacity(@Body() dto: CheckProjectCapacityDto, @CurrentUser() user: any) {
    const result = await this.capacityService.evaluateProjectCapacity(dto, user);
    return { success: true, message: 'Project capacity feasibility evaluated', data: result };
  }

  @Get('employee-check/:userId')
  async checkEmployeeCapacity(
    @Param('userId') userId: string,
    @Query('estimatedHours') estimatedHours: number,
    @Query('dueDate') dueDate: string,
  ) {
    const data = await this.capacityService.checkAssigneeCapacity(userId, Number(estimatedHours) || 0, dueDate);
    return { success: true, message: 'Employee capacity evaluated', data };
  }
}
