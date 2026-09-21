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

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(TaskAudit.name) private taskAuditModel: Model<TaskAuditDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
  ) {}

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

    const payload: any = {
      title: dto.title,
      description: dto.description,
      taskType: dto.taskType || TaskType.DEPARTMENT,
      priority: dto.priority || TaskPriority.MEDIUM,
      dueDate: new Date(dto.dueDate),
      startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
      estimatedHours: dto.estimatedHours || 0,
      createdBy: new Types.ObjectId(userId),
      department: dto.department || userDept,
      deliverableType: dto.deliverableType,
      clientReviewRequired: Boolean(dto.clientReviewRequired),
      bugSeverity: dto.bugSeverity || 'MEDIUM',
      bugEnvironment: dto.bugEnvironment,
      bugStepsToReproduce: dto.bugStepsToReproduce,
    };

    if (dto.client && Types.ObjectId.isValid(dto.client)) payload.client = new Types.ObjectId(dto.client);
    if (dto.project) {
      if (Types.ObjectId.isValid(dto.project)) {
        payload.project = new Types.ObjectId(dto.project);
      } else {
        payload.milestone = dto.project;
      }
    }
    if (dto.milestone && !payload.milestone) payload.milestone = dto.milestone;
    if (dto.dependsOnTask && Types.ObjectId.isValid(dto.dependsOnTask)) payload.dependsOnTask = new Types.ObjectId(dto.dependsOnTask);

    // Rule 1: PERSONAL Task - Self Assigned, Managed by User
    if (dto.taskType === TaskType.PERSONAL) {
      payload.assignedTo = new Types.ObjectId(userId);
      payload.assignedManager = new Types.ObjectId(userId);
      payload.reviewer = new Types.ObjectId(userId);
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
  async findAll(query: any, user: any): Promise<{ tasks: TaskDocument[]; total: number }> {
    const {
      status,
      priority,
      project,
      assignedTo,
      taskType,
      crossDeptStatus,
      reassignmentStatus,
      startDate,
      endDate,
      dateFilter,
      page = 1,
      limit = 50,
    } = query;
    const filter: any = {};

    const uId = user._id ? user._id.toString() : user.id;
    const userRole = (user.role || '').toLowerCase();
    const userDept = user.department || userRole;
    const userDeptRegex = new RegExp(`^${userDept}$`, 'i');

    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);

    // Team Member visibility: Only see assigned, created, or target cross-dept
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

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (taskType) filter.taskType = taskType;
    if (crossDeptStatus) filter.crossDeptStatus = crossDeptStatus;
    if (reassignmentStatus) filter.reassignmentStatus = reassignmentStatus;
    if (project) filter.project = new Types.ObjectId(project);
    if (assignedTo) filter.assignedTo = new Types.ObjectId(assignedTo);

    // Date Range / Month / Year Filtering
    if (dateFilter || startDate || endDate) {
      let start: Date | null = null;
      let end: Date | null = null;
      const now = new Date();

      if (dateFilter === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      } else if (dateFilter === 'this_week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        start = new Date(now.setDate(diff));
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      } else if (dateFilter === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
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
        filter.createdAt = dateCond;
      }
    }

    // Auto-mark overdue
    await this.taskModel.updateMany(
      {
        status: { $in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.REWORK] },
        dueDate: { $lt: new Date() },
      },
      { status: TaskStatus.OVERDUE },
    );

    const skip = (Number(page) - 1) * Number(limit);
    const [tasks, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .populate('project', 'name projectId status')
        .populate('client', 'companyName contactPerson')
        .populate('assignedTo', 'name email role department avatar')
        .populate('createdBy', 'name email role department')
        .populate('assignedManager', 'name email')
        .populate('crossDeptApprovedBy', 'name email')
        .populate('pendingNewAssignee', 'name email role department')
        .populate('reassignmentRequestedBy', 'name email role')
        .populate('dependsOnTask', 'title status')
        .skip(skip)
        .limit(Number(limit))
        .sort({ dueDate: 1, createdAt: -1 }),
      this.taskModel.countDocuments(filter),
    ]);

    return { tasks, total };
  }

  // Get Single Task Detail
  async findOne(id: string): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id)
      .populate('project', 'name projectId status')
      .populate('client', 'companyName contactPerson')
      .populate('assignedTo', 'name email role department designation avatar')
      .populate('createdBy', 'name email role department')
      .populate('assignedManager', 'name email')
      .populate('reviewer', 'name email')
      .populate('dependsOnTask', 'title status assignedTo')
      .populate('comments.user', 'name avatar role');

    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // Update Task Status with State Machine & Validation
  async updateStatus(id: string, dto: UpdateTaskStatusDto, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const oldStatus = task.status;
    const newStatus = dto.status;

    // Rule: ON_HOLD requires reason
    if (newStatus === TaskStatus.ON_HOLD && !dto.onHoldReason && !task.onHoldReason) {
      throw new BadRequestException('A reason is required to put a task ON HOLD');
    }

    // Rule: REWORK requires notes
    if (newStatus === TaskStatus.REWORK && !dto.reworkNotes && !dto.reviewComment) {
      throw new BadRequestException('Rework notes or review comments are required when returning a task for REWORK');
    }

    // Rule: Dependency check for COMPLETED status
    if (newStatus === TaskStatus.COMPLETED && task.dependsOnTask) {
      const parent = await this.taskModel.findById(task.dependsOnTask);
      if (parent && parent.status !== TaskStatus.COMPLETED) {
        throw new BadRequestException(`Cannot complete task because dependent task "${parent.title}" is not completed yet.`);
      }
    }

    // Rule: Client approval check for COMPLETED status
    if (newStatus === TaskStatus.COMPLETED && task.clientReviewRequired && !task.clientApproved) {
      throw new BadRequestException('Client approval is required before completing this deliverable task.');
    }

    task.status = newStatus;
    if (dto.onHoldReason) task.onHoldReason = dto.onHoldReason;
    if (dto.reworkNotes || dto.reviewComment) task.reworkNotes = dto.reworkNotes || dto.reviewComment || '';
    if (dto.bugFixSummary) task.bugFixSummary = dto.bugFixSummary;
    if (dto.bugFixCommitLink) task.bugFixCommitLink = dto.bugFixCommitLink;

    if (newStatus === TaskStatus.COMPLETED) {
      task.completedAt = new Date();
      if (task.taskType === TaskType.BUG) {
        task.bugQaApproved = true;
      }
    }

    const saved = await task.save();

    await this.logAudit(
      saved._id,
      `STATUS_CHANGED_${newStatus}`,
      user,
      oldStatus,
      newStatus,
      dto.reviewComment || dto.reworkNotes || dto.onHoldReason || `Status updated to ${newStatus}`,
    );

    if (saved.project) {
      await this.syncProjectProgress(saved.project.toString());
    }

    // If dependency completed, notify/unblock child tasks
    if (newStatus === TaskStatus.COMPLETED) {
      await this.taskModel.updateMany(
        { dependsOnTask: saved._id, status: TaskStatus.ON_HOLD },
        { isDependencyResolved: true, status: TaskStatus.IN_PROGRESS },
      );
    }

    return saved;
  }

  // General Update
  async update(id: string, dto: any, user: any): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    const payload = { ...dto };
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.client) payload.client = new Types.ObjectId(dto.client);
    if (dto.assignedTo) payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    if (dto.dependsOnTask) payload.dependsOnTask = new Types.ObjectId(dto.dependsOnTask);

    const updated = await this.taskModel.findByIdAndUpdate(id, payload, { new: true });
    if (!updated) throw new NotFoundException('Task not found');

    await this.logAudit(id, 'TASK_UPDATED', user, undefined, undefined, 'Task details updated');

    if (updated.project) {
      await this.syncProjectProgress(updated.project.toString());
    }

    return updated;
  }

  // Delete Task
  async remove(id: string, user: any): Promise<void> {
    const task = await this.taskModel.findByIdAndDelete(id);
    if (!task) throw new NotFoundException('Task not found');
    await this.logAudit(id, 'TASK_DELETED', user, undefined, undefined, `Task ${task.title} deleted`);
    if (task.project) {
      await this.syncProjectProgress(task.project.toString());
    }
  }

  // Work Session & Timer Logging
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

    // Update actual hours on task
    if (dto.taskId) {
      const task = await this.taskModel.findById(dto.taskId);
      if (task) {
        task.actualHours = (task.actualHours || 0) + Math.round((dto.durationSeconds / 3600) * 10) / 10;
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
    const match: any = { status: { $ne: TaskStatus.COMPLETED } };

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

    return this.taskModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { department: '$department', assignedTo: '$assignedTo' },
          totalTasks: { $sum: 1 },
          overdueTasks: {
            $sum: { $cond: [{ $eq: ['$status', TaskStatus.OVERDUE] }, 1, 0] },
          },
          totalEstHours: { $sum: '$estimatedHours' },
        },
      },
    ]);
  }
}
