import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards, Patch } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ApproveCrossDeptDto, RejectCrossDeptDto } from './dto/approve-cross-dept.dto';
import { RequestReassignDto, RejectReassignDto } from './dto/request-reassign.dto';
import { LogTimeSessionDto } from './dto/log-time-session.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles('admin', 'management')
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: any) {
    const task = await this.tasksService.create(dto, user);
    return { success: true, message: 'Task created successfully', data: task };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.tasksService.findAll(query, user);
    return { success: true, message: 'Tasks fetched successfully', data: result };
  }

  @Get('metrics/overview')
  async getMetricsOverview(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.tasksService.getDashboardTaskMetrics(query, user);
    return { success: true, message: 'Task metrics overview fetched', data };
  }

  @Get('metrics/departments')
  async getDepartmentMetrics(@CurrentUser() user: any) {
    const data = await this.tasksService.getDepartmentMetrics(user);
    return { success: true, message: 'Department task metrics fetched', data };
  }

  @Get('workload/summary')
  async getWorkload(@CurrentUser() user: any) {
    const data = await this.tasksService.getWorkloadSummary(user);
    return { success: true, message: 'Workload summary fetched', data };
  }

  // Workflow 3: Live timer persistence across page refresh and browser reconnection
  @Get('timer/active')
  async getActiveTimer(@CurrentUser() user: any) {
    const result = await this.tasksService.getActiveTimer(user);
    return { success: true, message: 'Active timer retrieved', data: result };
  }

  // Workflow 2 & 5: Start timer with rejection of second concurrent timer
  @Post('timer/start')
  async startTimer(@Body() body: any, @CurrentUser() user: any) {
    const entry = await this.tasksService.startTimer(body, user);
    return { success: true, message: 'Timer session started', data: entry };
  }

  // Workflow 4: Pause active timer
  @Post('timer/pause')
  async pauseTimer(@Body('timerId') timerId: string, @CurrentUser() user: any) {
    const entry = await this.tasksService.pauseTimer(user, timerId);
    return { success: true, message: 'Timer paused', data: entry };
  }

  // Workflow 4: Resume paused timer
  @Post('timer/resume')
  async resumeTimer(@Body('timerId') timerId: string, @CurrentUser() user: any) {
    const entry = await this.tasksService.resumeTimer(user, timerId);
    return { success: true, message: 'Timer resumed', data: entry };
  }

  // Workflow 4: Stop timer and accurately log actual hours
  @Post('timer/stop')
  async stopTimer(
    @Body('timerId') timerId: string,
    @Body('notes') notes: string,
    @CurrentUser() user: any,
  ) {
    const entry = await this.tasksService.stopTimer(user, timerId, notes);
    return { success: true, message: 'Timer stopped and duration logged', data: entry };
  }

  // Workflow 7: All time entries remain accurate and auditable
  @Get('timer/entries')
  async getTimeEntries(
    @Query('taskId') taskId?: string,
    @Query('projectId') projectId?: string,
    @Query('userId') userId?: string,
    @Query('dateFilter') dateFilter?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: any,
  ) {
    const entries = await this.tasksService.getTimeEntries(taskId, projectId, userId, dateFilter, startDate, endDate, user);
    return { success: true, message: 'Time entries fetched', data: entries };
  }

  @Delete('timer/entries/:id')
  async deleteTimeEntry(@Param('id') id: string, @CurrentUser() user: any) {
    await this.tasksService.deleteTimeEntry(id, user);
    return { success: true, message: 'Time entry deleted successfully', data: null };
  }

  @Post('timer/manual')
  async addManualTimeEntry(@Body() body: any, @CurrentUser() user: any) {
    const entry = await this.tasksService.addManualTimeEntry(body, user);
    return { success: true, message: 'Time logged successfully', data: entry };
  }

  // Workflow 14: Trigger check and notification dispatch for overdue and SLA risk tasks
  @Post('cron/check-sla-overdue')
  async triggerSlaOverdueAlerts() {
    const summary = await this.tasksService.checkAndNotifyOverdueAndSlaRisks();
    return { success: true, message: 'Overdue and SLA risk alerts processed', data: summary };
  }

  @Post(':id/reopen')
  async reopenTask(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.updateStatus(id, { status: 'TODO' as any, reopenReason: reason }, user);
    return { success: true, message: 'Task reopened successfully', data: task };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const task = await this.tasksService.findOne(id);
    return { success: true, message: 'Task details fetched', data: task };
  }

  @Put(':id')
  @Roles('admin', 'management')
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

  @Patch(':id/checklist/:index/toggle')
  async toggleChecklistItem(
    @Param('id') id: string,
    @Param('index') index: string,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.toggleChecklistItem(id, parseInt(index, 10), user);
    return { success: true, message: 'Checklist item toggled', data: task };
  }

  @Post(':id/comments')
  async addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.addComment(id, dto.comment, user);
    return { success: true, message: 'Comment added', data: task };
  }

  @Delete(':id/comments/:commentId')
  async removeComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.removeComment(id, commentId, user);
    return { success: true, message: 'Comment removed', data: task };
  }

  @Post(':id/attachments')
  async addAttachment(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.addAttachment(id, body, user);
    return { success: true, message: 'Attachment added', data: task };
  }

  @Delete(':id/attachments/:index')
  async removeAttachment(
    @Param('id') id: string,
    @Param('index') index: string,
    @CurrentUser() user: any,
  ) {
    const task = await this.tasksService.removeAttachment(id, parseInt(index, 10), user);
    return { success: true, message: 'Attachment removed', data: task };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.tasksService.remove(id, user);
    return { success: true, message: 'Task deleted successfully', data: null };
  }
}
