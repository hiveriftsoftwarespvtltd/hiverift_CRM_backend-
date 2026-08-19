import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { SyncActivityDto } from './dto/sync-activity.dto';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  // 1. Generate pairing token for logged-in employee (CRM Frontend)
  @Post('device/token')
  async generatePairingToken(@CurrentUser() user: any) {
    const data = await this.monitoringService.generatePairingToken(user._id.toString());
    return { message: 'Pairing token generated', data };
  }

  // 2. Register Device from Desktop Agent (Desktop Agent Client)
  @Public()
  @Post('device/register')
  async registerDevice(@Body() dto: RegisterDeviceDto, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const data = await this.monitoringService.registerDevice(dto, ip);
    return { message: 'Device registered successfully', data };
  }

  // 3. Get Device Status for Logged-in Employee (CRM Frontend)
  @Get('device/status')
  async getDeviceStatus(@CurrentUser() user: any) {
    const data = await this.monitoringService.getDeviceStatus(user._id.toString());
    return { message: 'Device status fetched', data };
  }

  // 4. Heartbeat from Desktop Agent (Desktop Agent Client)
  @Public()
  @Post('heartbeat')
  async heartbeat(@Body() dto: HeartbeatDto) {
    const data = await this.monitoringService.recordHeartbeat(dto);
    return { message: 'Heartbeat recorded', data };
  }

  // 5. Batch Sync Application Sessions from Desktop Agent
  @Public()
  @Post('activity/sync')
  async syncActivity(@Body() dto: SyncActivityDto) {
    const data = await this.monitoringService.syncActivity(dto);
    return { message: 'Activity synced successfully', data };
  }

  // 6. Admin / HR WFH Dashboard Summary Stats
  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'hr')
  async getDashboardStats(@CurrentUser() user: any) {
    const data = await this.monitoringService.getDashboardStats(user);
    return { message: 'Dashboard stats fetched', data };
  }

  // 7. Admin / HR Live Monitoring List
  @Get('live')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'hr')
  async getLiveMonitoring(@CurrentUser() user: any) {
    const data = await this.monitoringService.getLiveMonitoring(user);
    return { message: 'Live monitoring data fetched', data };
  }

  // 8. Single Employee Activity Breakdown & Timeline
  @Get('employee/:id/details')
  @UseGuards(JwtAuthGuard)
  async getEmployeeDetails(
    @Param('id') id: string,
    @Query('date') date: string,
    @CurrentUser() user: any,
  ) {
    const data = await this.monitoringService.getEmployeeDetails(id, date, user);
    return { message: 'Employee monitoring details fetched', data };
  }

  // 9. Company-wide Application Usage Analytics
  @Get('applications/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'hr')
  async getApplicationUsageSummary(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.monitoringService.getApplicationUsageSummary(query, user);
    return { message: 'Application usage summary fetched', data };
  }

  // 10. Registered Hardware Devices List
  @Get('devices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'hr')
  async getDevices() {
    const data = await this.monitoringService.getDevices();
    return { message: 'Devices list fetched', data };
  }

  // 11. Revoke Device Access
  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management')
  async revokeDevice(@Param('id') deviceId: string) {
    const data = await this.monitoringService.revokeDevice(deviceId);
    return { message: 'Device revoked', data };
  }

  // 11b. Delete Device Record Permanently
  @Delete('devices/:id/permanent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management')
  async deleteDevicePermanently(@Param('id') deviceId: string) {
    const data = await this.monitoringService.deleteDevice(deviceId);
    return { message: 'Device deleted permanently', data };
  }

  // 12. Historical WFH Reports
  @Get('reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'hr')
  async getReports(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.monitoringService.getReports(query, user);
    return { message: 'WFH Reports fetched', data };
  }

  // 13. Delete WFH Report Record
  @Delete('reports/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management')
  async deleteReport(@Param('id') id: string) {
    const data = await this.monitoringService.deleteReport(id);
    return { message: 'Report deleted successfully', data };
  }
}
