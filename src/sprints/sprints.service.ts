import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Sprint, SprintDocument, SprintStatus } from './schemas/sprint.schema';
import { Release, ReleaseDocument, ReleaseStatus } from './schemas/release.schema';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
  ApprovalStatus,
} from '../approvals/schemas/approval-record.schema';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { CreateReleaseDto } from './dto/create-release.dto';
import { VerifyGateDto, GoNoGoDecisionDto } from './dto/verify-gate.dto';

@Injectable()
export class SprintsService {
  constructor(
    @InjectModel(Sprint.name) private sprintModel: Model<SprintDocument>,
    @InjectModel(Release.name) private releaseModel: Model<ReleaseDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private approvalsService: ApprovalsService,
  ) {}

  // =================== SPRINTS ===================

  async createSprint(userId: string, dto: CreateSprintDto): Promise<SprintDocument> {
    const rawProjectId = dto.project || (dto as any).projectId;
    if (!rawProjectId || !Types.ObjectId.isValid(rawProjectId)) {
      throw new BadRequestException('Invalid or missing project ID');
    }

    const sprint = new this.sprintModel({
      name: dto.name,
      goal: dto.goal,
      project: new Types.ObjectId(rawProjectId),
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      capacityHours: dto.capacityHours || 0,
      createdBy: new Types.ObjectId(userId),
    });

    return sprint.save();
  }

  async findByProject(projectId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    const sprints = await this.sprintModel
      .find({ project: new Types.ObjectId(projectId) })
      .populate('createdBy', 'name email avatar')
      .sort({ startDate: -1 })
      .exec();

    const sprintIds = sprints.map((s) => s._id);
    const tasks = await this.taskModel.find({ sprint: { $in: sprintIds } }).exec();

    return sprints.map((s) => {
      const sprintTasks = tasks.filter((t) => t.sprint && t.sprint.toString() === s._id.toString());
      const taskCompletedHours = sprintTasks
        .filter((t) => t.status === TaskStatus.DONE)
        .reduce((sum, t) => sum + (t.actualHours || t.estimatedHours || 0), 0);
      const effectiveCompleted = Math.max(s.completedHours || 0, taskCompletedHours);
      return {
        ...s.toObject(),
        completedHours: effectiveCompleted,
        taskCount: sprintTasks.length,
      };
    });
  }

