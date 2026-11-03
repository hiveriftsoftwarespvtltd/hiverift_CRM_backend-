import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { CreateReleaseDto } from './dto/create-release.dto';
import { VerifyGateDto, GoNoGoDecisionDto } from './dto/verify-gate.dto';

@Controller('sprints')
@UseGuards(JwtAuthGuard)
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Post()
  async createSprint(@Request() req: any, @Body() dto: CreateSprintDto) {
    return this.sprintsService.createSprint(req.user._id, dto);
  }

  @Get('project/:projectId')
  async findByProject(@Param('projectId') projectId: string) {
    return this.sprintsService.findByProject(projectId);
  }

  @Get('project/:projectId/backlog')
  async getBacklog(@Param('projectId') projectId: string) {
    return this.sprintsService.getBacklog(projectId);
  }

  @Get(':id')
  async findSprintDetails(@Param('id') id: string) {
    return this.sprintsService.findSprintDetails(id);
  }

  @Put(':id')
  async updateSprint(@Param('id') id: string, @Body() dto: UpdateSprintDto) {
    return this.sprintsService.updateSprint(id, dto);
  }

  @Post(':id/tasks')
  async assignTasksToSprint(
    @Param('id') id: string,
    @Body('taskIds') taskIds: string[],
  ) {
    return this.sprintsService.assignTasksToSprint(id, taskIds || []);
  }

  @Delete('tasks/:taskId')
  async removeTaskFromSprint(@Param('taskId') taskId: string) {
    return this.sprintsService.removeTaskFromSprint(taskId);
  }

  // ================= Releases =================

  @Post('releases')
  async createRelease(@Request() req: any, @Body() dto: CreateReleaseDto) {
    return this.sprintsService.createRelease(req.user._id, dto);
  }

  @Get('releases/project/:projectId')
  async findReleasesByProject(@Param('projectId') projectId: string) {
    return this.sprintsService.findReleasesByProject(projectId);
  }

  @Post('releases/:id/verify-gate')
  async verifyGate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: VerifyGateDto,
  ) {
    return this.sprintsService.verifyGate(id, req.user._id, dto);
  }

  @Post('releases/:id/go-nogo')
  async decideGoNoGo(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: GoNoGoDecisionDto,
  ) {
    return this.sprintsService.decideGoNoGo(id, req.user._id, req.user.role, dto);
  }
}

