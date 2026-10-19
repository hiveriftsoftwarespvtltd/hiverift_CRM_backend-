import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TicketsService } from './tickets.service';
import { TicketStatus, TicketPriority } from './schemas/ticket.schema';
import { TaskType, TaskStatus } from '../tasks/schemas/task.schema';

describe('Support Ticket Workflows (Workflows 9 & 10)', () => {
  let ticketsService: TicketsService;
  let mockTicketModel: any;
  let mockTaskModel: any;
  let mockProjectModel: any;
  let mockNotificationsService: any;

  const adminUser = {
    _id: new Types.ObjectId('650000000000000000000001'),
    name: 'Admin User',
    role: 'admin',
  };

  const supportAgent = {
    _id: new Types.ObjectId('650000000000000000000002'),
    name: 'Support Agent Jane',
    role: 'development',
  };

  const leadDev = {
    _id: new Types.ObjectId('650000000000000000000003'),
    name: 'Lead Developer Dave',
    role: 'development',
    isDepartmentHead: true,
  };

  beforeEach(() => {
    const ticketsDb = new Map<string, any>();
    const tasksDb = new Map<string, any>();

    mockNotificationsService = {
      create: jest.fn().mockResolvedValue({ success: true }),
    };

    mockProjectModel = {
      findById: jest.fn().mockImplementation((id: string) => ({
        lean: () => ({ _id: id, client: new Types.ObjectId() }),
      })),
    };

    mockTicketModel = function (dto: any) {
      const _id = new Types.ObjectId();
      const doc: any = {
        _id,
        ticketId: `TCK-${Math.floor(1000 + Math.random() * 9000)}`,
        status: TicketStatus.OPEN,
        timeline: [],
        ...dto,
        save: jest.fn().mockImplementation(async function () {
          ticketsDb.set(this._id.toString(), this);
          return this;
        }),
      };
      ticketsDb.set(_id.toString(), doc);
      return doc;
    };

    mockTicketModel.findById = jest.fn().mockImplementation((id: string) => {
      const doc = ticketsDb.get(id?.toString());
      if (!doc) return null;
      return {
        ...doc,
        save: jest.fn().mockImplementation(async function () {
          ticketsDb.set(id.toString(), this);
          return this;
        }),
        populate: jest.fn().mockReturnThis(),
      };
    });

    mockTicketModel.find = jest.fn().mockImplementation(() => ({
      populate: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue(Array.from(ticketsDb.values())),
    }));

    mockTicketModel.countDocuments = jest.fn().mockResolvedValue(ticketsDb.size);

    mockTaskModel = function (dto: any) {
      const _id = new Types.ObjectId();
      const taskDoc: any = {
        _id,
        ...dto,
        save: jest.fn().mockImplementation(async function () {
          tasksDb.set(this._id.toString(), this);
          return this;
        }),
      };
      tasksDb.set(_id.toString(), taskDoc);
      return taskDoc;
    };

    ticketsService = new TicketsService(
      mockTicketModel as any,
      mockTaskModel as any,
      mockProjectModel as any,
      mockNotificationsService,
    );
  });

  // Workflow 9: A support ticket is assigned, investigated, escalated, resolved, and closed
  it('Workflow 9: Complete ticket lifecycle from OPEN -> ASSIGNED -> INVESTIGATING -> ESCALATED -> RESOLVED -> CLOSED', async () => {
    // 1. Create ticket
    const ticket = await ticketsService.create(
      {
        title: 'Payment Gateway 502 Bad Gateway',
        description: 'Webhook failing intermittently during customer checkout',
        category: 'TECHNICAL' as any,
        priority: TicketPriority.CRITICAL,
      },
      adminUser._id.toString(),
    );

    expect(ticket).toBeDefined();
    expect(ticket.status).toBe(TicketStatus.OPEN);
    expect(ticket.slaDueDate).toBeDefined();

    // 2. Assign ticket
    const assigned = await ticketsService.assign(
      ticket._id.toString(),
      { assignedTo: supportAgent._id.toString(), note: 'Agent Jane investigating checkout logs' },
      adminUser,
    );
    expect(assigned.status).toBe(TicketStatus.ASSIGNED);
    expect(assigned.assignedTo.toString()).toBe(supportAgent._id.toString());
    expect(mockNotificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Support Ticket Assigned',
      }),
    );

    // 3. Investigate ticket
    const investigating = await ticketsService.investigate(ticket._id.toString(), supportAgent);
    expect(investigating.status).toBe(TicketStatus.INVESTIGATING);

    // 4. Escalate ticket
    const escalated = await ticketsService.escalate(
      ticket._id.toString(),
      { escalatedTo: leadDev._id.toString(), reason: 'Requires architectural SSL cert renew on gateway server' },
      supportAgent,
    );
    expect(escalated.status).toBe(TicketStatus.ESCALATED);
    expect(escalated.escalatedTo.toString()).toBe(leadDev._id.toString());
    expect(escalated.escalationReason).toContain('SSL cert renew');

    // 5. Resolve ticket
    const resolved = await ticketsService.resolve(
      ticket._id.toString(),
      { resolutionNotes: 'Renewed SSL certificate and redeployed payment webhook microservice' },
      leadDev,
    );
    expect(resolved.status).toBe(TicketStatus.RESOLVED);
    expect(resolved.resolutionNotes).toContain('Renewed SSL certificate');
    expect(resolved.resolvedAt).toBeDefined();

    // 6. Close ticket
    const closed = await ticketsService.close(ticket._id.toString(), adminUser);
    expect(closed.status).toBe(TicketStatus.CLOSED);
    expect(closed.closedAt).toBeDefined();
  });

  // Workflow 10: Support ticket creates a linked development task and QA task
  it('Workflow 10: Automatically creates linked Development fix task and QA verification task', async () => {
    const ticket = await ticketsService.create(
      {
        title: 'User Profile Avatar Upload Failure',
        description: 'Uploads above 2MB fail with unhandled payload exception',
        priority: TicketPriority.HIGH,
      },
      adminUser._id.toString(),
    );

    // Execute linked tasks creation
    const { ticket: updatedTicket, devTask, qaTask } = await ticketsService.createLinkedTasks(
      ticket._id.toString(),
      adminUser,
    );

    expect(devTask).toBeDefined();
    expect(devTask.title).toContain('[DEV Fix]');
    expect(devTask.taskType).toBe(TaskType.BUG);
    expect(devTask.linkedTicket.toString()).toBe(ticket._id.toString());
    expect(devTask.status).toBe(TaskStatus.TODO);
    expect(devTask.checklist.length).toBeGreaterThanOrEqual(2);

    expect(qaTask).toBeDefined();
    expect(qaTask.title).toContain('[QA Verification]');
    expect(qaTask.taskType).toBe(TaskType.DEPARTMENT);
    expect(qaTask.linkedTicket.toString()).toBe(ticket._id.toString());
    expect(qaTask.checklist.some((c: any) => c.title.includes('regression'))).toBe(true);

    expect(updatedTicket.linkedDevTask.toString()).toBe(devTask._id.toString());
    expect(updatedTicket.linkedQaTask.toString()).toBe(qaTask._id.toString());
    expect(updatedTicket.timeline.some((t: any) => t.action === 'LINKED_TASKS_CREATED')).toBe(true);
  });
});
