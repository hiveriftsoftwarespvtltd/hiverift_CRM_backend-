import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument, ProjectStatus } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private projectModel: Model<ProjectDocument>) {}

  private async generateProjectId(): Promise<string> {
    const projects = await this.projectModel.find({}, { projectId: 1 }).lean();
    let maxNum = 0;
    for (const p of projects) {
      if (p.projectId) {
        const match = p.projectId.match(/PRJ-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.projectModel.findOne({ projectId: `PRJ-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `PRJ-${String(nextNum).padStart(4, '0')}`;
  }

  async create(dto: CreateProjectDto, userId: string): Promise<ProjectDocument> {
    const projectId = await this.generateProjectId();
    const payload: any = {
      ...dto,
      projectId,
      assignedBy: new Types.ObjectId(userId),
    };
    if (dto.client) payload.client = new Types.ObjectId(dto.client);
    if (dto.assignedTo) payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    if (dto.leadRef) payload.leadRef = new Types.ObjectId(dto.leadRef);

    const project = new this.projectModel(payload);
    return project.save();
  }

  async findAll(query: any, user: any): Promise<{ projects: ProjectDocument[]; total: number }> {
    const { search, status, department, assignedTo, client, page = 1, limit = 20 } = query;
    const filter: any = {};

    if (user && !['admin', 'management', 'super_admin'].includes(user?.role)) {
      const uId = user._id ? user._id.toString() : user.id;
      const uObjId = Types.ObjectId.isValid(uId) ? new Types.ObjectId(uId) : uId;
      filter.$and = [
        {
          $or: [
            { assignedBy: uObjId },
            { assignedBy: uId },
            { assignedTo: uObjId },
            { assignedTo: uId },
          ],
        },
      ];
    }

    if (search) {
      const searchOr = [{ name: { $regex: search, $options: 'i' } }, { projectId: { $regex: search, $options: 'i' } }];
      if (filter.$and) {
        filter.$and.push({ $or: searchOr });
      } else {
        filter.$or = searchOr;
      }
    }
    if (status) filter.status = status;
    if (department) filter.department = department;
    if (assignedTo) filter.assignedTo = new Types.ObjectId(assignedTo);
    if (client) filter.client = new Types.ObjectId(client);

    const skip = (Number(page) - 1) * Number(limit);
    const [projects, total] = await Promise.all([
      this.projectModel
        .find(filter)
        .populate('client', 'name company')
        .populate('assignedTo', 'name email')
        .populate('assignedBy', 'name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.projectModel.countDocuments(filter),
    ]);
    return { projects, total };
  }

  async findOne(id: string, user?: any): Promise<ProjectDocument> {
    const project = await this.projectModel
      .findById(id)
      .populate('client', 'name company email phone address')
      .populate('assignedTo', 'name email role department')
      .populate('assignedBy', 'name email')
      .populate('notes.createdBy', 'name');
    if (!project) throw new NotFoundException('Project not found');

    if (user && !['admin', 'management', 'super_admin'].includes(user?.role)) {
      const uId = user._id ? user._id.toString() : user.id;
      const assignedByStr = project.assignedBy?._id ? project.assignedBy._id.toString() : project.assignedBy?.toString();
      const assignedToStr = project.assignedTo?._id ? project.assignedTo._id.toString() : project.assignedTo?.toString();

      if (assignedByStr !== uId && assignedToStr !== uId) {
        throw new NotFoundException('Project not found');
      }
    }

    return project;
  }

  async update(id: string, dto: any): Promise<ProjectDocument> {
    const payload: any = { ...dto };
    if (dto.assignedTo) payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    const project = await this.projectModel.findByIdAndUpdate(id, payload, { new: true });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async updateStatus(id: string, status: string): Promise<ProjectDocument> {
    const update: any = { status };
    if (status === ProjectStatus.COMPLETED) {
      update.completionDate = new Date();
      update.progress = 100;
    }
    const project = await this.projectModel.findByIdAndUpdate(id, update, { new: true });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async updateProgress(id: string, progress: number): Promise<ProjectDocument> {
    const update: any = { progress };
    if (progress === 100) {
      update.status = ProjectStatus.COMPLETED;
      update.completionDate = new Date();
    }
    const project = await this.projectModel.findByIdAndUpdate(id, update, { new: true });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async addNote(id: string, text: string, userId: string): Promise<ProjectDocument> {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');

    project.notes.push({
      _id: new Types.ObjectId(),
      text,
      createdBy: new Types.ObjectId(userId),
      createdAt: new Date(),
    } as any);

    return project.save();
  }

  async addAttachment(id: string, attachment: any, userId?: string): Promise<ProjectDocument> {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');

    const attachmentObj = {
      _id: new Types.ObjectId(),
      name: attachment.name || 'Document.pdf',
      url: attachment.url,
      fileType: attachment.fileType || 'application/pdf',
      size: attachment.size || 0,
      uploadedBy: userId ? new Types.ObjectId(userId) : undefined,
      uploadedAt: new Date(),
    };

    project.attachments = project.attachments || [];
    project.attachments.push(attachmentObj);
    await project.save();
    return this.findOne(id);
  }

  async removeAttachment(id: string, attachmentIndex: number): Promise<ProjectDocument> {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');

    if (project.attachments && project.attachments.length > attachmentIndex) {
      project.attachments.splice(attachmentIndex, 1);
      await project.save();
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const project = await this.projectModel.findByIdAndDelete(id);
    if (!project) throw new NotFoundException('Project not found');
  }

  async delete(id: string): Promise<void> {
    return this.remove(id);
  }

  async getStats(): Promise<any> {
    const [total, byStatus, byDept] = await Promise.all([
      this.projectModel.countDocuments(),
      this.projectModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.projectModel.aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ]),
    ]);
    return { total, byStatus, byDept };
  }
}
