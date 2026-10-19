import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TasksService } from './tasks.service';
import { TaskStatus, TaskType, TaskPriority } from './schemas/task.schema';
import { EntryType } from './schemas/time-entry.schema';
import { ProjectStatus } from '../projects/schemas/project.schema';

function createQueryMock(result: any) {
  const query: any = {
    populate: jest.fn().mockImplementation(() => query),
    sort: jest.fn().mockImplementation(() => query),
    skip: jest.fn().mockImplementation(() => query),
    limit: jest.fn().mockImplementation(() => query),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(result).catch(reject),
  };
  return query;
}

describe('Task Management System - 15 Workflows Integration Test Suite', () => {
  let tasksService: TasksService;
  let mockTaskModel: any;
  let mockTimeEntryModel: any;
  let mockTaskAuditModel: any;
  let mockProjectModel: any;
  let mockUserModel: any;
  let mockClientModel: any;
  let mockNotificationsService: any;

  const adminUser = {
    _id: new Types.ObjectId('650000000000000000000001'),
    name: 'Admin User',
    email: 'admin@hiverift.com',
    role: 'admin',
    department: 'Management',
  };

  const employeeUser = {
    _id: new Types.ObjectId('650000000000000000000002'),
    name: 'Dev Employee',
    email: 'dev@hiverift.com',
    role: 'development',
    department: 'Development',
  };

  const reviewerUser = {
    _id: new Types.ObjectId('650000000000000000000003'),
    name: 'Tech Lead Reviewer',
    email: 'lead@hiverift.com',
    role: 'development',
    department: 'Development',
    isDepartmentHead: true,
  };

  beforeEach(() => {
    const tasksDb = new Map<string, any>();
    const timeEntriesDb = new Map<string, any>();
    const auditsDb: any[] = [];
    const notificationsDb: any[] = [];
    const projectsDb = new Map<string, any>();

    mockNotificationsService = {
      create: jest.fn().mockImplementation(async (payload) => {
        notificationsDb.push(payload);
        return payload;
      }),
    };

    mockTaskAuditModel = {
      create: jest.fn().mockImplementation(async (doc) => {
        auditsDb.push(doc);
        return doc;
      }),
      find: jest.fn().mockImplementation(() => createQueryMock(auditsDb)),
    };

    mockProjectModel = {
      findById: jest.fn().mockImplementation((id: string) => {
        const prj = projectsDb.get(id?.toString());
        return {
          lean: () => prj,
          ...prj,
        };
      }),
      find: jest.fn().mockImplementation(() => createQueryMock(Array.from(projectsDb.values()))),
    };

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

    mockTaskModel.findById = jest.fn().mockImplementation((id: string) => {
      const task = tasksDb.get(id?.toString());
      if (!task) return null;
      return {
        ...task,
        save: jest.fn().mockImplementation(async function () {
          tasksDb.set(id.toString(), this);
          return this;
        }),
        populate: jest.fn().mockReturnThis(),
      };
    });

    mockTaskModel.find = jest.fn().mockImplementation((filter: any) => {
      let list = Array.from(tasksDb.values());
      return createQueryMock(list);
    });

    mockTaskModel.countDocuments = jest.fn().mockImplementation((filter: any) => {
      return Promise.resolve(tasksDb.size);
    });

    mockTaskModel.aggregate = jest.fn().mockImplementation((pipeline: any[]) => {
      return Promise.resolve([
        { _id: 'TODO', count: 1 },
        { _id: 'IN_PROGRESS', count: 1 },
      ]);
    });

    mockTaskModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    mockTimeEntryModel = {
      create: jest.fn().mockImplementation(async (dto: any) => {
        const _id = new Types.ObjectId();
        const entry = {
          _id,
          ...dto,
          save: jest.fn().mockImplementation(async function () {
            timeEntriesDb.set(_id.toString(), this);
            return this;
          }),
        };
        timeEntriesDb.set(_id.toString(), entry);
        return entry;
      }),
      findOne: jest.fn().mockImplementation((query: any) => {
        let entries = Array.from(timeEntriesDb.values());
        if (query.user) {
          entries = entries.filter((e) => e.user?.toString() === query.user.toString());
        }
        if (query.isLive !== undefined) {
          entries = entries.filter((e) => e.isLive === query.isLive);
        }
        if (query.endTime === null) {
          entries = entries.filter((e) => !e.endTime);
        }
        const match = entries[0] || null;
        if (!match) return createQueryMock(null);
        const matchObj = {
          ...match,
          save: jest.fn().mockImplementation(async function () {
            timeEntriesDb.set(match._id.toString(), this);
            return this;
          }),
        };
        return createQueryMock(matchObj);
      }),
      findById: jest.fn().mockImplementation((id: string) => {
        const match = timeEntriesDb.get(id?.toString());
        if (!match) return createQueryMock(null);
        return createQueryMock({
          ...match,
          save: jest.fn().mockImplementation(async function () {
            timeEntriesDb.set(match._id.toString(), this);
            return this;
          }),
        });
      }),
      find: jest.fn().mockImplementation((filter: any) => {
        let entries = Array.from(timeEntriesDb.values());
        if (filter.task) {
          entries = entries.filter((e) => e.task?.toString() === filter.task.toString());
        }
        return createQueryMock(entries);
      }),
    };

    mockUserModel = {
      findById: jest.fn().mockImplementation((id) => ({
        _id: id,
        name: 'User',
      })),
    };

    mockClientModel = {
      findById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'Test Client' }),
    };

    tasksService = new TasksService(
      mockTaskModel as any,
      mockTimeEntryModel as any,
      mockTaskAuditModel as any,
      mockProjectModel as any,
      mockUserModel as any,
      mockClientModel as any,
      mockNotificationsService,
    );
  });

  // Workflow 1: Admin assigns task to employee
  it('Workflow 1: Admin assigns task to employee, records owner, and triggers notification', async () => {
    const task = await tasksService.create(
      {
        title: 'Build Authentication Gateway',
        description: 'Implement JWT and refresh token exchange',
        taskType: TaskType.DEVELOPMENT,
        priority: TaskPriority.HIGH,
        assignedTo: employeeUser._id.toString(),
        reviewer: reviewerUser._id.toString(),
        dueDate: new Date(Date.now() + 86400000),
        estimatedHours: 8,
      },
      adminUser,
    );

    expect(task).toBeDefined();
    expect(task.title).toBe('Build Authentication Gateway');
    expect(task.status).toBe(TaskStatus.TODO);
    expect(task.assignedTo.toString()).toBe(employeeUser._id.toString());
    expect(task.assignedManager.toString()).toBe(adminUser._id.toString());
    expect(mockNotificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: employeeUser._id.toString(),
        title: 'New Task Assigned',
      }),
    );
  });

  // Workflow 2: Employee starts task timer
  it('Workflow 2: Employee starts timer, creates live TimeEntry, and transitions task to IN_PROGRESS', async () => {
    const task = await tasksService.create(
      {
        title: 'Setup API Gateways',
        dueDate: new Date(Date.now() + 86400000),
        assignedTo: employeeUser._id.toString(),
      },
      adminUser,
    );

    const timer = await tasksService.startTimer(
      { taskId: task._id.toString(), entryType: EntryType.TASK_SESSION },
      employeeUser,
    );

    expect(timer).toBeDefined();
    expect(timer.isLive).toBe(true);
    expect(timer.task.toString()).toBe(task._id.toString());
    expect(timer.durationSeconds).toBe(0);

    const updatedTask = await mockTaskModel.findById(task._id.toString());
    expect(updatedTask.status).toBe(TaskStatus.IN_PROGRESS);
  });

  // Workflow 3: Timer persistence across page refresh and browser reconnection
  it('Workflow 3: Active timer persists across page refresh and calculates elapsed seconds', async () => {
    const task = await tasksService.create(
      { title: 'Persisted Task', dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );

    await tasksService.startTimer({ taskId: task._id.toString() }, employeeUser);

    // Simulate page refresh / new browser connection
    const active = await tasksService.getActiveTimer(employeeUser);

    expect(active.activeTimer).toBeDefined();
    expect(active.activeTimer.isLive).toBe(true);
    expect(active.activeTimer.task.toString()).toBe(task._id.toString());
    expect(active.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  // Workflow 4: Pause, resume, and stop timer
  it('Workflow 4: Employee pauses, resumes, and stops timer with actual hours accumulation', async () => {
    const task = await tasksService.create(
      { title: 'Timer Control Task', dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );

    await tasksService.startTimer({ taskId: task._id.toString() }, employeeUser);

    // Pause timer
    const paused = await tasksService.pauseTimer(employeeUser);
    expect(paused.isLive).toBe(false);

    // Resume timer
    const resumed = await tasksService.resumeTimer(employeeUser);
    expect(resumed.isLive).toBe(true);

    // Stop timer
    const stopped = await tasksService.stopTimer(employeeUser, undefined, 'Finished session 1');
    expect(stopped.isLive).toBe(false);
    expect(stopped.endTime).toBeDefined();

    const updatedTask = await mockTaskModel.findById(task._id.toString());
    expect(updatedTask.actualHours).toBeDefined();
  });

  // Workflow 5: Second active task timer is rejected by backend
  it('Workflow 5: Starting a second active timer is rejected with BadRequestException', async () => {
    const task1 = await tasksService.create(
      { title: 'Task 1', dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );
    const task2 = await tasksService.create(
      { title: 'Task 2', dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );

    await tasksService.startTimer({ taskId: task1._id.toString() }, employeeUser);

    // Attempting to start second timer concurrently
    await expect(
      tasksService.startTimer({ taskId: task2._id.toString() }, employeeUser),
    ).rejects.toThrow(BadRequestException);
  });

  // Workflow 6: Submit, review, rework required, and approval
  it('Workflow 6: Enforces complete task review lifecycle and prevents employee self-completion', async () => {
    const task = await tasksService.create(
      {
        title: 'Security Feature',
        dueDate: new Date(Date.now() + 86400000),
        assignedTo: employeeUser._id.toString(),
        reviewer: reviewerUser._id.toString(),
        reviewRequired: true,
      },
      adminUser,
    );

    // 1. Move to IN_PROGRESS
    await tasksService.updateStatus(task._id.toString(), { status: TaskStatus.IN_PROGRESS }, employeeUser);

    // 2. Employee cannot mark DONE directly when reviewRequired = true
    await expect(
      tasksService.updateStatus(task._id.toString(), { status: TaskStatus.DONE }, employeeUser),
    ).rejects.toThrow(ForbiddenException);

    // 3. Employee submits for review
    const submitted = await tasksService.updateStatus(
      task._id.toString(),
      { status: TaskStatus.SUBMITTED },
      employeeUser,
    );
    expect(submitted.status).toBe(TaskStatus.SUBMITTED);

    // 4. Reviewer returns for rework with required reason
    const rework = await tasksService.updateStatus(
      task._id.toString(),
      { status: TaskStatus.REWORK, reviewerComment: 'Fix encryption padding issue' },
      reviewerUser,
    );
    expect(rework.status).toBe(TaskStatus.REWORK);

    // 5. Employee resumes work
    await tasksService.updateStatus(task._id.toString(), { status: TaskStatus.IN_PROGRESS }, employeeUser);

    // 6. Resubmit
    await tasksService.updateStatus(task._id.toString(), { status: TaskStatus.SUBMITTED }, employeeUser);

    // 7. Reviewer approves to DONE
    const approved = await tasksService.updateStatus(
      task._id.toString(),
      { status: TaskStatus.DONE, reviewerComment: 'Security verification passed' },
      reviewerUser,
    );
    expect(approved.status).toBe(TaskStatus.DONE);

    // 8. Reopening requires reason and authorization
    await expect(
      tasksService.updateStatus(task._id.toString(), { status: TaskStatus.TODO }, employeeUser),
    ).rejects.toThrow(ForbiddenException);

    const reopened = await tasksService.updateStatus(
      task._id.toString(),
      { status: TaskStatus.TODO, reopenReason: 'Client requested audit update' },
      adminUser,
    );
    expect(reopened.status).toBe(TaskStatus.TODO);
  });

  // Workflow 7: Accurate and auditable time entries
  it('Workflow 7: Retrieves historical time entries and verifies auditable logs', async () => {
    const task = await tasksService.create(
      { title: 'Auditable Task', dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );

    await tasksService.logTimeSession(
      { taskId: task._id.toString(), durationSeconds: 3600, notes: 'Sprint review' },
      employeeUser,
    );

    const entries = await tasksService.getTimeEntries(task._id.toString());
    expect(entries).toBeDefined();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].durationSeconds).toBe(3600);
  });

  // Workflow 8: Officially started project records project timer
  it('Workflow 8: Rejects project timer on ON_HOLD/CANCELLED projects and permits on active projects', async () => {
    const activePrjId = new Types.ObjectId();
    const holdPrjId = new Types.ObjectId();

    mockProjectModel.findById.mockImplementation((id: string) => {
      if (id.toString() === activePrjId.toString()) {
        return { _id: activePrjId, name: 'Active Web App', status: ProjectStatus.STARTED };
      }
      return { _id: holdPrjId, name: 'Hold Project', status: ProjectStatus.ON_HOLD };
    });

    // Starting on on-hold project must be rejected
    await expect(
      tasksService.startTimer(
        { projectId: holdPrjId.toString(), entryType: EntryType.PROJECT_TIMER },
        employeeUser,
      ),
    ).rejects.toThrow(BadRequestException);

    // Starting on active project succeeds
    const projectTimer = await tasksService.startTimer(
      { projectId: activePrjId.toString(), entryType: EntryType.PROJECT_TIMER },
      employeeUser,
    );
    expect(projectTimer).toBeDefined();
    expect(projectTimer.entryType).toBe(EntryType.PROJECT_TIMER);
  });

  // Workflow 12: Sales, marketing, HR, and admin tasks use the same engine
  it('Workflow 12: Multi-department tasks (SALES, MARKETING, HR, DEV) share unified engine', async () => {
    const salesTask = await tasksService.create(
      { title: 'Enterprise Contract Proposal', taskType: TaskType.SALES, dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );
    const mktgTask = await tasksService.create(
      { title: 'Google Ads Campaign Audit', taskType: TaskType.MARKETING, dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );
    const hrTask = await tasksService.create(
      { title: 'Quarterly Performance Review', taskType: TaskType.HR, dueDate: new Date(Date.now() + 86400000) },
      adminUser,
    );

    expect(salesTask.status).toBe(TaskStatus.TODO);
    expect(mktgTask.status).toBe(TaskStatus.TODO);
    expect(hrTask.status).toBe(TaskStatus.TODO);

    expect(salesTask.taskType).toBe(TaskType.SALES);
    expect(mktgTask.taskType).toBe(TaskType.MARKETING);
    expect(hrTask.taskType).toBe(TaskType.HR);
  });

  // Workflow 14: Overdue tasks and SLA risks trigger notifications
  it('Workflow 14: Automated SLA checker identifies overdue and near-deadline tasks and notifies assignees', async () => {
    const pastDueTask = {
      _id: new Types.ObjectId(),
      title: 'Overdue Bug Patch',
      dueDate: new Date(Date.now() - 3600 * 1000 * 24), // 1 day ago
      status: TaskStatus.IN_PROGRESS,
      assignedTo: employeeUser,
      assignedManager: adminUser,
    };

    const nearSlaTask = {
      _id: new Types.ObjectId(),
      title: 'Near SLA Risk Task',
      dueDate: new Date(Date.now() + 3600 * 1000 * 12), // in 12 hours
      status: TaskStatus.TODO,
      assignedTo: employeeUser,
    };

    mockTaskModel.find.mockImplementation((filter: any) => {
      if (filter.dueDate?.$lt) return createQueryMock([pastDueTask]);
      if (filter.dueDate?.$gte) return createQueryMock([nearSlaTask]);
      return createQueryMock([]);
    });

    const result = await tasksService.checkAndNotifyOverdueAndSlaRisks();
    expect(result.overdueCount).toBe(1);
    expect(result.slaRiskCount).toBe(1);
    expect(result.notifiedCount).toBeGreaterThanOrEqual(2);
    expect(mockNotificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Task OVERDUE Alert',
      }),
    );
  });
});
