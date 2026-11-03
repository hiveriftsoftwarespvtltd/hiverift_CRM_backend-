import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PayrollService } from './payroll.service';
import {
  RunPayrollDto,
  UpsertSalaryStructureDto,
} from './dto/upsert-salary.dto';

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // ================= Salary Structures =================

  @Post('salary-structure')
  async upsertSalaryStructure(@Body() dto: UpsertSalaryStructureDto) {
    return this.payrollService.upsertSalaryStructure(dto);
  }

  @Get('salary-structures')
  async getAllSalaryStructures() {
    return this.payrollService.getAllSalaryStructures();
  }

  @Get('salary-structure/:employeeId')
  async getSalaryStructure(@Param('employeeId') employeeId: string) {
    return this.payrollService.getSalaryStructure(employeeId);
  }

  // ================= Payroll Runs =================

  @Post('runs/draft')
  async generateDraftPayroll(
    @Request() req: any,
    @Body() dto: RunPayrollDto,
  ) {
    return this.payrollService.generateDraftPayroll(req.user._id, dto);
  }

  @Post('runs/:id/approve')
  async approvePayroll(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.payrollService.approvePayroll(id, req.user._id);
  }

  @Post('runs/:id/process')
  async processPayroll(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.payrollService.processPayroll(id, req.user._id);
  }

  @Get('runs')
  async getAllPayrollRuns() {
    return this.payrollService.getAllPayrollRuns();
  }

  // ================= Payslips =================

  @Get('my-payslips')
  async getMyPayslips(@Request() req: any) {
    return this.payrollService.getMyPayslips(req.user._id);
  }

  @Get('payslips/:id')
  async getPayslipById(@Param('id') id: string) {
    return this.payrollService.getPayslipById(id);
  }
}

