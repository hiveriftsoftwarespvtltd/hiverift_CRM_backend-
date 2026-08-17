import { Controller, Get, UseGuards } from '@nestjs/common';
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
  @Roles('admin', 'management')
  async getAdminDashboard() {
    const data = await this.dashboardService.getAdminDashboard();
    return { message: 'Admin dashboard', data };
  }

  @Get('sales')
  @Roles('admin', 'management', 'sales')
  async getSalesDashboard(@CurrentUser() user: any) {
    const data = await this.dashboardService.getSalesDashboard(user._id.toString());
    return { message: 'Sales dashboard', data };
  }

  @Get('tech')
  @Roles('admin', 'management', 'development', 'digital_marketing')
  async getTechDashboard(@CurrentUser() user: any) {
    const data = await this.dashboardService.getTechDashboard(user._id.toString());
    return { message: 'Tech dashboard', data };
  }

  @Get('hr')
  @Roles('admin', 'management', 'hr')
  async getHRDashboard() {
    const data = await this.dashboardService.getHRDashboard();
    return { message: 'HR dashboard', data };
  }
}
