import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus, TaskType, CrossDeptStatus, TaskPriority, ReassignmentStatus } from './schemas/task.schema';
import { TimeEntry, TimeEntryDocument, EntryType } from './schemas/time-entry.schema';
import { TaskAudit, TaskAuditDocument } from './schemas/task-audit.schema';
import { Project, ProjectDocument, ProjectStatus } from '../projects/schemas/project.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ApproveCrossDeptDto, RejectCrossDeptDto } from './dto/approve-cross-dept.dto';
import { RequestReassignDto, RejectReassignDto } from './dto/request-reassign.dto';
import { LogTimeSessionDto } from './dto/log-time-session.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(TaskAudit.name) private taskAuditModel: Model<TaskAuditDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
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
          type: 'task',
          module: 'tasks',
          referenceId: referenceId?.toString(),
        });
      }
    } catch (e) {
      console.warn('Failed to dispatch task notification:', e.message);
    }
  }

  // Helper for audit logging
  private async logAudit(
    task: TaskDocument | Types.ObjectId | string,
    action: string,
    performedBy: any,
    oldValue?: string,
    newValue?: string,
    comment?: string,
    reqDept?: string,
    tarDept?: string,
  ) {
    try {
      const uIdStr = performedBy?._id ? performedBy._id.toString() : (performedBy?.id ? performedBy.id.toString() : (typeof performedBy === 'string' ? performedBy : null));
      const taskId = typeof task === 'object' && '_id' in task ? task._id : new Types.ObjectId(task.toString());
      await this.taskAuditModel.create({
        task: taskId,
        action,
        performedBy: uIdStr && Types.ObjectId.isValid(uIdStr) ? new Types.ObjectId(uIdStr) : undefined,
        oldValue,
        newValue,
        comment,
        requestingDepartment: reqDept,
        targetDepartment: tarDept,
      });
    } catch (e) {
      console.error('Audit log failed:', e.message);
    }
  }

  // Create Task (Personal, Department, Project, Cross-Dept, Deliverable)
  async create(dto: CreateTaskDto, user: any): Promise<TaskDocument> {
    const userId = user._id ? user._id.toString() : user.id;
    const userDept = user.department || user.role;

    // Generate unique human-readable task code if not supplied
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const generatedTaskId = `HR-${randomSuffix}`;

    const payload: any = {
      taskId: generatedTaskId,
      title: dto.title,
      description: dto.description,
      acceptanceCriteria: dto.acceptanceCriteria || '',
      taskType: dto.taskType || TaskType.DEPARTMENT,
      priority: dto.priority || TaskPriority.MEDIUM,
      dueDate: new Date(dto.dueDate),
      startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
      estimatedHours: dto.estimatedHours || 0,
      createdBy: new Types.ObjectId(userId),
      department: dto.department || userDept,
      reviewRequired: dto.reviewRequired !== undefined ? Boolean(dto.reviewRequired) : true,
      deliverableType: dto.deliverableType,
      campaignName: dto.campaignName,
      targetKeywords: dto.targetKeywords,
      publicationUrl: dto.publicationUrl,
      budget: dto.budget || 0,
      clientReviewRequired: Boolean(dto.clientReviewRequired),
      bugSeverity: dto.bugSeverity || 'MEDIUM',
      bugEnvironment: dto.bugEnvironment,
      bugStepsToReproduce: dto.bugStepsToReproduce,
      bugExpectedResult: dto.bugExpectedResult,
      bugActualResult: dto.bugActualResult,
      bugUrlOrModule: dto.bugUrlOrModule,
      checklist: dto.checklist || [],
    };

    if (dto.reviewer && Types.ObjectId.isValid(dto.reviewer)) {
      payload.reviewer = new Types.ObjectId(dto.reviewer);
    }

    if (dto.client) {
      if (Types.ObjectId.isValid(dto.client)) {
        payload.client = new Types.ObjectId(dto.client);
        try {
          const clt: any = await this.clientModel.findById(dto.client).lean();
          if (clt) {
            payload.clientName = clt.name || clt.company || clt.clientName;
          }
        } catch (e) {}
      } else {
        payload.clientName = String(dto.client).trim();
      }
    }
    if (dto.clientName && !payload.clientName) {
      payload.clientName = String(dto.clientName).trim();
    }

    if (dto.project) {
      if (Types.ObjectId.isValid(dto.project)) {
        payload.project = new Types.ObjectId(dto.project);
        if (!payload.client && !payload.clientName) {
          try {
            const prj: any = await this.projectModel.findById(dto.project).populate('client').lean();
            if (prj && prj.client) {
              if (prj.client._id) {
                payload.client = prj.client._id;
                payload.clientName = prj.client.name || prj.client.company || prj.client.clientName;
              } else if (typeof prj.client === 'string') {
                if (Types.ObjectId.isValid(prj.client)) {
                  payload.client = new Types.ObjectId(prj.client);
                } else {
                  payload.clientName = prj.client;
                }
              }
            }
          } catch (e) {}
        }
      } else {
        payload.milestone = dto.project;
      }
    }
    if (dto.milestone && !payload.milestone) payload.milestone = dto.milestone;
    if (dto.dependsOnTask && Types.ObjectId.isValid(dto.dependsOnTask)) payload.dependsOnTask = new Types.ObjectId(dto.dependsOnTask);

    // Rule 1: PERSONAL Task - Self Assigned, Managed by User, No mandatory external review
    if (dto.taskType === TaskType.PERSONAL) {
      payload.assignedTo = new Types.ObjectId(userId);
      payload.assignedManager = new Types.ObjectId(userId);
      payload.reviewer = new Types.ObjectId(userId);
      payload.reviewRequired = false;
      payload.status = TaskStatus.TODO;
    } 
    // Rule 2: BUG Report - Target Dept: Development, Requires Super Admin / Dev Head Approval if reported by non-devs
    else if (dto.taskType === TaskType.BUG) {
      payload.requestingDepartment = userDept;
      payload.targetDepartment = 'Development';
      payload.department = 'Development';

      const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes((user.role || '').toLowerCase());
      const isDevHead = Boolean(user.isDepartmentHead) && (userDept.toLowerCase() === 'development' || userDept.toLowerCase() === 'tech');

      if (isSuperAdmin || isDevHead) {
        payload.crossDeptStatus = CrossDeptStatus.APPROVED;
        payload.crossDeptApprovedBy = new Types.ObjectId(userId);
        payload.crossDeptApprovedAt = new Date();
        payload.status = TaskStatus.TODO;
        if (dto.assignedTo) {
          payload.assignedTo = new Types.ObjectId(dto.assignedTo);
        }
      } else {
        payload.crossDeptStatus = CrossDeptStatus.PENDING;
        payload.status = TaskStatus.DRAFT;
        if (dto.assignedTo) {
          payload.pendingNewAssignee = new Types.ObjectId(dto.assignedTo);
        }
        payload.assignedTo = null; // Assigned developer becomes active upon Super Admin / Dev HOD approval
      }
    }
    // Rule 3: CROSS_DEPARTMENT Request - Requires Super Admin / Target HOD Approval
    else if (dto.taskType === TaskType.CROSS_DEPARTMENT) {
      if (!dto.targetDepartment) {
        throw new BadRequestException('Target department is required for cross-department requests');
      }
      payload.requestingDepartment = userDept;
      payload.targetDepartment = dto.targetDepartment;
      payload.crossDeptReason = dto.crossDeptReason || dto.description;

      const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);

      if (isSuperAdmin) {
        // Super Admin creating cross-dept task: Auto-approved
        payload.crossDeptStatus = CrossDeptStatus.APPROVED;
        payload.crossDeptApprovedBy = new Types.ObjectId(userId);
        payload.crossDeptApprovedAt = new Date();
        payload.status = TaskStatus.TODO;
        if (dto.assignedTo) {
          payload.assignedTo = new Types.ObjectId(dto.assignedTo);
        }
      } else {
        // HOD / Manager (e.g. Sales Head) creating cross-dept task: Requires Super Admin approval
        payload.crossDeptStatus = CrossDeptStatus.PENDING;
        payload.status = TaskStatus.DRAFT;
        if (dto.assignedTo) {
          payload.pendingNewAssignee = new Types.ObjectId(dto.assignedTo);
        }
        payload.assignedTo = null; // Assigned employee becomes active upon Super Admin / Target HOD approval
      }
    } 
    // Rule 3.5: ADMIN Task - Executive, Governance, and Operations Tasks
    else if (dto.taskType === TaskType.ADMIN) {
      payload.department = dto.department || 'Admin';
      payload.status = TaskStatus.TODO;
      payload.reviewRequired = false;
      if (dto.assignedTo) {
        payload.assignedTo = new Types.ObjectId(dto.assignedTo);
      } else {
        payload.assignedTo = new Types.ObjectId(userId);
      }
      payload.assignedManager = new Types.ObjectId(userId);
    }
    // Rule 4: DEPARTMENT / PROJECT / DELIVERABLE Task
    else {
      if (dto.assignedTo) {
        // Enforce department isolation: Manager can assign within own department
        const assignee = await this.userModel.findById(dto.assignedTo);
        if (!assignee) throw new NotFoundException('Assigned employee not found');

        const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes((user.role || '').toLowerCase());
        const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes((user.role || '').toLowerCase());

        if (!isSuperAdmin && !isDeptHead && dto.assignedTo.toString() !== userId.toString()) {
          throw new ForbiddenException('Regular employees and developers can only assign tasks to themselves');
        }

        if (!isSuperAdmin && assignee.department && assignee.department.toLowerCase() !== userDept.toLowerCase()) {
          throw new ForbiddenException(
            `Cross-department direct assignment is prohibited. Use a Cross-Department Request instead to target ${assignee.department}.`
          );
        }
        payload.assignedTo = new Types.ObjectId(dto.assignedTo);
      }
      payload.assignedManager = new Types.ObjectId(userId);
      payload.status = TaskStatus.TODO;
    }

    const task = new this.taskModel(payload);
    const saved = await task.save();

    await this.logAudit(
      saved._id,
      saved.taskType === TaskType.CROSS_DEPARTMENT ? 'CROSS_DEPT_REQUEST_CREATED' : 'TASK_CREATED',
      user,
      undefined,
      saved.status,
      `Task created as ${saved.taskType}`,
      userDept,
      dto.targetDepartment,
    );

    if (saved.project) {
      await this.syncProjectProgress(saved.project.toString());
    }

    if (saved.assignedTo && saved.assignedTo.toString() !== userId.toString()) {
      await this.sendNotification(
        saved.assignedTo,
        'New Task Assigned',
        `You have been assigned task "${saved.title}" by ${user.name || 'Admin'}`,
        saved._id.toString(),
      );
    }

    return saved;
  }

  // Cross-Department Approval by Super Admin / Target HOD
  async approveCrossDeptRequest(id: string, dto: ApproveCrossDeptDto, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (task.taskType !== TaskType.CROSS_DEPARTMENT) {
      throw new BadRequestException('Task is not a cross-department request');
    }

    if (task.crossDeptStatus !== CrossDeptStatus.PENDING) {
      throw new BadRequestException(`Request is already ${task.crossDeptStatus}`);
    }

    const userDept = (user.department || user.role).toLowerCase();
    const isTargetDeptHead = user.isDepartmentHead && userDept === task.targetDepartment?.toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);

    if (!isSuperAdmin && !isTargetDeptHead && userDept !== task.targetDepartment?.toLowerCase()) {
      throw new ForbiddenException('Only Super Admin or Target Department HOD can approve this request');
    }

    const targetAssigneeId = dto.assignedTo || (task.pendingNewAssignee ? task.pendingNewAssignee.toString() : null);
    if (!targetAssigneeId) {
      throw new BadRequestException('Assigned employee is required to approve cross-department request');
    }

    const assignee = await this.userModel.findById(targetAssigneeId);
    if (!assignee) throw new NotFoundException('Assigned employee not found');

    task.assignedTo = new Types.ObjectId(targetAssigneeId);
    task.assignedManager = new Types.ObjectId(user._id);
    task.crossDeptStatus = CrossDeptStatus.APPROVED;
    task.crossDeptApprovedBy = new Types.ObjectId(user._id);
    task.crossDeptApprovedAt = new Date();
    task.status = TaskStatus.TODO;

    const saved = await task.save();

    await this.logAudit(
      saved._id,
      'CROSS_DEPT_REQUEST_APPROVED',
      user,
      CrossDeptStatus.PENDING,
      CrossDeptStatus.APPROVED,
      `Approved and assigned to employee ${assignee.name}. Notes: ${dto.notes || 'None'}`,
      task.requestingDepartment,
      task.targetDepartment,
    );

    return saved;
  }

  // Cross-Department Rejection
  async rejectCrossDeptRequest(id: string, dto: RejectCrossDeptDto, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (task.taskType !== TaskType.CROSS_DEPARTMENT) {
      throw new BadRequestException('Task is not a cross-department request');
    }

    const userDept = (user.department || user.role).toLowerCase();
    const isTargetDeptHead = user.isDepartmentHead && userDept === task.targetDepartment?.toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);

    if (!isSuperAdmin && !isTargetDeptHead && userDept !== task.targetDepartment?.toLowerCase()) {
      throw new ForbiddenException('Only the Target Department HOD or Manager can reject this request');
    }

    task.crossDeptStatus = CrossDeptStatus.REJECTED;
    task.status = TaskStatus.CANCELLED;
    const saved = await task.save();

    await this.logAudit(
      saved._id,
      'CROSS_DEPT_REQUEST_REJECTED',
      user,
      CrossDeptStatus.PENDING,
      CrossDeptStatus.REJECTED,
      `Rejection Reason: ${dto.rejectionReason}`,
      task.requestingDepartment,
      task.targetDepartment,
    );

    return saved;
  }

  // Task Transfer / Reassignment Workflow
  async requestReassignment(id: string, dto: RequestReassignDto, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);
    const isDeptHead = user.isDepartmentHead;

    if (!isSuperAdmin && !isDeptHead) {
      throw new ForbiddenException('Only Super Admin or Department Heads can request task transfers');
    }

    const newAssigneeUser = await this.userModel.findById(dto.newAssignee);
    if (!newAssigneeUser) throw new NotFoundException('New assigned employee not found');

    const oldAssigneeId = task.assignedTo ? task.assignedTo.toString() : 'Unassigned';

    // Rule: Super Admin can directly transfer immediately
    if (isSuperAdmin) {
      task.assignedTo = new Types.ObjectId(dto.newAssignee);
      task.reassignmentStatus = ReassignmentStatus.NONE;
      task.pendingNewAssignee = undefined as any;
      task.reassignmentReason = undefined as any;
      const saved = await task.save();

      await this.logAudit(
        saved._id,
        'TASK_REASSIGNED_DIRECT_ADMIN',
        user,
        oldAssigneeId,
        newAssigneeUser.name,
        `Super Admin directly transferred task to ${newAssigneeUser.name}. Reason: ${dto.reason}`,
      );

      return saved;
    }

    // Rule: Department Head requests transfer -> Super Admin Approval Needed!
    task.reassignmentStatus = ReassignmentStatus.PENDING;
    task.pendingNewAssignee = new Types.ObjectId(dto.newAssignee);
    task.reassignmentReason = dto.reason;
    task.reassignmentRequestedBy = new Types.ObjectId(user._id);

    const saved = await task.save();

    await this.logAudit(
      saved._id,
      'TASK_REASSIGNMENT_REQUESTED',
      user,
      oldAssigneeId,
      newAssigneeUser.name,
      `HOD requested transfer to ${newAssigneeUser.name} pending Super Admin Approval. Reason: ${dto.reason}`,
    );

    return saved;
  }

  // Super Admin Approve Task Reassignment
  async approveReassignment(id: string, user: any): Promise<TaskDocument> {
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);
    if (!isSuperAdmin) {
      throw new ForbiddenException('Only Super Admin / Management can approve task transfers');
    }

    const task = await this.taskModel.findById(id).populate('pendingNewAssignee', 'name email');
    if (!task) throw new NotFoundException('Task not found');

    if (task.reassignmentStatus !== ReassignmentStatus.PENDING || !task.pendingNewAssignee) {
      throw new BadRequestException('No pending transfer request found for this task');
    }

    const newAssigneeObj: any = task.pendingNewAssignee;
    const oldAssigneeId = task.assignedTo ? task.assignedTo.toString() : 'Unassigned';

    task.assignedTo = newAssigneeObj._id;
    task.reassignmentStatus = ReassignmentStatus.APPROVED;
    task.pendingNewAssignee = undefined as any;
    task.reassignmentReason = undefined as any;

    const saved = await task.save();

    await this.logAudit(
      saved._id,
      'TASK_REASSIGNMENT_APPROVED',
      user,
      oldAssigneeId,
      newAssigneeObj.name,
      `Super Admin approved transfer of task to ${newAssigneeObj.name}.`,
    );

    return saved;
  }

  // Super Admin Reject Task Reassignment
  async rejectReassignment(id: string, dto: RejectReassignDto, user: any): Promise<TaskDocument> {
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role);
    if (!isSuperAdmin) {
      throw new ForbiddenException('Only Super Admin / Management can reject task transfers');
    }

    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    task.reassignmentStatus = ReassignmentStatus.REJECTED;
    task.pendingNewAssignee = undefined as any;
    const saved = await task.save();

    await this.logAudit(
      saved._id,
      'TASK_REASSIGNMENT_REJECTED',
      user,
      undefined,
      undefined,
      `Super Admin rejected transfer request. ${dto.reason ? `Reason: ${dto.reason}` : ''}`,
    );

    return saved;
  }

  // Fetch all tasks with filters & role scoping
  async findAll(query: any, user: any): Promise<{ tasks: any[]; total: number }> {
    const {
      status,
      priority,
      project,
      assignedTo,
      taskType,
      department,
      scope, // 'assigned' | 'created' | 'personal' | 'department' | 'all'
      crossDeptStatus,
      reassignmentStatus,
      overdue,
      startDate,
      endDate,
      dateFilter,
      page = 1,
      limit = 50,
    } = query;
    const filter: any = {};

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const userDept = user.department || userRole;
    const userDeptRegex = new RegExp(`^${userDept}$`, 'i');

    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);

    // Apply Scope Filter if specified
    if (scope === 'assigned') {
      filter.assignedTo = new Types.ObjectId(uId);
      filter.taskType = { $ne: TaskType.PERSONAL };
    } else if (scope === 'created') {
      filter.createdBy = new Types.ObjectId(uId);
      filter.taskType = { $ne: TaskType.PERSONAL };
    } else if (scope === 'personal') {
      filter.taskType = TaskType.PERSONAL;
      filter.createdBy = new Types.ObjectId(uId);
    } else if (scope === 'my_work' || scope === 'all_my') {
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { createdBy: new Types.ObjectId(uId) },
      ];
    } else {
      // Exclude personal tasks from departmental & shared company views
      if (!taskType) {
        filter.taskType = { $ne: TaskType.PERSONAL };
      }
      // Default Role-based Team Member visibility
      if (!isSuperAdmin && !isDeptHead) {
        filter.$or = [
          { assignedTo: new Types.ObjectId(uId) },
          { createdBy: new Types.ObjectId(uId) },
          { targetDepartment: userDeptRegex, crossDeptStatus: CrossDeptStatus.PENDING },
        ];
      } else if (isDeptHead && !isSuperAdmin) {
        // HOD visibility: own department or target cross-dept requests
        filter.$or = [
          { department: userDeptRegex },
          { requestingDepartment: userDeptRegex },
          { targetDepartment: userDeptRegex },
          { assignedTo: new Types.ObjectId(uId) },
          { createdBy: new Types.ObjectId(uId) },
        ];
      }
    }

    // Department Filter
    if (department) {
      filter.department = new RegExp(`^${department}$`, 'i');
    }

    // Dynamic Overdue Filter
    if (overdue === 'true' || status === 'OVERDUE') {
      filter.status = { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] };
      filter.dueDate = { $lt: new Date() };
    } else if (status) {
      const s = String(status).toUpperCase();
      if (s === 'DONE' || s === 'COMPLETED') {
        filter.status = { $in: [TaskStatus.DONE, TaskStatus.COMPLETED] };
      } else if (s === 'BLOCKED' || s === 'ON_HOLD') {
        filter.status = { $in: [TaskStatus.BLOCKED, TaskStatus.ON_HOLD] };
      } else {
        filter.status = s;
      }
    }

    if (priority) filter.priority = priority.toUpperCase();
    if (taskType) filter.taskType = taskType.toUpperCase();
    if (crossDeptStatus) filter.crossDeptStatus = crossDeptStatus.toUpperCase();
    if (reassignmentStatus) filter.reassignmentStatus = reassignmentStatus.toUpperCase();
    if (project && Types.ObjectId.isValid(project)) filter.project = new Types.ObjectId(project);
    if (assignedTo && Types.ObjectId.isValid(assignedTo)) filter.assignedTo = new Types.ObjectId(assignedTo);

    // Date Range / Month / Year Filtering
    if (dateFilter || startDate || endDate) {
      let start: Date | null = null;
      let end: Date | null = null;
      const now = new Date();

      if (dateFilter === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (dateFilter === 'this_week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), diff + 6, 23, 59, 59, 999);
      } else if (dateFilter === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (dateFilter === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      } else if (startDate || endDate) {
        if (startDate) start = new Date(startDate);
        if (endDate) {
          end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
        }
      }

      if (start || end) {
        const dateCond: any = {};
        if (start) dateCond.$gte = start;
        if (end) dateCond.$lte = end;
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [{ dueDate: dateCond }, { createdAt: dateCond }],
        });
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [tasks, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .populate({
          path: 'project',
          select: 'name projectId status client',
          populate: { path: 'client', select: 'name company phone email whatsapp address city' },
        })
        .populate('client', 'name company phone email whatsapp address city')
        .populate('assignedTo', 'name email role department avatar')
        .populate('createdBy', 'name email role department avatar')
        .populate('assignedManager', 'name email')
        .populate('reviewer', 'name email role department')
        .populate('reopenedBy', 'name email role')
        .populate('crossDeptApprovedBy', 'name email')
        .populate('pendingNewAssignee', 'name email role department')
        .populate('reassignmentRequestedBy', 'name email role')
        .populate('dependsOnTask', 'title status')
        .skip(skip)
        .limit(Number(limit))
        .sort({ dueDate: 1, createdAt: -1 }),
      this.taskModel.countDocuments(filter),
    ]);

    // Format tasks with dynamic isOverdue calculation without mutating DB status
    const formattedTasks = tasks.map((t) => {
      const doc = t.toObject ? t.toObject({ virtuals: true }) : t;
      const s = String(doc.status || '').toUpperCase();
      const isDone = ['DONE', 'COMPLETED', 'CANCELLED'].includes(s);
      const isOverdue = !isDone && Boolean(doc.dueDate) && new Date(doc.dueDate).getTime() < Date.now();
      return {
        ...doc,
        isOverdue,
      };
    });

    return { tasks: formattedTasks, total };
  }

  // Get Single Task Detail
  async findOne(id: string): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id)
      .populate({
        path: 'project',
        select: 'name projectId status client',
        populate: { path: 'client', select: 'name company phone email whatsapp address city' },
      })
      .populate('client', 'name company phone email whatsapp address city')
      .populate('assignedTo', 'name email role department designation avatar')
      .populate('createdBy', 'name email role department avatar')
      .populate('assignedManager', 'name email')
      .populate('reviewer', 'name email role department')
      .populate('reopenedBy', 'name email role')
      .populate('dependsOnTask', 'title status assignedTo')
      .populate('comments.user', 'name avatar role department email');

    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // Update Task Status with State Machine & Validation
  async updateStatus(id: string, dto: UpdateTaskStatusDto, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);
    const isReviewer = task.reviewer && task.reviewer.toString() === uId;
    const isCreator = task.createdBy && task.createdBy.toString() === uId;
    const isAssignee = task.assignedTo && task.assignedTo.toString() === uId;

    const oldStatusRaw = String(task.status || TaskStatus.TODO).toUpperCase();
    let oldStatus = oldStatusRaw;
    if (oldStatusRaw === 'COMPLETED') oldStatus = TaskStatus.DONE;
    if (oldStatusRaw === 'ON_HOLD') oldStatus = TaskStatus.BLOCKED;

    const rawNewStatus = String(dto.status).toUpperCase();
    let newStatus = rawNewStatus;
    if (rawNewStatus === 'COMPLETED') newStatus = TaskStatus.DONE;
    if (rawNewStatus === 'ON_HOLD') newStatus = TaskStatus.BLOCKED;

    // Rule: BLOCKED requires reason
    if (newStatus === TaskStatus.BLOCKED) {
      const reason = dto.blockedReason || dto.onHoldReason || task.blockedReason || task.onHoldReason;
      if (!reason) {
        throw new BadRequestException('A reason is required to block or put a task on hold');
      }
      task.blockedReason = reason;
      task.onHoldReason = reason;
    }

    // Rule: REWORK requires notes
    if (newStatus === TaskStatus.REWORK) {
      const notes = dto.reworkNotes || dto.reviewComment || dto.reviewerComment || task.reworkNotes;
      if (!notes) {
        throw new BadRequestException('Rework notes or review comments are required when returning a task for REWORK');
      }
      task.reworkNotes = notes;
      task.reviewerDecision = 'REWORK';
      task.reviewerDecisionAt = new Date();
    }

    // Rule: SUBMITTED (Review) validation
    if (newStatus === TaskStatus.SUBMITTED) {
      if (task.taskType === TaskType.BUG && !dto.bugFixSummary && !task.bugFixSummary) {
        throw new BadRequestException('A bug fix summary detailing changes made is required before submitting for QA review.');
      }
      if (dto.bugFixSummary) task.bugFixSummary = dto.bugFixSummary;
      if (dto.bugFixCommitLink) task.bugFixCommitLink = dto.bugFixCommitLink;
      if (dto.deliveryEvidence) task.deliveryEvidence = dto.deliveryEvidence;
      if (dto.publicationUrl) task.publicationUrl = dto.publicationUrl;
    }

    // Rule: DONE (Completion) validation & RBAC gate
    if (newStatus === TaskStatus.DONE) {
      // 1. Dependency check
      if (task.dependsOnTask) {
        const parent = await this.taskModel.findById(task.dependsOnTask);
        if (parent && !['DONE', 'COMPLETED'].includes(parent.status)) {
          throw new BadRequestException(`Cannot complete task because dependent task "${parent.title}" is not completed yet.`);
        }
      }

      // 2. Client approval check for deliverables
      if (task.clientReviewRequired && !task.clientApproved) {
        throw new BadRequestException('Client approval is required before completing this deliverable task.');
      }

      // 3. Independent Review Policy: Assignee cannot approve their own work if review is required
      const isSelfPersonalTask = task.taskType === TaskType.PERSONAL && isAssignee;
      if (task.reviewRequired && !isSelfPersonalTask) {
        if (!isSuperAdmin && !isDeptHead && !isReviewer && !isCreator) {
          throw new ForbiddenException(
            'You cannot mark this task as Done directly because independent review is required. Please submit it for review.'
          );
        }
      }

      task.completedAt = new Date();
      task.reviewerDecision = 'APPROVED';
      task.reviewerDecisionAt = new Date();
      if (task.taskType === TaskType.BUG) {
        task.bugQaApproved = true;
      }
      if (dto.completionEvidence) task.completionEvidence = dto.completionEvidence;
      if (dto.deliveryEvidence) task.deliveryEvidence = dto.deliveryEvidence;
    }

    // Rule: REOPENING from DONE
    if (['DONE', 'COMPLETED'].includes(oldStatusRaw) && newStatus !== TaskStatus.DONE) {
      if (!isSuperAdmin && !isDeptHead && !isCreator) {
        throw new ForbiddenException('Only Administrators, Department Heads, or the task creator can reopen a completed task.');
      }
      const reopenReason = dto.reopenReason || dto.reviewComment || dto.reworkNotes;
      if (!reopenReason) {
        throw new BadRequestException('A reason is required to reopen a completed task.');
      }
      task.reopenReason = reopenReason;
      task.reopenedBy = new Types.ObjectId(uId);
      task.reopenedAt = new Date();
      task.completedAt = undefined as any;
      task.reviewerDecision = 'REOPENED';
    }

    task.status = newStatus;
    if (dto.onHoldReason) task.onHoldReason = dto.onHoldReason;
    if (dto.blockedReason) task.blockedReason = dto.blockedReason;
    if (dto.reworkNotes || dto.reviewComment) task.reworkNotes = dto.reworkNotes || dto.reviewComment || '';

    const saved = await task.save();

    await this.logAudit(
      saved._id,
      `STATUS_CHANGED_${newStatus}`,
      user,
      oldStatus,
      newStatus,
      dto.reopenReason || dto.reviewComment || dto.reworkNotes || dto.blockedReason || dto.onHoldReason || `Status updated from ${oldStatus} to ${newStatus}`,
    );

    // Notifications dispatch on status change
    if (newStatus === TaskStatus.REWORK && task.assignedTo) {
      await this.sendNotification(
        task.assignedTo,
        'Task Returned for Rework',
        `Task "${task.title}" requires revisions. Notes: ${task.reworkNotes}`,
        task._id.toString(),
      );
    } else if (newStatus === TaskStatus.SUBMITTED) {
      const targetReviewer = task.reviewer || task.assignedManager || task.createdBy;
      if (targetReviewer) {
        await this.sendNotification(
          targetReviewer,
          'Task Submitted for Review',
          `Task "${task.title}" was submitted for review.`,
          task._id.toString(),
        );
      }
    } else if (newStatus === TaskStatus.DONE && task.assignedTo) {
      await this.sendNotification(
        task.assignedTo,
        'Task Approved & Completed',
        `Great job! Task "${task.title}" has been verified and marked as Done.`,
        task._id.toString(),
      );
    }

    if (saved.project) {
      await this.syncProjectProgress(saved.project.toString());
    }

    // If dependency completed, unblock child tasks
    if (newStatus === TaskStatus.DONE) {
      await this.taskModel.updateMany(
        { dependsOnTask: saved._id, status: { $in: [TaskStatus.BLOCKED, TaskStatus.ON_HOLD] } },
        { isDependencyResolved: true, status: TaskStatus.IN_PROGRESS },
      );
    }

    return this.findOne(id);
  }

  // Toggle Checklist Sub-Item Completion
  async toggleChecklistItem(id: string, index: number, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (!task.checklist || !task.checklist[index]) {
      throw new BadRequestException('Checklist item not found at specified index');
    }

    const item = task.checklist[index];
    const willBeCompleted = !item.completed;
    item.completed = willBeCompleted;
    item.completedAt = willBeCompleted ? new Date() : undefined;
    task.markModified('checklist');

    // Auto-update task progress % based on checklist items
    if (task.checklist.length > 0) {
      const completedCount = task.checklist.filter(c => c.completed).length;
      task.progress = Math.round((completedCount / task.checklist.length) * 100);
    }

    await task.save();

    await this.logAudit(
      task._id,
      willBeCompleted ? 'CHECKLIST_ITEM_COMPLETED' : 'CHECKLIST_ITEM_UNCHECKED',
      user,
      undefined,
      item.title,
      `Checklist item "${item.title}" marked as ${willBeCompleted ? 'completed' : 'pending'}`,
    );

    return this.findOne(id);
  }

  // Add Task Comment
  async addComment(id: string, commentText: string, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const uId = user._id ? user._id.toString() : user.id;
    const commentObj = {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(uId),
      comment: commentText.trim(),
      createdAt: new Date(),
    };

    task.comments = task.comments || [];
    task.comments.push(commentObj as any);
    task.markModified('comments');
    await task.save();

    await this.logAudit(
      task._id,
      'COMMENT_ADDED',
      user,
      undefined,
      undefined,
      `Added comment: "${commentText.slice(0, 80)}${commentText.length > 80 ? '...' : ''}"`,
    );

    // Notify assignee or creator
    const assigneeStr = task.assignedTo?.toString();
    const creatorStr = task.createdBy?.toString();
    const commenterStr = uId.toString();

    if (assigneeStr && assigneeStr !== commenterStr) {
      await this.sendNotification(
        assigneeStr,
        'New Comment on Task',
        `${user.name || 'Team member'} commented on "${task.title}": "${commentText.slice(0, 50)}..."`,
        task._id.toString(),
      );
    } else if (creatorStr && creatorStr !== commenterStr) {
      await this.sendNotification(
        creatorStr,
        'New Comment on Task',
        `${user.name || 'Team member'} commented on "${task.title}": "${commentText.slice(0, 50)}..."`,
        task._id.toString(),
      );
    }

    return this.findOne(id);
  }

  // Remove Task Comment
  async removeComment(id: string, commentId: string, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);

    const comment = task.comments.find(c => (c as any)._id?.toString() === commentId.toString());
    if (!comment) throw new NotFoundException('Comment not found');

    if (!isSuperAdmin && comment.user?.toString() !== uId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    task.comments = task.comments.filter(c => (c as any)._id?.toString() !== commentId.toString()) as any;
    await task.save();

    await this.logAudit(
      task._id,
      'COMMENT_REMOVED',
      user,
      undefined,
      undefined,
      'Deleted a task comment',
    );

    return this.findOne(id);
  }

  // Add File Attachment to Task
  async addAttachment(id: string, body: any, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const attachmentItem = {
      _id: new Types.ObjectId(),
      name: body.name || 'Attachment',
      url: body.url || body,
      uploadedBy: user.name || user.email,
      uploadedAt: new Date(),
    };

    task.attachments = task.attachments || [];
    task.attachments.push(attachmentItem);
    task.markModified('attachments');
    await task.save();

    await this.logAudit(
      task._id,
      'ATTACHMENT_ADDED',
      user,
      undefined,
      attachmentItem.name,
      `Attached document: ${attachmentItem.name}`,
    );

    return this.findOne(id);
  }

  // Remove File Attachment from Task
  async removeAttachment(id: string, index: number, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (!task.attachments || !task.attachments[index]) {
      throw new BadRequestException('Attachment not found at specified index');
    }

    task.attachments.splice(index, 1);
    task.markModified('attachments');
    await task.save();

    await this.logAudit(
      task._id,
      'ATTACHMENT_REMOVED',
      user,
      undefined,
      undefined,
      `Removed attachment at index ${index}`,
    );

    return this.findOne(id);
  }

  // General Update with Role-Based Scoping
  async update(id: string, dto: any, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const userDept = (user.department || userRole).toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);

    const isOwner = task.createdBy?.toString() === uId;
    const isAssignee = task.assignedTo?.toString() === uId;
    const isDeptMatch = (task.department || '').toLowerCase() === userDept;

    if (!isSuperAdmin && !isOwner && !isAssignee && !(isDeptHead && isDeptMatch)) {
      throw new ForbiddenException('You do not have permission to modify this task');
    }

    const payload = { ...dto };
    if (dto.project && Types.ObjectId.isValid(dto.project)) payload.project = new Types.ObjectId(dto.project);
    if (dto.client !== undefined) {
      if (dto.client && Types.ObjectId.isValid(dto.client)) {
        payload.client = new Types.ObjectId(dto.client);
        try {
          const clt: any = await this.clientModel.findById(dto.client).lean();
          if (clt) {
            payload.clientName = clt.name || clt.company || clt.clientName;
          }
        } catch (e) {}
      } else if (dto.client && typeof dto.client === 'string' && dto.client.trim()) {
        payload.client = null;
        payload.clientName = dto.client.trim();
      } else {
        payload.client = null;
        if (!dto.clientName) payload.clientName = '';
      }
    }
    if (dto.clientName !== undefined) {
      payload.clientName = dto.clientName ? String(dto.clientName).trim() : '';
    }
    if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    if (dto.dependsOnTask && Types.ObjectId.isValid(dto.dependsOnTask)) payload.dependsOnTask = new Types.ObjectId(dto.dependsOnTask);

    const updated = await this.taskModel.findByIdAndUpdate(id, payload, { new: true });
    if (!updated) throw new NotFoundException('Task not found');

    await this.logAudit(id, 'TASK_UPDATED', user, undefined, undefined, 'Task details updated');

    if (updated.project) {
      await this.syncProjectProgress(updated.project.toString());
    }

    return this.findOne(id);
  }

  // Delete Task with Role-Based Scoping
  async remove(id: string, user: any): Promise<void> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const userDept = (user.department || userRole).toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);
    const isCreator = task.createdBy?.toString() === uId;

    if (!isSuperAdmin && !isCreator && !(isDeptHead && (task.department || '').toLowerCase() === userDept)) {
      throw new ForbiddenException('Only Administrators, Department Heads, or the task creator can delete this task');
    }

    await this.taskModel.findByIdAndDelete(id);
    await this.logAudit(id, 'TASK_DELETED', user, undefined, undefined, `Task "${task.title}" deleted`);
    if (task.project) {
      await this.syncProjectProgress(task.project.toString());
    }
  }

  // Work Session & Timer Logging with Accurate Floating-Point Precision
  async logTimeSession(dto: LogTimeSessionDto, user: any): Promise<TimeEntryDocument> {
    const userId = user._id ? user._id.toString() : user.id;

    if (dto.entryType === EntryType.PROJECT_TIMER && dto.projectId) {
      const project = await this.projectModel.findById(dto.projectId);
      if (!project) throw new NotFoundException('Project not found');
      if (project.status === ProjectStatus.ON_HOLD || project.status === ProjectStatus.CANCELLED) {
        throw new BadRequestException('Project timer can only run when project status is active/started');
      }
    }

    const entry = await this.timeEntryModel.create({
      user: new Types.ObjectId(userId),
      task: dto.taskId ? new Types.ObjectId(dto.taskId) : undefined,
      project: dto.projectId ? new Types.ObjectId(dto.projectId) : undefined,
      startTime: new Date(Date.now() - dto.durationSeconds * 1000),
      endTime: new Date(),
      durationSeconds: dto.durationSeconds,
      entryType: dto.entryType || EntryType.TASK_SESSION,
      notes: dto.notes,
    });

    // Update actual hours on task accurately without cumulative rounding drift
    if (dto.taskId) {
      const task = await this.taskModel.findById(dto.taskId);
      if (task) {
        const addedHours = dto.durationSeconds / 3600;
        task.actualHours = Number(((task.actualHours || 0) + addedHours).toFixed(2));
        await task.save();
      }
    }

    await this.logAudit(
      dto.taskId || dto.projectId || userId,
      'TIME_LOGGED',
      user,
      undefined,
      `${dto.durationSeconds}s`,
      `Logged ${Math.round(dto.durationSeconds / 60)} minutes for ${dto.entryType}`,
    );

    return entry;
  }

  // Workflow 2 & 5: Start live timer with concurrent timer rejection
  async startTimer(dto: { taskId?: string; projectId?: string; entryType?: string; notes?: string }, user: any): Promise<any> {
    const userId = user._id ? user._id.toString() : user.id;

    // Check if user already has an active live timer
    const existingActive: any = await this.timeEntryModel.findOne({
      user: new Types.ObjectId(userId),
      isLive: true,
      endTime: null,
    }).populate('task', 'title').populate('project', 'name');

    if (existingActive) {
      const activeDesc = existingActive.task?.title
        ? `task "${existingActive.task.title}"`
        : existingActive.project?.name
        ? `project "${existingActive.project.name}"`
        : 'another session';
      throw new BadRequestException(
        `A timer is already active for ${activeDesc}. Only one active timer is permitted at a time. Please pause or stop the active timer before starting a new one.`,
      );
    }

    // Workflow 8: Validate project timer if starting for a project
    if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
      const project = await this.projectModel.findById(dto.projectId);
      if (!project) throw new NotFoundException('Project not found');
      const validStatuses = [ProjectStatus.ASSIGNED, ProjectStatus.STARTED, ProjectStatus.IN_PROGRESS, ProjectStatus.REVIEW, ProjectStatus.CLIENT_REVIEW];
      if (!validStatuses.includes(project.status as any)) {
        throw new BadRequestException(`Project timer can only run on officially started projects. Current status is ${project.status}.`);
      }
    }

    // Auto-advance task status to IN_PROGRESS if currently TODO
    let taskTitle = '';
    if (dto.taskId && Types.ObjectId.isValid(dto.taskId)) {
      const task = await this.taskModel.findById(dto.taskId);
      if (!task) throw new NotFoundException('Task not found');
      taskTitle = task.title;
      if (task.status === TaskStatus.TODO) {
        task.status = TaskStatus.IN_PROGRESS;
        await task.save();
        await this.logAudit(task._id, 'STATUS_CHANGE', user, 'TODO', 'IN_PROGRESS', 'Work timer started on task');
      }
    }

    const entry = await this.timeEntryModel.create({
      user: new Types.ObjectId(userId),
      task: dto.taskId && Types.ObjectId.isValid(dto.taskId) ? new Types.ObjectId(dto.taskId) : undefined,
      project: dto.projectId && Types.ObjectId.isValid(dto.projectId) ? new Types.ObjectId(dto.projectId) : undefined,
      startTime: new Date(),
      durationSeconds: 0,
      isLive: true,
      entryType: dto.entryType || (dto.projectId && !dto.taskId ? EntryType.PROJECT_TIMER : EntryType.TASK_SESSION),
      notes: dto.notes || '',
    });

    await this.logAudit(
      dto.taskId || dto.projectId || userId,
      'TIMER_STARTED',
      user,
      undefined,
      dto.taskId ? `Task: ${taskTitle}` : 'Timer started',
      `Live timer session started`,
    );

    return this.timeEntryModel.findById(entry._id)
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status')
      .populate('user', 'name email');
  }

  // Workflow 3: Get active timer across page refresh and browser reconnection
  async getActiveTimer(user: any): Promise<{ activeTimer: TimeEntryDocument | null; elapsedSeconds: number }> {
    const userId = user._id ? user._id.toString() : user.id;

    // First check for live running timer
    const active = await this.timeEntryModel.findOne({
      user: new Types.ObjectId(userId),
      isLive: true,
      endTime: null,
    })
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status client')
      .populate('user', 'name email');

    if (active) {
      const segment = Math.max(0, Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000));
      const totalElapsed = (active.durationSeconds || 0) + segment;
      return { activeTimer: active, elapsedSeconds: totalElapsed };
    }

    // Check for paused timer session that has not been stopped (endTime: null, isLive: false)
    const paused = await this.timeEntryModel.findOne({
      user: new Types.ObjectId(userId),
      isLive: false,
      endTime: null,
    })
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status client')
      .populate('user', 'name email')
      .sort({ updatedAt: -1 });

    if (paused) {
      return { activeTimer: paused, elapsedSeconds: paused.durationSeconds || 0 };
    }

    return { activeTimer: null, elapsedSeconds: 0 };
  }

  // Workflow 4: Pause active timer
  async pauseTimer(user: any, timerId?: string): Promise<any> {
    const userId = user._id ? user._id.toString() : user.id;
    const query: any = { user: new Types.ObjectId(userId), isLive: true, endTime: null };
    if (timerId && Types.ObjectId.isValid(timerId)) query._id = new Types.ObjectId(timerId);

    const timer = await this.timeEntryModel.findOne(query);
    if (!timer) throw new NotFoundException('No active running timer found to pause');

    const segment = Math.max(0, Math.floor((Date.now() - new Date(timer.startTime).getTime()) / 1000));
    timer.durationSeconds = (timer.durationSeconds || 0) + segment;
    timer.isLive = false;
    await timer.save();

    await this.logAudit(
      timer.task || timer.project || userId,
      'TIMER_PAUSED',
      user,
      undefined,
      `${timer.durationSeconds}s total`,
      `Timer paused at ${Math.round(timer.durationSeconds / 60)} minutes`,
    );

    return this.timeEntryModel.findById(timer._id)
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status')
      .populate('user', 'name email');
  }

  // Workflow 4: Resume paused timer
  async resumeTimer(user: any, timerId?: string): Promise<any> {
    const userId = user._id ? user._id.toString() : user.id;

    // Check no other timer is currently live
    const active = await this.timeEntryModel.findOne({
      user: new Types.ObjectId(userId),
      isLive: true,
      endTime: null,
    });
    if (active) {
      throw new BadRequestException('Another timer is currently active. Please pause or stop it before resuming.');
    }

    const query: any = { user: new Types.ObjectId(userId), isLive: false, endTime: null };
    if (timerId && Types.ObjectId.isValid(timerId)) query._id = new Types.ObjectId(timerId);

    const timer = await this.timeEntryModel.findOne(query).sort({ updatedAt: -1 });
    if (!timer) throw new NotFoundException('No paused timer session found to resume');

    timer.isLive = true;
    timer.startTime = new Date();
    await timer.save();

    await this.logAudit(
      timer.task || timer.project || userId,
      'TIMER_RESUMED',
      user,
      undefined,
      `${timer.durationSeconds}s accrued`,
      'Timer resumed',
    );

    return this.timeEntryModel.findById(timer._id)
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status')
      .populate('user', 'name email');
  }

  // Workflow 4: Stop timer and accurately log time entries
  async stopTimer(user: any, timerId?: string, notes?: string): Promise<any> {
    const userId = user._id ? user._id.toString() : user.id;
    const query: any = { user: new Types.ObjectId(userId), endTime: null };
    if (timerId && Types.ObjectId.isValid(timerId)) query._id = new Types.ObjectId(timerId);

    const timer = await this.timeEntryModel.findOne(query).sort({ updatedAt: -1 });
    if (!timer) throw new NotFoundException('No active or paused timer session found to stop');

    if (timer.isLive && timer.startTime) {
      const segment = Math.max(0, Math.floor((Date.now() - new Date(timer.startTime).getTime()) / 1000));
      timer.durationSeconds = (timer.durationSeconds || 0) + segment;
    }
    timer.isLive = false;
    timer.endTime = new Date();
    if (notes) timer.notes = notes;
    await timer.save();

    // Accurately record actual hours on task without cumulative rounding drift
    if (timer.task) {
      const task = await this.taskModel.findById(timer.task);
      if (task) {
        const addedHours = timer.durationSeconds / 3600;
        task.actualHours = Number(((task.actualHours || 0) + addedHours).toFixed(2));
        await task.save();
      }
    }

    await this.logAudit(
      timer.task || timer.project || userId,
      'TIMER_STOPPED',
      user,
      undefined,
      `${timer.durationSeconds}s`,
      `Timer stopped and logged ${Math.round(timer.durationSeconds / 60)} minutes`,
    );

    return this.timeEntryModel.findById(timer._id)
      .populate('task', 'title taskId status priority actualHours')
      .populate('project', 'name projectId status')
      .populate('user', 'name email');
  }

  // Workflow 7: Get audit-logged time entries for task or project
  async getTimeEntries(taskId?: string, projectId?: string): Promise<TimeEntryDocument[]> {
    const filter: any = {};
    if (taskId && Types.ObjectId.isValid(taskId)) filter.task = new Types.ObjectId(taskId);
    if (projectId && Types.ObjectId.isValid(projectId)) filter.project = new Types.ObjectId(projectId);

    return this.timeEntryModel
      .find(filter)
      .populate('user', 'name email role department avatar')
      .populate('task', 'title taskId status')
      .populate('project', 'name projectId')
      .sort({ createdAt: -1 });
  }

  // Workflow 14: Overdue tasks and SLA risks trigger configured notifications
  async checkAndNotifyOverdueAndSlaRisks(): Promise<{ overdueCount: number; slaRiskCount: number; notifiedCount: number }> {
    const now = new Date();
    const in24Hours = new Date(Date.now() + 24 * 3600 * 1000);
    const completedStatuses = [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED];

    // 1. Overdue Tasks: due date has passed AND task is not Done
    const overdueTasks = await this.taskModel.find({
      dueDate: { $lt: now },
      status: { $nin: completedStatuses },
    }).populate('assignedTo', 'name email').populate('assignedManager', 'name email');

    let notifiedCount = 0;
    for (const task of overdueTasks) {
      if (task.assignedTo) {
        await this.sendNotification(
          task.assignedTo,
          'Task OVERDUE Alert',
          `Task "${task.title}" is overdue (due: ${new Date(task.dueDate).toLocaleDateString()}). Please update progress immediately.`,
          task._id.toString(),
        );
        notifiedCount++;
      }
      if (task.assignedManager && (task.assignedManager as any)._id?.toString() !== (task.assignedTo as any)?._id?.toString()) {
        await this.sendNotification(
          task.assignedManager,
          'Overdue Task Escalation',
          `Task "${task.title}" assigned to ${(task.assignedTo as any)?.name || 'team'} has breached its due date.`,
          task._id.toString(),
        );
        notifiedCount++;
      }
    }

    // 2. SLA Risk Tasks: due within 24 hours AND task is not Done
    const slaRiskTasks = await this.taskModel.find({
      dueDate: { $gte: now, $lte: in24Hours },
      status: { $nin: completedStatuses },
    }).populate('assignedTo', 'name email');

    for (const task of slaRiskTasks) {
      if (task.assignedTo) {
        await this.sendNotification(
          task.assignedTo,
          'SLA Deadline Approaching (<24h)',
          `Task "${task.title}" is due within 24 hours. Please prioritize to meet your deadline.`,
          task._id.toString(),
        );
        notifiedCount++;
      }
    }

    return {
      overdueCount: overdueTasks.length,
      slaRiskCount: slaRiskTasks.length,
      notifiedCount,
    };
  }

  // Get Audit Trail for Task
  async getAuditTrail(taskId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(taskId)) return [];
    const tObjId = new Types.ObjectId(taskId);
    let logs = await this.taskAuditModel
      .find({ $or: [{ task: tObjId }, { task: taskId }] })
      .populate('performedBy', 'name email role department avatar')
      .sort({ createdAt: -1 });

    // Fallback: If task has no audit entries (e.g. created prior to audit log feature), synthesize initial creation audit entry
    if (logs.length === 0) {
      const task = await this.taskModel.findById(taskId).populate('createdBy', 'name email role department avatar');
      if (task) {
        logs = [
          {
            _id: `initial_${task._id}`,
            task: task._id,
            action: 'TASK_CREATED',
            performedBy: task.createdBy || { name: 'System Admin', role: 'admin' },
            newValue: task.status,
            comment: `Task created as ${task.taskType} (Initial Record)`,
            createdAt: (task as any).createdAt || (task as any)._id.getTimestamp(),
          } as any,
        ];
      }
    }

    return logs;
  }

  // Sync Project Progress %
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

  // Workload Overview by Department
  async getWorkloadSummary(user?: any): Promise<any> {
    const match: any = {
      status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      taskType: { $ne: TaskType.PERSONAL },
    };

    if (user) {
      const uId = user._id ? user._id.toString() : user.id;
      const userRole = (user.role || '').toLowerCase();
      const userDept = user.department || userRole;
      const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
      const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);

      if (!isSuperAdmin && isDeptHead) {
        match.department = new RegExp(`^${userDept}$`, 'i');
      } else if (!isSuperAdmin && !isDeptHead) {
        match.assignedTo = new Types.ObjectId(uId);
      }
    }

    const now = new Date();

    return this.taskModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { department: '$department', assignedTo: '$assignedTo' },
          totalTasks: { $sum: 1 },
          overdueTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ['$dueDate', false] },
                    { $lt: ['$dueDate', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalEstHours: { $sum: '$estimatedHours' },
        },
      },
    ]);
  }

  // Central Authoritative Task Metrics for Dashboards & Header Counters
  async getDashboardTaskMetrics(query: any = {}, user: any): Promise<any> {
    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const userDept = user.department || userRole;
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);

    const baseFilter: any = {};
    if (!isSuperAdmin && !isDeptHead) {
      baseFilter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { createdBy: new Types.ObjectId(uId) },
        { targetDepartment: new RegExp(`^${userDept}$`, 'i'), crossDeptStatus: CrossDeptStatus.PENDING },
      ];
    } else if (isDeptHead && !isSuperAdmin) {
      baseFilter.$or = [
        { department: new RegExp(`^${userDept}$`, 'i') },
        { requestingDepartment: new RegExp(`^${userDept}$`, 'i') },
        { targetDepartment: new RegExp(`^${userDept}$`, 'i') },
        { assignedTo: new Types.ObjectId(uId) },
        { createdBy: new Types.ObjectId(uId) },
      ];
    }

    if (query.department) {
      baseFilter.department = new RegExp(`^${query.department}$`, 'i');
    }

    // Personal tasks are not counted in shared departmental commitments unless explicit scope
    const sharedFilter = { ...baseFilter, taskType: { $ne: TaskType.PERSONAL } };

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [
      totalActive,
      toDoCount,
      inProgressCount,
      blockedCount,
      submittedCount,
      reworkCount,
      doneCount,
      overdueCount,
      dueTodayCount,
      unassignedCount,
      crossDeptCount,
      pendingApprovalsCount,
      personalTasksCount,
    ] = await Promise.all([
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.TODO, 'todo', 'TODO'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.IN_PROGRESS, 'in_progress', 'IN_PROGRESS'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.BLOCKED, TaskStatus.ON_HOLD, 'blocked', 'on_hold', 'ON_HOLD'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.SUBMITTED, TaskStatus.REVIEW, 'submitted', 'review', 'SUBMITTED'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.REWORK, 'rework', 'REWORK'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $in: [TaskStatus.DONE, TaskStatus.COMPLETED, 'done', 'completed', 'COMPLETED'] },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        dueDate: { $lt: now },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        dueDate: { $gte: startOfToday, $lte: endOfToday },
      }),
      this.taskModel.countDocuments({
        ...sharedFilter,
        status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
      }),
      this.taskModel.countDocuments({
        ...baseFilter,
        taskType: TaskType.CROSS_DEPARTMENT,
      }),
      this.taskModel.countDocuments({
        ...baseFilter,
        $or: [
          { crossDeptStatus: CrossDeptStatus.PENDING },
          { reassignmentStatus: ReassignmentStatus.PENDING },
        ],
      }),
      this.taskModel.countDocuments({
        createdBy: new Types.ObjectId(uId),
        taskType: TaskType.PERSONAL,
      }),
    ]);

    return {
      totalActive,
      toDo: toDoCount,
      inProgress: inProgressCount,
      blocked: blockedCount,
      submittedForReview: submittedCount,
      reworkRequired: reworkCount,
      done: doneCount,
      overdueTasks: overdueCount,
      dueToday: dueTodayCount,
      unassignedTasks: unassignedCount,
      crossDeptRequests: crossDeptCount,
      pendingApprovals: pendingApprovalsCount,
      personalTasks: personalTasksCount,
    };
  }

  // Department Performance Metrics for Reports
  async getDepartmentMetrics(user?: any): Promise<any> {
    const now = new Date();
    return this.taskModel.aggregate([
      { $match: { taskType: { $ne: TaskType.PERSONAL } } },
      {
        $group: {
          _id: '$department',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $in: ['$status', [TaskStatus.DONE, TaskStatus.COMPLETED]] }, 1, 0] },
          },
          activeTasks: {
            $sum: { $cond: [{ $not: [{ $in: ['$status', [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED]] }] }, 1, 0] },
          },
          overdueTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $not: [{ $in: ['$status', [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED]] }] },
                    { $lt: ['$dueDate', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          reworkCount: {
            $sum: { $cond: [{ $eq: ['$status', TaskStatus.REWORK] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          department: '$_id',
          totalTasks: 1,
          completedTasks: 1,
          activeTasks: 1,
          overdueTasks: 1,
          reworkCount: 1,
          completionRate: {
            $cond: [
              { $gt: ['$totalTasks', 0] },
              { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] },
              0,
            ],
          },
        },
      },
    ]);
  }
}

