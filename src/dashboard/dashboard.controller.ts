import { Controller, Get, UseGuards, Header, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('admin')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Roles('admin', 'management')
  async getAdminDashboard(@Query('period') period?: string) {
    const data = await this.dashboardService.getAdminDashboard(period);
    return { message: 'Admin dashboard', data };
  }

  @Get('sales')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Roles('admin', 'management', 'sales')
  async getSalesDashboard(@CurrentUser() user: any, @Query('period') period?: string) {
    const data = await this.dashboardService.getSalesDashboard(user._id.toString(), period);
    return { message: 'Sales dashboard', data };
  }

  @Get('tech')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Roles('admin', 'management', 'development', 'digital_marketing')
  async getTechDashboard(@CurrentUser() user: any) {
    const data = await this.dashboardService.getTechDashboard(user._id.toString());
    return { message: 'Tech dashboard', data };
  }

  @Get('hr')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Roles('admin', 'management', 'hr')
  async getHRDashboard() {
    const data = await this.dashboardService.getHRDashboard();
    return { message: 'HR dashboard', data };
  }
}
