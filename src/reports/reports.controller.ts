import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'management')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  async getSalesReport(@Query() query: any) {
    const data = await this.reportsService.getSalesReport(query);
    return { message: 'Sales report', data };
  }

  @Get('projects')
  async getProjectsReport(@Query() query: any) {
    const data = await this.reportsService.getProjectsReport(query);
    return { message: 'Projects report', data };
  }

  @Get('employees')
  async getEmployeesReport(@Query() query: any) {
    const data = await this.reportsService.getEmployeesReport(query);
    return { message: 'Employees report', data };
  }

  @Get('renewals')
  async getRenewalsReport(@Query() query: any) {
    const data = await this.reportsService.getRenewalsReport(query);
    return { message: 'Renewals report', data };
  }

  @Get('finance')
  async getFinanceReport(@Query() query: any) {
    const data = await this.reportsService.getFinanceReport(query);
    return { message: 'Finance report', data };
  }
}
