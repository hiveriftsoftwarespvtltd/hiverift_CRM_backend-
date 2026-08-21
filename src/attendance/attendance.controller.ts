import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
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

  @Post('start-break')
  async startBreak(@CurrentUser() user: any, @Body() body: { type: string }) {
    const att = await this.attendanceService.startBreak(user._id.toString(), body.type);
    return { message: `Started ${body.type || 'break'}`, data: att };
  }

  @Post('end-break')
  async endBreak(@CurrentUser() user: any) {
    const att = await this.attendanceService.endBreak(user._id.toString());
    return { message: 'Break ended and work resumed', data: att };
  }

  @Post('reset-today')
  @Delete('reset-today')
  async resetTodayAttendance(@CurrentUser() user: any) {
    await this.attendanceService.resetToday(user._id.toString());
    return { message: 'Today attendance reset successfully', data: null };
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

  @Put(':id/overtime')
  async updateOvertime(
    @Param('id') id: string,
    @Body() body: { overtime: string; overtimeMinutes?: number },
  ) {
    const att = await this.attendanceService.updateOvertime(id, body.overtime, body.overtimeMinutes);
    return { message: 'Overtime updated successfully', data: att };
  }

  @Put(':id/edit-time')
  @Roles('admin')
  async editAttendance(
    @Param('id') id: string,
    @Body() body: { checkInTime?: string; checkOutTime?: string; status?: string; notes?: string },
  ) {
    const att = await this.attendanceService.editAttendance(id, body);
    return { message: 'Attendance updated successfully', data: att };
  }

  @Delete(':id/reset-record')
  @Roles('admin')
  async resetAttendanceRecord(@Param('id') id: string) {
    await this.attendanceService.resetRecord(id);
    return { message: 'Attendance record reset successfully' };
  }

  @Delete(':id')
  @Roles('admin', 'management', 'hr')
  async deleteAttendance(@Param('id') id: string) {
    await this.attendanceService.remove(id);
    return { message: 'Attendance record deleted successfully' };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.attendanceService.findAll(query, user);
    return { message: 'Attendance fetched', data: result };
  }
}
