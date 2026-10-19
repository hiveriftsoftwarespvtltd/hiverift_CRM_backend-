import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus, TicketPriority } from './schemas/ticket.schema';
import { Task, TaskDocument, TaskType, TaskStatus, TaskPriority as TaskPriorityEnum } from '../tasks/schemas/task.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto, AssignTicketDto, EscalateTicketDto, ResolveTicketDto } from './dto/create-ticket.dto';

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async sendNotification(userId: any, title: string, message: string, referenceId?: string) {
    try {
      if (!userId) return;
      const uStr = userId?._id ? userId._id.toString() : (userId?.id ? userId.id.toString() : userId.toString());
      if (Types.ObjectId.isValid(uStr)) {
        await this.notificationsService.create({
          userId: uStr,
          title,
          message,
          type: 'ticket',
          module: 'tickets',
          referenceId: referenceId?.toString(),
        });
      }
    } catch (e) {
      console.warn('Failed to dispatch ticket notification:', e.message);
    }
  }

  async create(dto: CreateTicketDto, userId: string): Promise<TicketDocument> {
    const payload: any = {
      title: dto.title,
      description: dto.description,
      category: dto.category || 'TECHNICAL',
      priority: dto.priority || TicketPriority.MEDIUM,
      createdBy: new Types.ObjectId(userId),
      timeline: [
        {
          action: 'CREATED',
          performedBy: new Types.ObjectId(userId),
          note: 'Ticket created',
          timestamp: new Date(),
        },
      ],
    };

    if (dto.client && Types.ObjectId.isValid(dto.client)) {
      payload.client = new Types.ObjectId(dto.client);
    }
    if (dto.project && Types.ObjectId.isValid(dto.project)) {
      payload.project = new Types.ObjectId(dto.project);
      if (!payload.client) {
        const prj = await this.projectModel.findById(dto.project).lean();
        if (prj && prj.client) {
          payload.client = prj.client;
        }
      }
    }

    if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) {
      payload.assignedTo = new Types.ObjectId(dto.assignedTo);
      payload.status = TicketStatus.ASSIGNED;
      payload.timeline.push({
        action: 'ASSIGNED',
        performedBy: new Types.ObjectId(userId),
        note: `Initially assigned upon creation`,
        timestamp: new Date(),
      });
    }

    if (dto.slaDueDate) {
      payload.slaDueDate = new Date(dto.slaDueDate);
    } else {
      // Default SLA: 24h for Critical, 48h for High, 72h for others
      const hours = dto.priority === TicketPriority.CRITICAL ? 24 : dto.priority === TicketPriority.HIGH ? 48 : 72;
      payload.slaDueDate = new Date(Date.now() + hours * 3600 * 1000);
    }

    const ticket = new this.ticketModel(payload);
    await ticket.save();

    if (payload.assignedTo) {
      await this.sendNotification(
        payload.assignedTo,
        'Support Ticket Assigned',
        `You have been assigned support ticket ${ticket.ticketId}: ${ticket.title}`,
        ticket._id.toString(),
      );
    }

    return this.findOne(ticket._id.toString());
  }

  async assign(id: string, dto: AssignTicketDto, user: any): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (!Types.ObjectId.isValid(dto.assignedTo)) {
      throw new BadRequestException('Invalid assignee ID');
    }

    const userId = user._id ? user._id.toString() : user.id;
    ticket.assignedTo = new Types.ObjectId(dto.assignedTo);
    ticket.status = TicketStatus.ASSIGNED;
    ticket.timeline.push({
      action: 'ASSIGNED',
      performedBy: new Types.ObjectId(userId),
      note: dto.note || 'Ticket assigned for investigation',
      timestamp: new Date(),
    });

    await ticket.save();

    await this.sendNotification(
      dto.assignedTo,
      'Support Ticket Assigned',
      `You have been assigned support ticket ${ticket.ticketId}: ${ticket.title}`,
      ticket._id.toString(),
    );

    return this.findOne(id);
  }

  async investigate(id: string, user: any): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const userId = user._id ? user._id.toString() : user.id;
    ticket.status = TicketStatus.INVESTIGATING;
    ticket.timeline.push({
      action: 'INVESTIGATING',
      performedBy: new Types.ObjectId(userId),
      note: 'Investigation started',
      timestamp: new Date(),
    });

    await ticket.save();
    return this.findOne(id);
  }

  async escalate(id: string, dto: EscalateTicketDto, user: any): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (!Types.ObjectId.isValid(dto.escalatedTo)) {
      throw new BadRequestException('Invalid escalation assignee ID');
    }

    const userId = user._id ? user._id.toString() : user.id;
    ticket.status = TicketStatus.ESCALATED;
    ticket.escalatedTo = new Types.ObjectId(dto.escalatedTo);
    ticket.escalationReason = dto.reason;
    ticket.timeline.push({
      action: 'ESCALATED',
      performedBy: new Types.ObjectId(userId),
      note: `Escalated: ${dto.reason}`,
      timestamp: new Date(),
    });

    await ticket.save();

    await this.sendNotification(
      dto.escalatedTo,
      'Support Ticket Escalated',
      `Ticket ${ticket.ticketId} escalated: ${dto.reason}`,
      ticket._id.toString(),
    );

    return this.findOne(id);
  }

  async resolve(id: string, dto: ResolveTicketDto, user: any): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const userId = user._id ? user._id.toString() : user.id;
    ticket.status = TicketStatus.RESOLVED;
    ticket.resolutionNotes = dto.resolutionNotes;
    ticket.resolvedAt = new Date();
    ticket.timeline.push({
      action: 'RESOLVED',
      performedBy: new Types.ObjectId(userId),
      note: `Resolved: ${dto.resolutionNotes}`,
      timestamp: new Date(),
    });

    await ticket.save();

    await this.sendNotification(
      ticket.createdBy,
      'Support Ticket Resolved',
      `Ticket ${ticket.ticketId} has been resolved: ${dto.resolutionNotes}`,
      ticket._id.toString(),
    );

    return this.findOne(id);
  }

  async close(id: string, user: any): Promise<TicketDocument> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const userId = user._id ? user._id.toString() : user.id;
    ticket.status = TicketStatus.CLOSED;
    ticket.closedAt = new Date();
    ticket.timeline.push({
      action: 'CLOSED',
      performedBy: new Types.ObjectId(userId),
      note: 'Ticket verified and closed',
      timestamp: new Date(),
    });

    await ticket.save();
    return this.findOne(id);
  }

  // Workflow 10: A support ticket creates a linked development task and QA task
  async createLinkedTasks(ticketId: string, user: any): Promise<{ ticket: TicketDocument; devTask: TaskDocument; qaTask: TaskDocument }> {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const userId = user._id ? user._id.toString() : user.id;

    // 1. Create Linked Development Task
    const devTask = new this.taskModel({
      title: `[DEV Fix] ${ticket.title}`,
      description: `Investigate and implement code fix for ticket ${ticket.ticketId}.\n\nTicket Description:\n${ticket.description}`,
      taskType: TaskType.BUG,
      priority: ticket.priority === 'CRITICAL' ? TaskPriorityEnum.CRITICAL : ticket.priority === 'HIGH' ? TaskPriorityEnum.HIGH : TaskPriorityEnum.MEDIUM,
      department: 'Development',
      client: ticket.client,
      project: ticket.project,
      linkedTicket: ticket._id,
      createdBy: new Types.ObjectId(userId),
      assignedManager: new Types.ObjectId(userId),
      assignedTo: ticket.assignedTo || new Types.ObjectId(userId),
      dueDate: ticket.slaDueDate || new Date(Date.now() + 48 * 3600 * 1000),
      startDate: new Date(),
      status: TaskStatus.TODO,
      reviewRequired: true,
      checklist: [
        { title: 'Replicate issue reported in ticket', completed: false },
        { title: 'Implement bug fix / logic patch', completed: false },
        { title: 'Verify fix locally and push to staging', completed: false },
      ],
    });
    await devTask.save();

    // 2. Create Linked QA Verification Task
    const qaTask = new this.taskModel({
      title: `[QA Verification] ${ticket.title}`,
      description: `Perform rigorous QA verification and regression testing for ticket ${ticket.ticketId} after DEV fix is completed.`,
      taskType: TaskType.DEPARTMENT,
      priority: ticket.priority === 'CRITICAL' ? TaskPriorityEnum.CRITICAL : TaskPriorityEnum.HIGH,
      department: 'Development',
      client: ticket.client,
      project: ticket.project,
      linkedTicket: ticket._id,
      createdBy: new Types.ObjectId(userId),
      assignedManager: new Types.ObjectId(userId),
      dueDate: new Date(Date.now() + 72 * 3600 * 1000),
      startDate: new Date(),
      status: TaskStatus.TODO,
      reviewRequired: true,
      checklist: [
        { title: 'Verify DEV fix on staging environment', completed: false },
        { title: 'Run regression tests across related workflows', completed: false },
        { title: 'Validate resolution notes with customer requirements', completed: false },
      ],
    });
    await qaTask.save();

    // Update ticket with both linked task references
    ticket.linkedDevTask = devTask._id;
    ticket.linkedQaTask = qaTask._id;
    ticket.timeline.push({
      action: 'LINKED_TASKS_CREATED',
      performedBy: new Types.ObjectId(userId),
      note: `Created linked Development Task (${devTask._id}) and QA Task (${qaTask._id})`,
      timestamp: new Date(),
    });
    await ticket.save();

    const populatedTicket = await this.findOne(ticketId);
    return { ticket: populatedTicket, devTask, qaTask };
  }

  async findAll(query: any, user?: any): Promise<{ tickets: TicketDocument[]; total: number }> {
    const { search, status, priority, category, client, project, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (client && Types.ObjectId.isValid(client)) filter.client = new Types.ObjectId(client);
    if (project && Types.ObjectId.isValid(project)) filter.project = new Types.ObjectId(project);

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { ticketId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .populate('client', 'name company phone email')
        .populate('project', 'name projectId status')
        .populate('assignedTo', 'name email role department avatar')
        .populate('createdBy', 'name email role')
        .populate('escalatedTo', 'name email role')
        .populate('linkedDevTask', 'title status priority actualHours')
        .populate('linkedQaTask', 'title status priority checklist')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.ticketModel.countDocuments(filter),
    ]);

    return { tickets, total };
  }

  async findOne(id: string): Promise<TicketDocument> {
    const ticket = await this.ticketModel
      .findById(id)
      .populate('client', 'name company phone email whatsapp')
      .populate('project', 'name projectId status')
      .populate('assignedTo', 'name email role department avatar')
      .populate('createdBy', 'name email role')
      .populate('escalatedTo', 'name email role')
      .populate('linkedDevTask', 'title status priority actualHours assignedTo')
      .populate('linkedQaTask', 'title status priority checklist assignedTo')
      .populate('timeline.performedBy', 'name email avatar');

    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
