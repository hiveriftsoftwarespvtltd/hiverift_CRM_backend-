import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeLifecycleService } from './employee-lifecycle.service';
import {
  CreateChecklistDto,
  ToggleChecklistItemDto,
} from './dto/create-checklist.dto';
import {
  CreateEquipmentDto,
  AssignEquipmentDto,
  ReturnEquipmentDto,
  CreateCertificationDto,
} from './dto/create-equipment.dto';

@Controller('employee-lifecycle')
@UseGuards(JwtAuthGuard)
export class EmployeeLifecycleController {
  constructor(
    private readonly lifecycleService: EmployeeLifecycleService,
  ) {}

  // ================= Checklists =================

  @Post('checklists')
  async createChecklist(@Request() req: any, @Body() dto: CreateChecklistDto) {
    return this.lifecycleService.createChecklist(req.user._id, dto);
  }

  @Get('checklists/employee/:employeeId')
  async getChecklistsForEmployee(@Param('employeeId') employeeId: string) {
    return this.lifecycleService.getChecklistsForEmployee(employeeId);
  }

  @Put('checklists/:id/toggle')
  async toggleChecklistItem(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ToggleChecklistItemDto,
  ) {
    return this.lifecycleService.toggleChecklistItem(id, req.user._id, dto);
  }

  // ================= Equipment =================

  @Post('equipment')
  async createEquipment(@Request() req: any, @Body() dto: CreateEquipmentDto) {
    return this.lifecycleService.createEquipment(req.user._id, dto);
  }

  @Get('equipment')
  async getAllEquipment(@Query() query: any) {
    return this.lifecycleService.getAllEquipment(query);
  }

  @Post('equipment/:id/assign')
  async assignEquipment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AssignEquipmentDto,
  ) {
    return this.lifecycleService.assignEquipment(id, req.user._id, dto);
  }

  @Post('equipment/:id/return')
  async returnEquipment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReturnEquipmentDto,
  ) {
    return this.lifecycleService.returnEquipment(id, req.user._id, dto);
  }

  // ================= Certifications =================

  @Post('certifications')
  async addCertification(@Body() dto: CreateCertificationDto) {
    return this.lifecycleService.addCertification(dto);
  }

  @Get('certifications/employee/:employeeId')
  async getCertificationsForEmployee(@Param('employeeId') employeeId: string) {
    return this.lifecycleService.getCertificationsForEmployee(employeeId);
  }

  @Get('certifications/expiring')
  async getExpiringCertifications(@Query('days') days?: string) {
    const daysThreshold = days ? parseInt(days, 10) : 60;
    return this.lifecycleService.getExpiringCertifications(daysThreshold);
  }
}

