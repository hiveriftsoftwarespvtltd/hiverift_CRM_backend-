import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('checkin')
  async checkIn(@CurrentUser() user: any, @Body() body: { notes?: string }) {
    const att = await this.attendanceService.checkIn(user._id.toString(), body.notes);
    return { message: 'Checked in successfully', data: att };
  }

  @Put('checkout')
  async checkOut(@CurrentUser() user: any) {
    const att = await this.attendanceService.checkOut(user._id.toString());
    return { message: 'Checked out successfully', data: att };
  }

  @Get('my')
  async getMyAttendance(@CurrentUser() user: any) {
    const att = await this.attendanceService.getMyAttendance(user._id.toString());
    return { message: 'My attendance', data: att };
  }

  @Get('today-summary')
  async getTodaySummary() {
    const summary = await this.attendanceService.getTodaySummary();
    return { message: 'Today summary', data: summary };
  }

  @Get('monthly-report')
  @Roles('admin', 'management', 'hr')
  async getMonthlyReport(
    @Query('year') year?: number,
    @Query('month') month?: number,
    @Query('employee') employee?: string,
  ) {
    const y = Number(year) || new Date().getFullYear();
    const m = Number(month) || new Date().getMonth() + 1;
    const report = await this.attendanceService.getMonthlyReport(y, m, employee);
    return { message: 'Monthly attendance report', data: report };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.attendanceService.findAll(query, user);
    return { message: 'Attendance fetched', data: result };
  }
}
