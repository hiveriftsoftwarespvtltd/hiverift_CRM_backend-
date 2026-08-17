import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from './schemas/task.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { CreateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
  ) {}

  async create(dto: CreateTaskDto, userId: string): Promise<TaskDocument> {
    const payload: any = {
      ...dto,
      assignedBy: new Types.ObjectId(userId),
    };
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.assignedTo) payload.assignedTo = new Types.ObjectId(dto.assignedTo);

    const task = new this.taskModel(payload);
    const saved = await task.save();

    if (dto.project) {
      await this.syncProjectProgress(dto.project.toString());
    }

    return saved;
  }

  async findAll(query: any, user: any): Promise<{ tasks: TaskDocument[]; total: number }> {
    const { status, priority, project, assignedTo, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (['development', 'digital_marketing'].includes(user.role)) {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (project) filter.project = new Types.ObjectId(project);
    if (assignedTo) filter.assignedTo = new Types.ObjectId(assignedTo);

    // Auto-mark overdue
    await this.taskModel.updateMany(
      { status: { $in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] }, dueDate: { $lt: new Date() } },
      { status: TaskStatus.OVERDUE },
    );

    const skip = (Number(page) - 1) * Number(limit);
    const [tasks, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .populate('project', 'name projectId')
        .populate('assignedTo', 'name email')
        .populate('assignedBy', 'name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ dueDate: 1, createdAt: -1 }),
      this.taskModel.countDocuments(filter),
    ]);
    return { tasks, total };
  }

  async findOne(id: string): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id)
      .populate('project', 'name projectId')
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name');
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, dto: any): Promise<TaskDocument> {
    const payload = { ...dto };
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.assignedTo) payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    const task = await this.taskModel.findByIdAndUpdate(id, payload, { new: true });
    if (!task) throw new NotFoundException('Task not found');

    if (task.project) {
      await this.syncProjectProgress(task.project.toString());
    }

    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<TaskDocument> {
    const update: any = { status };
    if (status === TaskStatus.COMPLETED) update.completedAt = new Date();
    const task = await this.taskModel.findByIdAndUpdate(id, update, { new: true });
    if (!task) throw new NotFoundException('Task not found');

    if (task.project) {
      await this.syncProjectProgress(task.project.toString());
    }

    return task;
  }

  async remove(id: string): Promise<void> {
    const task = await this.taskModel.findByIdAndDelete(id);
    if (!task) throw new NotFoundException('Task not found');
    if (task.project) {
      await this.syncProjectProgress(task.project.toString());
    }
  }

  async getProjectProgress(projectId: string): Promise<number> {
    const pObjId = new Types.ObjectId(projectId);
    const tasks = await this.taskModel.find({ $or: [{ project: pObjId }, { project: projectId }] });
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
    return Math.round((completed / tasks.length) * 100);
  }

  async syncProjectProgress(projectId: string): Promise<number> {
    try {
      const progress = await this.getProjectProgress(projectId);
      const pObjId = new Types.ObjectId(projectId);
      await this.projectModel.findOneAndUpdate(
        { $or: [{ _id: pObjId }, { _id: projectId }] },
        { progress },
      );
      return progress;
    } catch (e) {
      return 0;
    }
  }
}
