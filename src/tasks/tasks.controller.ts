import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TaskStatus } from './schemas/task.schema';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: any) {
    const task = await this.tasksService.create(dto, user._id.toString());
    return { message: 'Task created successfully', data: task };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.tasksService.findAll(query, user);
    return { message: 'Tasks fetched', data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const task = await this.tasksService.findOne(id);
    return { message: 'Task fetched', data: task };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    const task = await this.tasksService.update(id, dto);
    return { message: 'Task updated', data: task };
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: TaskStatus }) {
    const task = await this.tasksService.updateStatus(id, body.status);
    return { message: 'Task status updated', data: task };
  }

  @Get(':projectId/progress')
  async getProgress(@Param('projectId') projectId: string) {
    const progress = await this.tasksService.getProjectProgress(projectId);
    return { message: 'Progress calculated', data: { progress } };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
    return { message: 'Task deleted', data: null };
  }
}