  async findSprintDetails(sprintId: string) {
    if (!Types.ObjectId.isValid(sprintId)) {
      throw new BadRequestException('Invalid sprint ID');
    }
    const sprint = await this.sprintModel
      .findById(sprintId)
      .populate('project', 'name projectId')
      .populate('createdBy', 'name email avatar')
      .exec();

    if (!sprint) throw new NotFoundException('Sprint not found');

    const tasks = await this.taskModel
      .find({ sprint: sprint._id })
      .populate('assignedTo', 'name email avatar')
      .sort({ priority: 1, createdAt: -1 })
      .exec();

    const totalCommitted = tasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    const totalCompleted = tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.actualHours || t.estimatedHours || 0), 0);

    return {
      sprint,
      tasks,
      stats: {
        taskCount: tasks.length,
        doneCount: tasks.filter((t) => t.status === TaskStatus.DONE).length,
        inProgressCount: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
        blockedCount: tasks.filter((t) => t.status === TaskStatus.BLOCKED).length,
        committedHours: totalCommitted,
        completedHours: totalCompleted,
      },
    };
  }

  async updateSprint(sprintId: string, dto: UpdateSprintDto): Promise<SprintDocument> {
    if (!Types.ObjectId.isValid(sprintId)) throw new BadRequestException('Invalid sprint ID');

    const sprint = await this.sprintModel.findById(sprintId);
    if (!sprint) throw new NotFoundException('Sprint not found');

    if (dto.name) sprint.name = dto.name;
    if (dto.goal !== undefined) sprint.goal = dto.goal;
    if (dto.capacityHours !== undefined) sprint.capacityHours = dto.capacityHours;
    if (dto.completedHours !== undefined) sprint.completedHours = dto.completedHours;
    if (dto.retrospectiveNotes !== undefined) sprint.retrospectiveNotes = dto.retrospectiveNotes;
    if (dto.status) sprint.status = dto.status;

    return sprint.save();
  }

  async assignTasksToSprint(sprintId: string, taskIds: string[]) {
    if (!Types.ObjectId.isValid(sprintId)) throw new BadRequestException('Invalid sprint ID');
    const sprint = await this.sprintModel.findById(sprintId);
    if (!sprint) throw new NotFoundException('Sprint not found');

    const validTaskIds = taskIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    await this.taskModel.updateMany(
      { _id: { $in: validTaskIds } },
      { $set: { sprint: sprint._id } },
    );

    return { success: true, count: validTaskIds.length };
  }

  async removeTaskFromSprint(taskId: string) {
    if (!Types.ObjectId.isValid(taskId)) throw new BadRequestException('Invalid task ID');
    await this.taskModel.findByIdAndUpdate(taskId, { $unset: { sprint: 1 } });
    return { success: true };
  }

  async getBacklog(projectId: string) {
    if (!Types.ObjectId.isValid(projectId)) throw new BadRequestException('Invalid project ID');
    return this.taskModel
      .find({
        project: new Types.ObjectId(projectId),
        sprint: { $exists: false },
        status: { $ne: TaskStatus.DONE },
      })
      .populate('assignedTo', 'name email avatar')
      .sort({ priority: 1, createdAt: -1 })
      .exec();
  }

  // =================== RELEASES ===================

  async createRelease(userId: string, dto: CreateReleaseDto): Promise<ReleaseDocument> {
    const rawProjectId = dto.project || (dto as any).projectId;
    if (!rawProjectId || !Types.ObjectId.isValid(rawProjectId)) {
      throw new BadRequestException('Invalid or missing project ID');
    }

    const defaultGates = (dto.gates && dto.gates.length > 0)
      ? dto.gates.map((g) => ({ gateName: g.gateName, passed: false, notes: g.notes }))
      : [
          { gateName: 'Automated Test Suite Passed', passed: false },
          { gateName: 'QA Smoke Test Passed', passed: false },
          { gateName: 'Security & Dependency Check', passed: false },
          { gateName: 'Tech Lead Go/No-Go Verification', passed: false },
        ];

    const release = new this.releaseModel({
      version: dto.version,
      releaseName: dto.releaseName || `Release ${dto.version}`,
      project: new Types.ObjectId(rawProjectId),
      sprint: dto.sprint && Types.ObjectId.isValid(dto.sprint) ? new Types.ObjectId(dto.sprint) : undefined,
      targetEnvironment: dto.targetEnvironment || 'STAGING',
      scheduledDate: new Date(dto.scheduledDate || (dto as any).targetDate || Date.now()),
      gitBranch: dto.gitBranch,
      gitCommitSha: dto.gitCommitSha,
      prUrl: dto.prUrl,
      gates: defaultGates,
      releaseNotes: dto.releaseNotes,
      createdBy: new Types.ObjectId(userId),
    });

    return release.save();
  }

  async findReleasesByProject(projectId: string): Promise<ReleaseDocument[]> {
    if (!Types.ObjectId.isValid(projectId)) throw new BadRequestException('Invalid project ID');
    return this.releaseModel
      .find({ project: new Types.ObjectId(projectId) })
      .populate('sprint', 'name sprintId')
      .populate('createdBy', 'name email')
      .populate('goNoGoDecidedBy', 'name email')
      .sort({ scheduledDate: -1 })
      .exec();
  }

  async verifyGate(releaseId: string, userId: string, dto: VerifyGateDto): Promise<ReleaseDocument> {
    if (!Types.ObjectId.isValid(releaseId)) throw new BadRequestException('Invalid release ID');

    const release = await this.releaseModel.findById(releaseId);
    if (!release) throw new NotFoundException('Release not found');

    const gate = release.gates.find((g) => g.gateName === dto.gateName);
    if (!gate) {
      release.gates.push({
        gateName: dto.gateName,
        passed: dto.passed,
        evidenceUrl: dto.evidenceUrl,
        verifiedBy: new Types.ObjectId(userId),
        verifiedAt: new Date(),
        notes: dto.notes,
      });
    } else {
      gate.passed = dto.passed;
      if (dto.evidenceUrl) gate.evidenceUrl = dto.evidenceUrl;
      if (dto.notes) gate.notes = dto.notes;
      gate.verifiedBy = new Types.ObjectId(userId);
      gate.verifiedAt = new Date();
    }

    return release.save();
  }

  async decideGoNoGo(
    releaseId: string,
    userId: string,
    userRole: string,
    dto: GoNoGoDecisionDto,
  ): Promise<ReleaseDocument> {
    if (!Types.ObjectId.isValid(releaseId)) throw new BadRequestException('Invalid release ID');

    const release = await this.releaseModel.findById(releaseId);
    if (!release) throw new NotFoundException('Release not found');

    release.goNoGoDecision = dto.decision;
    release.goNoGoDecidedBy = new Types.ObjectId(userId);
    release.goNoGoDecidedAt = new Date();
    release.goNoGoNotes = dto.notes;

    if (dto.decision === 'GO') {
      release.status = ReleaseStatus.GO;
    } else {
      release.status = ReleaseStatus.NO_GO;
    }

    await release.save();

    // Log in audit approval records
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.PROJECT,
      entityId: release._id.toString(),
      approvalType: 'RELEASE_GO_NOGO',
      comments: `Release ${release.version} decision: ${dto.decision}. ${dto.notes || ''}`,
      metadata: {
        version: release.version,
        decision: dto.decision,
        targetEnvironment: release.targetEnvironment,
      },
    });

    return release;
  }
}

