import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ApproveCrossDeptDto, RejectCrossDeptDto } from './dto/approve-cross-dept.dto';
import { RequestReassignDto, RejectReassignDto } from './dto/request-reassign.dto';
import { LogTimeSessionDto } from './dto/log-time-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: any) {
    const task = await this.tasksService.create(dto, user);
    return { success: true, message: 'Task created successfully', data: task };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.tasksService.findAll(query, user);
    return { success: true, message: 'Tasks fetched successfully', data: result };
  }

  @Get('workload/summary')
  async getWorkload(@CurrentUser() user: any) {
    const data = await this.tasksService.getWorkloadSummary(user);
    return { success: true, message: 'Workload summary fetched', data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const task = await this.tasksService.findOne(id);
    return { success: true, message: 'Task details fetched', data: task };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) {
    const task = await this.tasksService.update(id, dto, user);
    return { success: true, message: 'Task updated successfully', data: task };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.updateStatus(id, dto, user);
    return { success: true, message: `Task status updated to ${dto.status}`, data: task };
  }

  @Post(':id/cross-dept/approve')
  async approveCrossDept(
    @Param('id') id: string,
    @Body() dto: ApproveCrossDeptDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.approveCrossDeptRequest(id, dto, user);
    return { success: true, message: 'Cross-Department request approved and task assigned', data: task };
  }

  @Post(':id/cross-dept/reject')
  async rejectCrossDept(
    @Param('id') id: string,
    @Body() dto: RejectCrossDeptDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.rejectCrossDeptRequest(id, dto, user);
    return { success: true, message: 'Cross-Department request rejected', data: task };
  }

  @Post(':id/reassign')
  async requestReassignment(
    @Param('id') id: string,
    @Body() dto: RequestReassignDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.requestReassignment(id, dto, user);
    return { success: true, message: 'Task transfer process initiated', data: task };
  }

  @Post(':id/reassign/approve')
  async approveReassignment(@Param('id') id: string, @CurrentUser() user: any) {
    const task = await this.tasksService.approveReassignment(id, user);
    return { success: true, message: 'Task transfer approved and reassigned successfully', data: task };
  }

  @Post(':id/reassign/reject')
  async rejectReassignment(
    @Param('id') id: string,
    @Body() dto: RejectReassignDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.rejectReassignment(id, dto, user);
    return { success: true, message: 'Task transfer request rejected', data: task };
  }

  @Post('time-session')
  async logTimeSession(@Body() dto: LogTimeSessionDto, @CurrentUser() user: any) {
    const entry = await this.tasksService.logTimeSession(dto, user);
    return { success: true, message: 'Time entry logged successfully', data: entry };
  }

  @Get(':id/audit-trail')
  async getAuditTrail(@Param('id') id: string) {
    const logs = await this.tasksService.getAuditTrail(id);
    return { success: true, message: 'Audit trail fetched', data: logs };
  }

  @Get(':projectId/progress')
  async getProgress(@Param('projectId') projectId: string) {
    const progress = await this.tasksService.getProjectProgress(projectId);
    return { success: true, message: 'Progress calculated', data: { progress } };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.tasksService.remove(id, user);
    return { success: true, message: 'Task deleted successfully', data: null };
  }
}
