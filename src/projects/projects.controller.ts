import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProjectStatus } from './schemas/project.schema';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles('admin', 'management', 'sales')
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: any) {
    const project = await this.projectsService.create(dto, user._id.toString());
    return { message: 'Project created successfully', data: project };
  }

  @Get()
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    const result = await this.projectsService.findAll(query, user);
    return { message: 'Projects fetched', data: result };
  }

  @Get('stats')
  async getStats() {
    const stats = await this.projectsService.getStats();
    return { message: 'Project stats', data: stats };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const project = await this.projectsService.findOne(id);
    return { message: 'Project fetched', data: project };
  }

  @Put(':id')
  @Roles('admin', 'management', 'sales', 'development', 'digital_marketing')
  async update(@Param('id') id: string, @Body() dto: any) {
    const project = await this.projectsService.update(id, dto);
    return { message: 'Project updated', data: project };
  }

  @Put(':id/status')
  @Roles('admin', 'management', 'development', 'digital_marketing', 'sales')
  async updateStatus(@Param('id') id: string, @Body() body: { status: ProjectStatus }) {
    const project = await this.projectsService.updateStatus(id, body.status);
    return { message: 'Project status updated', data: project };
  }

  @Put(':id/progress')
  async updateProgress(@Param('id') id: string, @Body() body: { progress: number }) {
    const project = await this.projectsService.updateProgress(id, body.progress);
    return { message: 'Project progress updated', data: project };
  }

  @Post(':id/notes')
  async addNote(@Param('id') id: string, @Body() body: { text: string }, @CurrentUser() user: any) {
    const project = await this.projectsService.addNote(id, body.text, user._id.toString());
    return { message: 'Note added', data: project };
  }

  @Post(':id/attachments')
  async addAttachment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    const project = await this.projectsService.addAttachment(id, body, user?._id?.toString());
    return { message: 'Attachment added successfully', data: project };
  }

  @Delete(':id/attachments/:index')
  async removeAttachment(@Param('id') id: string, @Param('index') index: string) {
    const project = await this.projectsService.removeAttachment(id, parseInt(index, 10));
    return { message: 'Attachment removed', data: project };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async remove(@Param('id') id: string) {
    await this.projectsService.remove(id);
    return { message: 'Project deleted', data: null };
  }
}
