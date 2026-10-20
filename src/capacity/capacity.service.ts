import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import { Project, ProjectDocument, ProjectStatus } from '../projects/schemas/project.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { Leave, LeaveDocument } from '../leaves/schemas/leave.schema';
import { TimeEntry, TimeEntryDocument } from '../tasks/schemas/time-entry.schema';
import { Setting, SettingDocument } from '../settings/schemas/setting.schema';
import { CheckProjectCapacityDto } from './dto/check-project.dto';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  businessDays: number;
}

@Injectable()
export class CapacityService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(Setting.name) private settingModel: Model<SettingDocument>,
  ) {}

  // Standard Department Taxonomy
  public readonly DEPARTMENTS = [
    { id: 'development', name: 'Development' },
    { id: 'design', name: 'Design and Frontend' },
    { id: 'backend', name: 'Backend' },
    { id: 'digital_marketing', name: 'SEO and Digital Marketing' },
    { id: 'sales', name: 'Sales and Business Development' },
    { id: 'hr', name: 'HR and Administration' },
    { id: 'support', name: 'Customer Support' },
    { id: 'product', name: 'Product Teams' },
  ];

  // Helper: Count business days (Mon - Fri) between two dates inclusive
  private countBusinessDays(startDate: Date, endDate: Date): number {
    let cur = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, count);
  }

  // Helper: Resolve timeframe preset into standard DateRange
  private resolveDateRange(timeframe: string, customStart?: string, customEnd?: string): DateRange {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (timeframe === 'today') {
      // 1 day
    } else if (timeframe === 'this_week') {
      const dayOfWeek = now.getDay();
      const distanceToMon = (dayOfWeek + 6) % 7;
      start = new Date(now);
      start.setDate(now.getDate() - distanceToMon);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeframe === 'next_30_days') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 30);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'custom' && customStart && customEnd) {
      start = new Date(customStart);
      start.setHours(0, 0, 0, 0);
      end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
    } else {
      // Default: This Month
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const businessDays = this.countBusinessDays(start, end);
    return { startDate: start, endDate: end, businessDays };
  }

  // Helper: Match department string flexibly
  private matchDepartment(userDept: string, targetDeptId: string): boolean {
    const ud = (userDept || '').toLowerCase().trim();
    const td = targetDeptId.toLowerCase().trim();

    if (td === 'development') {
      return ud.includes('dev') || ud.includes('tech') || ud.includes('software');
    }
    if (td === 'design') {
      return ud.includes('design') || ud.includes('ui') || ud.includes('ux') || ud.includes('frontend') || ud.includes('graphics');
    }
    if (td === 'backend') {
      return ud.includes('backend') || ud.includes('api') || ud.includes('database') || ud.includes('server');
    }
    if (td === 'digital_marketing') {
      return ud.includes('market') || ud.includes('seo') || ud.includes('content') || ud.includes('ads') || ud.includes('social');
    }
    if (td === 'sales') {
      return ud.includes('sales') || ud.includes('business') || ud.includes('bd') || ud.includes('lead');
    }
    if (td === 'hr') {
      return ud.includes('hr') || ud.includes('admin') || ud.includes('operations') || ud.includes('management') || ud.includes('executive');
    }
    if (td === 'support') {
      return ud.includes('support') || ud.includes('service') || ud.includes('helpdesk');
    }
    if (td === 'product') {
      return ud.includes('product') || ud.includes('qa') || ud.includes('quality');
    }
    return ud === td;
  }

  // 1. Central Capacity Overview & KPI Summary
  async getCapacityOverview(query: any, user: any): Promise<any> {
    const {
      timeframe = 'this_month',
      startDate: customStart,
      endDate: customEnd,
      department: filterDept,
    } = query;

    const range = this.resolveDateRange(timeframe, customStart, customEnd);
    const userRole = (user?.role || '').toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user?.role) ||
      ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);
    const isDeptHead = Boolean(user?.isDepartmentHead) || ['manager', 'head', 'lead'].includes(userRole);
    const userDept = user?.department || userRole;

    // RBAC Scope Filter
    const userFilter: any = { isActive: true };
    const isSales = userRole === 'sales' || (user?.department || '').toLowerCase() === 'sales';
    if (!isSuperAdmin && !isSales && isDeptHead && userDept && !filterDept) {
      userFilter.department = new RegExp(`^${userDept}$`, 'i');
    } else if (filterDept) {
      userFilter.department = new RegExp(filterDept, 'i');
    }

    // 1. Fetch Active Users
    const activeUsers = await this.userModel.find(userFilter).select('name email role department designation dailyWorkingHours skills avatar employeeId').lean();
    const userIds = activeUsers.map(u => u._id);

    // 2. Fetch Active Projects
    const projectFilter: any = {
      status: { $in: [ProjectStatus.ASSIGNED, ProjectStatus.STARTED, ProjectStatus.IN_PROGRESS, ProjectStatus.REVIEW, ProjectStatus.CLIENT_REVIEW] },
    };
    if (filterDept) {
      projectFilter.department = new RegExp(filterDept, 'i');
    }
    const activeProjects = await this.projectModel.find(projectFilter).populate('client', 'name company').lean();

    // 3. Fetch Active Tasks
    const taskFilter: any = {
      status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      taskType: { $ne: 'PERSONAL' },
    };
    if (userIds.length > 0 && !isSuperAdmin) {
      taskFilter.assignedTo = { $in: userIds };
    }
    if (filterDept) {
      taskFilter.department = new RegExp(filterDept, 'i');
    }
    const activeTasks = await this.taskModel.find(taskFilter).populate('assignedTo', 'name email department').populate('client', 'name company').lean();

    // 4. Fetch Approved Leaves during the period
    const approvedLeaves = await this.leaveModel.find({
      employee: { $in: userIds },
      status: 'approved',
      fromDate: { $lte: range.endDate },
      toDate: { $gte: range.startDate },
    }).lean();

    // 5. Calculate Employee-by-Employee Capacity
    let totalTeamCapacityHours = 0;
    let totalHoursCommitted = 0;
    let totalActualHoursLogged = 0;
    let overloadedCount = 0;
    const employeeRoster: any[] = [];

    // Map leaves by employee
    const leavesByEmp = new Map<string, any[]>();
    for (const l of approvedLeaves) {
      const empId = l.employee?.toString();
      if (!leavesByEmp.has(empId)) leavesByEmp.set(empId, []);
      leavesByEmp.get(empId)!.push(l);
    }

    // Map active tasks by assignee
    const tasksByEmp = new Map<string, any[]>();
    let unassignedTasksCount = 0;
    let unassignedCommittedHours = 0;

    const activeUserIdsSet = new Set(userIds.map(id => id.toString()));

    for (const t of activeTasks) {
      const aId = t.assignedTo?._id ? t.assignedTo._id.toString() : (t.assignedTo ? t.assignedTo.toString() : null);
      if (!aId || !activeUserIdsSet.has(aId)) {
        unassignedTasksCount++;
        const remH = Math.max(0, (t.estimatedHours || 0) - (t.actualHours || 0));
        unassignedCommittedHours += remH > 0 ? remH : (t.status === 'IN_PROGRESS' ? 1 : 0);
        continue;
      }
      if (!tasksByEmp.has(aId)) tasksByEmp.set(aId, []);
      tasksByEmp.get(aId)!.push(t);
    }

    for (const emp of activeUsers) {
      const empId = emp._id.toString();
      const stdDailyHours = emp.dailyWorkingHours || 8;
      const empLeaves = leavesByEmp.get(empId) || [];

      // Calculate approved leave hours in this period
      let leaveDaysCount = 0;
      for (const lv of empLeaves) {
        const lvStart = new Date(Math.max(new Date(lv.fromDate).getTime(), range.startDate.getTime()));
        const lvEnd = new Date(Math.min(new Date(lv.toDate).getTime(), range.endDate.getTime()));
        leaveDaysCount += this.countBusinessDays(lvStart, lvEnd);
      }
      const leaveHours = leaveDaysCount * stdDailyHours;

      // Net working hours = (business days * daily hours) - approved leave hours
      const rawWorkingHours = range.businessDays * stdDailyHours;
      const netWorkingHours = Math.max(0, rawWorkingHours - leaveHours);

      // Assigned tasks & remaining planned workload
      const empTasks = tasksByEmp.get(empId) || [];
      let plannedWorkloadHours = 0;
      let actualLogged = 0;
      let overdueTasksCount = 0;
      const nowMs = Date.now();

      for (const t of empTasks) {
        actualLogged += Number(t.actualHours || 0);
        const estH = Number(t.estimatedHours || 0);
        const actH = Number(t.actualHours || 0);
        // Formula: Remaining estimated effort for in-progress tasks
        const rem = Math.max(0, estH - actH);
        plannedWorkloadHours += rem > 0 ? rem : (t.status === 'IN_PROGRESS' ? 1 : 0);

        if (t.dueDate && new Date(t.dueDate).getTime() < nowMs) {
          overdueTasksCount++;
        }
      }

      plannedWorkloadHours = Number(plannedWorkloadHours.toFixed(1));
      actualLogged = Number(actualLogged.toFixed(1));

      // Available Capacity = Net Working Hours - Planned Workload
      const availableCapacity = Number(Math.max(0, netWorkingHours - plannedWorkloadHours).toFixed(1));
      const capacityDeficit = plannedWorkloadHours > netWorkingHours ? Number((plannedWorkloadHours - netWorkingHours).toFixed(1)) : 0;
      const utilizationPercent = netWorkingHours > 0 ? Math.round((plannedWorkloadHours / netWorkingHours) * 100) : (plannedWorkloadHours > 0 ? 999 : 0);

      // Workload status classification
      let status = 'OPTIMAL';
      let statusColor = 'emerald';
      if (utilizationPercent > 100) {
        status = 'OVERLOADED';
        statusColor = 'red';
        overloadedCount++;
      } else if (utilizationPercent >= 85) {
        status = 'NEAR_CAPACITY';
        statusColor = 'amber';
      } else if (utilizationPercent < 40) {
        status = 'UNDER_UTILIZED';
        statusColor = 'blue';
      }

      totalTeamCapacityHours += netWorkingHours;
      totalHoursCommitted += plannedWorkloadHours;
      totalActualHoursLogged += actualLogged;

      employeeRoster.push({
        _id: emp._id,
        name: emp.name,
        email: emp.email,
        department: emp.department || 'General',
        designation: emp.designation || 'Specialist',
        avatar: emp.avatar,
        skills: emp.skills || [],
        dailyWorkingHours: stdDailyHours,
        businessDays: range.businessDays,
        leaveDays: leaveDaysCount,
        leaveHours,
        netWorkingHours,
        plannedWorkloadHours,
        actualLoggedHours: actualLogged,
        availableCapacity,
        capacityDeficit,
        utilizationPercent,
        activeTasksCount: empTasks.length,
        overdueTasksCount,
        status,
        statusColor,
      });
    }

    // Add unassigned committed hours to totals
    totalHoursCommitted += unassignedCommittedHours;
    totalHoursCommitted = Number(totalHoursCommitted.toFixed(1));
    totalTeamCapacityHours = Number(totalTeamCapacityHours.toFixed(1));
    const totalAvailableHours = Number(Math.max(0, totalTeamCapacityHours - totalHoursCommitted).toFixed(1));
    const overallUtilizationPercent = totalTeamCapacityHours > 0 ? Math.round((totalHoursCommitted / totalTeamCapacityHours) * 100) : 0;

    // Upcoming Deadlines (due in next 7 days)
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);
    const upcomingDeadlinesCount = activeTasks.filter(t => t.dueDate && new Date(t.dueDate) <= in7Days).length +
      activeProjects.filter(p => p.deadline && new Date(p.deadline) <= in7Days).length;

    // Determine New Project Readiness
    let projectReadiness = 'EXCELLENT';
    let projectReadinessText = 'High availability across departments. Ready to onboard new projects immediately.';
    let projectReadinessColor = 'emerald';

    if (overallUtilizationPercent > 95 || overloadedCount >= activeUsers.length * 0.4) {
      projectReadiness = 'CAPACITY_FULL';
      projectReadinessText = 'Team is at peak workload capacity. Delay new commitments or recruit additional capacity.';
      projectReadinessColor = 'red';
    } else if (overallUtilizationPercent >= 85 || overloadedCount > 0) {
      projectReadiness = 'LIMITED_CAPACITY';
      projectReadinessText = 'Limited capacity. Selective project intake recommended with phased start dates.';
      projectReadinessColor = 'amber';
    } else if (overallUtilizationPercent >= 70) {
      projectReadiness = 'MODERATE';
      projectReadinessText = 'Balanced workload. Moderate projects can be scheduled without strain.';
      projectReadinessColor = 'indigo';
    }

    // 6. Department Breakdown Matrix (8 Departments)
    const departmentBreakdown = this.DEPARTMENTS.map(dept => {
      const deptEmployees = employeeRoster.filter(e => this.matchDepartment(e.department, dept.id));
      const empCount = deptEmployees.length;
      const netCap = deptEmployees.reduce((acc, e) => acc + e.netWorkingHours, 0);
      const planned = deptEmployees.reduce((acc, e) => acc + e.plannedWorkloadHours, 0);
      const actual = deptEmployees.reduce((acc, e) => acc + e.actualLoggedHours, 0);
      const avail = Math.max(0, netCap - planned);
      const util = netCap > 0 ? Math.round((planned / netCap) * 100) : (planned > 0 ? 100 : 0);
      const overloadedEmpCount = deptEmployees.filter(e => e.utilizationPercent > 100).length;
      const overdueCount = deptEmployees.reduce((acc, e) => acc + e.overdueTasksCount, 0);

      let deptStatus = 'HEALTHY';
      if (util > 100) deptStatus = 'OVERLOADED';
      else if (util >= 85) deptStatus = 'STRAINED';
      else if (util < 50 && empCount > 0) deptStatus = 'AVAILABLE';

      return {
        id: dept.id,
        name: dept.name,
        employeeCount: empCount,
        netCapacityHours: Number(netCap.toFixed(1)),
        plannedWorkloadHours: Number(planned.toFixed(1)),
        actualLoggedHours: Number(actual.toFixed(1)),
        availableCapacityHours: Number(avail.toFixed(1)),
        utilizationPercent: util,
        overloadedEmployeeCount: overloadedEmpCount,
        overdueTaskCount: overdueCount,
        status: deptStatus,
      };
    });

    // 7. Smart Alerts Generation (Section 8)
    const smartAlerts: any[] = [];

    // Overloaded employees alert
    const criticalOverloaded = employeeRoster.filter(e => e.utilizationPercent > 100);
    if (criticalOverloaded.length > 0) {
      smartAlerts.push({
        type: 'EMPLOYEE_OVERLOAD',
        severity: 'critical',
        title: `${criticalOverloaded.length} Employee${criticalOverloaded.length > 1 ? 's' : ''} Exceeding 100% Capacity`,
        message: `${criticalOverloaded.map(e => `${e.name} (${e.utilizationPercent}%)`).join(', ')} currently have more assigned workload than their net available working hours.`,
        action: 'Reallocate tasks or extend deadlines.',
      });
    }

    // High capacity warning (85% - 100%)
    const strainedEmployees = employeeRoster.filter(e => e.utilizationPercent >= 85 && e.utilizationPercent <= 100);
    if (strainedEmployees.length > 0) {
      smartAlerts.push({
        type: 'CAPACITY_STRAIN',
        severity: 'warning',
        title: `${strainedEmployees.length} Employee${strainedEmployees.length > 1 ? 's' : ''} Approaching Full Capacity (85% - 100%)`,
        message: `${strainedEmployees.map(e => e.name).join(', ')} are close to their safe working threshold.`,
        action: 'Avoid assigning new urgent deliverables.',
      });
    }

    // Department strains
    const strainedDepts = departmentBreakdown.filter(d => d.utilizationPercent >= 85 && d.employeeCount > 0);
    for (const sd of strainedDepts) {
      smartAlerts.push({
        type: 'DEPARTMENT_STRAIN',
        severity: sd.utilizationPercent > 100 ? 'critical' : 'warning',
        title: `Department Bottleneck: ${sd.name} (${sd.utilizationPercent}% Booked)`,
        message: `${sd.name} has committed ${sd.plannedWorkloadHours}h against ${sd.netCapacityHours}h available capacity.`,
        action: 'New client projects in this department will require revised delivery dates or external hiring.',
      });
    }

    // Projects with upcoming deadlines and low progress
    const atRiskProjects = activeProjects.filter(p => {
      if (!p.deadline) return false;
      const daysLeft = (new Date(p.deadline).getTime() - Date.now()) / (1000 * 3600 * 24);
      return daysLeft > 0 && daysLeft <= 10 && (p.progress || 0) < 60;
    });
    for (const arp of atRiskProjects) {
      smartAlerts.push({
        type: 'PROJECT_AT_RISK',
        severity: 'warning',
        title: `Deadline at Risk: Project "${arp.name}"`,
        message: `Project is at ${arp.progress || 0}% progress with deadline in ${Math.round((new Date(arp.deadline).getTime() - Date.now()) / (1000 * 3600 * 24))} days.`,
        action: 'Review milestone backlog and team availability.',
      });
    }

    // Leaves affecting active projects
    const upcomingLeavesNearDeadlines = approvedLeaves.filter(lv => {
      const empId = lv.employee?.toString();
      const empTasks = tasksByEmp.get(empId) || [];
      return empTasks.some(t => t.dueDate && new Date(t.dueDate) >= new Date(lv.fromDate) && new Date(t.dueDate) <= new Date(lv.toDate));
    });
    if (upcomingLeavesNearDeadlines.length > 0) {
      smartAlerts.push({
        type: 'LEAVE_COLLISION',
        severity: 'info',
        title: `${upcomingLeavesNearDeadlines.length} Approved Leave${upcomingLeavesNearDeadlines.length > 1 ? 's' : ''} Overlapping With Task Deadlines`,
        message: 'Assigned team members have approved leave during upcoming task commitment dates.',
        action: 'Reassign dependent subtasks in advance.',
      });
    }

    // 8. Hiring & Resource Forecast (Section 6)
    const hiringForecast = departmentBreakdown
      .filter(d => d.employeeCount > 0 && d.plannedWorkloadHours > d.netCapacityHours * 0.85)
      .map(d => {
        const safeNetCap = d.netCapacityHours * 0.85;
        const shortfallHours = Math.max(0, d.plannedWorkloadHours - safeNetCap);
        // Assuming ~160 hours standard monthly output per full-time staff
        const monthlyHoursPerStaff = Math.max(1, range.businessDays * 8);
        const headcountNeeded = Math.ceil(shortfallHours / monthlyHoursPerStaff);

        let urgency = 'Next 30 Days';
        if (d.utilizationPercent > 120) urgency = 'Immediate (Within 7-14 Days)';
        else if (d.utilizationPercent > 100) urgency = 'High Priority (Next 14-21 Days)';

        return {
          departmentId: d.id,
          departmentName: d.name,
          currentHeadcount: d.employeeCount,
          shortfallHours: Number(shortfallHours.toFixed(1)),
          suggestedHeadcount: headcountNeeded,
          urgency,
          recommendedAction: `Recruit ${headcountNeeded} additional specialist(s) in ${d.name} or outsource overflow workloads.`,
        };
      });

    return {
      timeframe,
      dateRange: {
        startDate: range.startDate.toISOString().split('T')[0],
        endDate: range.endDate.toISOString().split('T')[0],
        businessDays: range.businessDays,
      },
      summary: {
        activeProjects: activeProjects.length,
        activeTasks: activeTasks.length,
        unassignedTasks: unassignedTasksCount,
        teamCapacityHours: totalTeamCapacityHours,
        hoursCommitted: totalHoursCommitted,
        availableHours: totalAvailableHours,
        actualHoursLogged: totalActualHoursLogged,
        utilizationPercent: overallUtilizationPercent,
        overloadedEmployeesCount: overloadedCount,
        upcomingDeadlinesCount,
        projectReadiness: {
          status: projectReadiness,
          text: projectReadinessText,
          color: projectReadinessColor,
        },
      },
      employeeRoster: employeeRoster.sort((a, b) => b.utilizationPercent - a.utilizationPercent),
      departmentBreakdown,
      smartAlerts,
      hiringForecast,
    };
  }

  // 2. Structured Calendar Events for Day, Week, Month & Timeline/Gantt Views
  async getCalendarEvents(query: any, user: any): Promise<any> {
    const {
      view = 'month',
      startDate: qStart,
      endDate: qEnd,
      department,
      employee,
      client,
      project,
      priority,
      status,
    } = query;

    const now = new Date();
    let start = qStart ? new Date(qStart) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let end = qEnd ? new Date(qEnd) : new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const taskQuery: any = {
      $or: [
        { dueDate: { $gte: start, $lte: end } },
        { startDate: { $gte: start, $lte: end } },
      ],
    };
    if (department) taskQuery.department = new RegExp(department, 'i');
    if (employee && Types.ObjectId.isValid(employee)) taskQuery.assignedTo = new Types.ObjectId(employee);
    if (client && Types.ObjectId.isValid(client)) taskQuery.client = new Types.ObjectId(client);
    if (project && Types.ObjectId.isValid(project)) taskQuery.project = new Types.ObjectId(project);
    if (priority) taskQuery.priority = priority;
    if (status) taskQuery.status = status;

    const projectQuery: any = {
      $or: [
        { startDate: { $gte: start, $lte: end } },
        { deadline: { $gte: start, $lte: end } },
      ],
    };
    if (department) projectQuery.department = new RegExp(department, 'i');
    if (client && Types.ObjectId.isValid(client)) projectQuery.client = new Types.ObjectId(client);
    if (status) projectQuery.status = status;

    const leaveQuery: any = {
      status: 'approved',
      $or: [
        { fromDate: { $lte: end }, toDate: { $gte: start } },
      ],
    };
    if (employee && Types.ObjectId.isValid(employee)) leaveQuery.employee = new Types.ObjectId(employee);

    const [tasks, projects, leaves] = await Promise.all([
      this.taskModel.find(taskQuery)
        .populate('assignedTo', 'name email department avatar')
        .populate('client', 'name company')
        .populate('project', 'name projectId')
        .lean(),
      this.projectModel.find(projectQuery)
        .populate('client', 'name company')
        .populate('assignedTo', 'name email')
        .lean(),
      this.leaveModel.find(leaveQuery)
        .populate('employee', 'name email department avatar')
        .lean(),
    ]);

    const events: any[] = [];

    // Map Tasks as Calendar Events
    for (const t of tasks) {
      const remainingHours = Math.max(0, (t.estimatedHours || 0) - (t.actualHours || 0));
      events.push({
        id: `task_${t._id}`,
        rawId: t._id,
        type: 'TASK',
        title: t.title,
        taskId: t.taskId || `HR-${t._id.toString().slice(-4).toUpperCase()}`,
        start: t.startDate || t.dueDate,
        end: t.dueDate,
        dueDate: t.dueDate,
        priority: t.priority || 'MEDIUM',
        status: t.status,
        department: t.department,
        assignee: t.assignedTo,
        client: t.client,
        clientName: t.clientName || (t.client as any)?.name,
        project: t.project,
        estimatedHours: t.estimatedHours || 0,
        actualHours: t.actualHours || 0,
        remainingHours,
        dependsOnTask: t.dependsOnTask,
        color: t.priority === 'CRITICAL' ? '#e11d48' : t.priority === 'HIGH' ? '#ea580c' : '#0284c7',
      });
    }

    // Map Projects as Timeline / Delivery Events
    for (const p of projects) {
      events.push({
        id: `prj_${p._id}`,
        rawId: p._id,
        type: 'PROJECT',
        title: `[Project] ${p.name}`,
        projectId: p.projectId,
        start: p.startDate,
        end: p.deadline,
        deadline: p.deadline,
        status: p.status,
        department: p.department,
        progress: p.progress || 0,
        client: p.client,
        clientName: (p.client as any)?.name || (p.client as any)?.company,
        assignedTo: p.assignedTo,
        value: p.value || 0,
        color: '#10b981',
      });
    }

    // Map Approved Leaves as Employee Availability Blocks
    for (const l of leaves) {
      events.push({
        id: `leave_${l._id}`,
        rawId: l._id,
        type: 'LEAVE',
        title: `[Leave] ${(l.employee as any)?.name || 'Employee'} (${l.type})`,
        start: l.fromDate,
        end: l.toDate,
        employee: l.employee,
        leaveType: l.type,
        reason: l.reason,
        color: '#8b5cf6',
      });
    }

    return {
      view,
      dateRange: { start, end },
      totalEvents: events.length,
      events,
    };
  }

  // 3. New Project Acceptance Calculator (Section 5)
  async evaluateProjectCapacity(dto: CheckProjectCapacityDto, user: any): Promise<any> {
    const {
      projectName,
      department,
      requiredSkills = [],
      estimatedHours,
      proposedStartDate,
      expectedDeliveryDate,
      priority = 'HIGH',
      complexity = 'Medium',
    } = dto;

    const start = new Date(proposedStartDate);
    start.setHours(0, 0, 0, 0);
    const delivery = new Date(expectedDeliveryDate);
    delivery.setHours(23, 59, 59, 999);

    if (delivery.getTime() <= start.getTime()) {
      throw new BadRequestException('Expected delivery date must be later than the proposed start date');
    }

    const businessDaysInWindow = this.countBusinessDays(start, delivery);

    // 1. Fetch Candidate Employees in target Department
    const candidates = await this.userModel.find({
      isActive: true,
      department: new RegExp(department, 'i'),
    }).select('name email department designation skills dailyWorkingHours avatar').lean();

    if (candidates.length === 0) {
      return {
        recommendation: 'HIRING_RECOMMENDED',
        statusColor: 'rose',
        confidenceScore: 95,
        summary: `No active staff found in department "${department}". Hiring or outsourcing is mandatory.`,
        earliestFeasibleStartDate: proposedStartDate,
        estimatedCompletionDate: expectedDeliveryDate,
        totalQualifiedAvailableHours: 0,
        requiredHours: estimatedHours,
        shortfallHours: estimatedHours,
        businessDaysInWindow,
        candidateEmployees: [],
        impactedProjects: [],
        suggestions: [
          `Recruit full-time or contract specialists in ${department}.`,
          `Outsource initial phase to verified agency partners.`,
        ],
      };
    }

    // 2. Filter / Score Candidates by Required Skills if provided
    const candidateAssessments: any[] = [];
    let totalQualifiedSafeCapacity = 0;

    for (const cand of candidates) {
      const stdDailyH = cand.dailyWorkingHours || 8;
      const rawWindowHours = businessDaysInWindow * stdDailyH;

      // Leaves in window
      const leaves = await this.leaveModel.find({
        employee: cand._id,
        status: 'approved',
        fromDate: { $lte: delivery },
        toDate: { $gte: start },
      }).lean();

      let leaveDays = 0;
      for (const lv of leaves) {
        const lS = new Date(Math.max(new Date(lv.fromDate).getTime(), start.getTime()));
        const lE = new Date(Math.min(new Date(lv.toDate).getTime(), delivery.getTime()));
        leaveDays += this.countBusinessDays(lS, lE);
      }
      const leaveH = leaveDays * stdDailyH;
      const netWorkingH = Math.max(0, rawWindowHours - leaveH);

      // Existing active tasks in window
      const activeTasks = await this.taskModel.find({
        assignedTo: cand._id,
        status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        dueDate: { $gte: start, $lte: delivery },
      }).lean();

      let existingCommitmentHours = 0;
      for (const t of activeTasks) {
        const rem = Math.max(0, (t.estimatedHours || 0) - (t.actualHours || 0));
        existingCommitmentHours += rem > 0 ? rem : 1;
      }

      // Safe capacity buffer: 85% maximum allocation to prevent burnout & risk
      const safeMaxHours = netWorkingH * 0.85;
      const freeAvailableHours = Math.max(0, safeMaxHours - existingCommitmentHours);

      // Skill Matching
      const candSkills = cand.skills || [];
      const matchedSkills = requiredSkills.filter(reqS =>
        candSkills.some(cs => cs.toLowerCase().includes(reqS.toLowerCase()))
      );
      const skillMatchPercent = requiredSkills.length > 0
        ? Math.round((matchedSkills.length / requiredSkills.length) * 100)
        : 100;

      totalQualifiedSafeCapacity += freeAvailableHours;

      candidateAssessments.push({
        _id: cand._id,
        name: cand.name,
        email: cand.email,
        department: cand.department,
        designation: cand.designation,
        skills: candSkills,
        matchedSkills,
        skillMatchPercent,
        netWorkingHours: Number(netWorkingH.toFixed(1)),
        existingCommitmentHours: Number(existingCommitmentHours.toFixed(1)),
        freeAvailableHours: Number(freeAvailableHours.toFixed(1)),
        utilizationInWindow: netWorkingH > 0 ? Math.round((existingCommitmentHours / netWorkingH) * 100) : 100,
      });
    }

    // 3. Determine Earliest Feasible Start Date
    // If available capacity in window is zero, project forward in 7-day increments
    let earliestStartDate = new Date(start);
    if (totalQualifiedSafeCapacity < estimatedHours * 0.5) {
      earliestStartDate.setDate(earliestStartDate.getDate() + 14);
    }

    // 4. Calculate Realistic Estimated Completion Date based on safe team velocity
    const teamDailyVelocityHours = candidateAssessments.reduce((acc, c) => acc + (c.freeAvailableHours / businessDaysInWindow), 0);
    const realisticWorkingDaysNeeded = teamDailyVelocityHours > 0
      ? Math.ceil(estimatedHours / Math.max(teamDailyVelocityHours, 2))
      : businessDaysInWindow * 2;

    const estimatedCompletionDate = new Date(earliestStartDate);
    let daysAdded = 0;
    while (daysAdded < realisticWorkingDaysNeeded) {
      estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + 1);
      const d = estimatedCompletionDate.getDay();
      if (d !== 0 && d !== 6) daysAdded++;
    }

    // Check affected ongoing projects with priority HIGH or CRITICAL
    const candidateIds = candidateAssessments.map(c => c._id);
    const impactedProjects = await this.projectModel.find({
      $or: [
        { assignedTo: { $in: candidateIds } },
        { 'assignedTeam.user': { $in: candidateIds } },
      ],
      status: { $in: [ProjectStatus.STARTED, ProjectStatus.IN_PROGRESS] },
      deadline: { $gte: start, $lte: delivery },
    }).select('name projectId deadline status progress').lean();

    // 5. Formulate Definitive Recommendation (Section 5)
    let recommendation = 'CAPACITY_AVAILABLE';
    let statusColor = 'emerald';
    let summary = '';
    const suggestions: string[] = [];

    const shortfallHours = Math.max(0, estimatedHours - totalQualifiedSafeCapacity);

    if (totalQualifiedSafeCapacity >= estimatedHours && estimatedCompletionDate <= delivery) {
      recommendation = 'CAPACITY_AVAILABLE';
      statusColor = 'emerald';
      summary = `The project can be safely accepted and scheduled with the existing ${department} team. Total safe capacity exceeds required hours by ${Math.round(totalQualifiedSafeCapacity - estimatedHours)} hours.`;
      suggestions.push('Assign primary tasks to top-matched specialists.');
      suggestions.push(`Proposed schedule meets delivery target (${delivery.toISOString().split('T')[0]}).`);
    } else if (totalQualifiedSafeCapacity >= estimatedHours * 0.7 && estimatedCompletionDate <= delivery) {
      recommendation = 'LIMITED_CAPACITY';
      statusColor = 'amber';
      summary = `Partial capacity available (${Math.round(totalQualifiedSafeCapacity)}h vs ${estimatedHours}h needed). Proceeding is feasible with tight buffer management.`;
      suggestions.push('Consider phasing non-critical deliverables to post-launch.');
      suggestions.push('Ensure senior oversight to prevent rework.');
    } else if (estimatedCompletionDate > delivery && totalQualifiedSafeCapacity >= estimatedHours * 0.5) {
      recommendation = 'DEADLINE_AT_RISK';
      statusColor = 'orange';
      summary = `Required hours can be completed, but the proposed delivery date (${delivery.toISOString().split('T')[0]}) is not feasible with current velocity. Earliest realistic completion is ${estimatedCompletionDate.toISOString().split('T')[0]}.`;
      suggestions.push(`Negotiate delivery date extension to ${estimatedCompletionDate.toISOString().split('T')[0]}.`);
      suggestions.push('Deploy sprint overtime or parallel cross-department allocation.');
    } else if (totalQualifiedSafeCapacity < estimatedHours * 0.4) {
      recommendation = 'CAPACITY_FULL';
      statusColor = 'red';
      summary = `Existing commitments leave insufficient capacity (${Math.round(totalQualifiedSafeCapacity)}h available vs ${estimatedHours}h required). Accepting without hiring will cause delivery failures across other projects.`;
      suggestions.push('Decline or place project on waiting list.');
      suggestions.push('Recruit dedicated contract developers to handle this engagement.');
    } else {
      recommendation = 'HIRING_RECOMMENDED';
      statusColor = 'purple';
      summary = `Capacity shortfall of ${Math.round(shortfallHours)} hours. Additional hiring or contractor onboarding required to satisfy delivery commitments.`;
      suggestions.push(`Recruit 1-2 specialists in ${department} before ${earliestStartDate.toISOString().split('T')[0]}.`);
    }

    return {
      projectName,
      department,
      recommendation,
      statusColor,
      summary,
      earliestFeasibleStartDate: earliestStartDate.toISOString().split('T')[0],
      estimatedCompletionDate: estimatedCompletionDate.toISOString().split('T')[0],
      proposedDeliveryDate: delivery.toISOString().split('T')[0],
      isDeliveryAchievable: estimatedCompletionDate <= delivery,
      requiredHours: estimatedHours,
      totalQualifiedAvailableHours: Number(totalQualifiedSafeCapacity.toFixed(1)),
      shortfallHours: Number(shortfallHours.toFixed(1)),
      businessDaysInWindow,
      candidateEmployees: candidateAssessments.sort((a, b) => b.freeAvailableHours - a.freeAvailableHours),
      impactedProjects,
      suggestions,
    };
  }

  // 4. Live Assignee Workload & Capacity Pre-flight Check (Section 9)
  async checkAssigneeCapacity(userId: string, estimatedHours = 0, dueDateStr?: string): Promise<any> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID provided');
    }

    const targetUser = await this.userModel.findById(userId).select('name email department dailyWorkingHours skills avatar').lean();
    if (!targetUser) throw new NotFoundException('Employee not found');

    const now = new Date();
    const dueDate = dueDateStr ? new Date(dueDateStr) : new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const businessDays = this.countBusinessDays(now, dueDate);
    const stdDailyH = targetUser.dailyWorkingHours || 8;
    const rawHours = businessDays * stdDailyH;

    // Approved leaves in window
    const leaves = await this.leaveModel.find({
      employee: targetUser._id,
      status: 'approved',
      fromDate: { $lte: dueDate },
      toDate: { $gte: now },
    }).lean();

    let leaveDays = 0;
    for (const lv of leaves) {
      const lS = new Date(Math.max(new Date(lv.fromDate).getTime(), now.getTime()));
      const lE = new Date(Math.min(new Date(lv.toDate).getTime(), dueDate.getTime()));
      leaveDays += this.countBusinessDays(lS, lE);
    }
    const netWorkingHours = Math.max(0, rawHours - (leaveDays * stdDailyH));

    // Active tasks
    const activeTasks = await this.taskModel.find({
      assignedTo: targetUser._id,
      status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      dueDate: { $gte: now, $lte: dueDate },
    }).lean();

    let currentPlannedHours = 0;
    for (const t of activeTasks) {
      const rem = Math.max(0, (t.estimatedHours || 0) - (t.actualHours || 0));
      currentPlannedHours += rem > 0 ? rem : 1;
    }

    const projectedWorkloadHours = currentPlannedHours + Number(estimatedHours);
    const currentUtilization = netWorkingHours > 0 ? Math.round((currentPlannedHours / netWorkingHours) * 100) : 100;
    const projectedUtilization = netWorkingHours > 0 ? Math.round((projectedWorkloadHours / netWorkingHours) * 100) : 100;
    const remainingFreeHours = Math.max(0, (netWorkingHours * 0.85) - currentPlannedHours);

    const isOverloaded = projectedUtilization > 100;
    const isNearCapacity = projectedUtilization >= 85 && !isOverloaded;

    // Suggest Alternative Available Employees in same department
    let alternativeEmployees: any[] = [];
    if (isOverloaded || isNearCapacity) {
      const peerUsers = await this.userModel.find({
        _id: { $ne: targetUser._id },
        department: new RegExp(`^${targetUser.department}$`, 'i'),
        isActive: true,
      }).select('name email designation avatar dailyWorkingHours').limit(5).lean();

      for (const peer of peerUsers) {
        const peerNetH = businessDays * (peer.dailyWorkingHours || 8);
        const peerTasks = await this.taskModel.find({
          assignedTo: peer._id,
          status: { $nin: [TaskStatus.DONE, TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
          dueDate: { $gte: now, $lte: dueDate },
        }).lean();
        let peerPlannedH = 0;
        for (const pt of peerTasks) {
          const rem = Math.max(0, (pt.estimatedHours || 0) - (pt.actualHours || 0));
          peerPlannedH += rem > 0 ? rem : 1;
        }
        const peerFree = Math.max(0, (peerNetH * 0.85) - peerPlannedH);
        const peerUtil = peerNetH > 0 ? Math.round((peerPlannedH / peerNetH) * 100) : 100;

        if (peerUtil < 85) {
          alternativeEmployees.push({
            _id: peer._id,
            name: peer.name,
            designation: peer.designation,
            avatar: peer.avatar,
            availableHours: Number(peerFree.toFixed(1)),
            currentUtilization: peerUtil,
          });
        }
      }
      alternativeEmployees = alternativeEmployees.sort((a, b) => b.availableHours - a.availableHours);
    }

    return {
      employee: {
        _id: targetUser._id,
        name: targetUser.name,
        department: targetUser.department,
        designation: targetUser.designation,
      },
      timeWindow: {
        businessDays,
        netWorkingHours: Number(netWorkingHours.toFixed(1)),
        currentPlannedHours: Number(currentPlannedHours.toFixed(1)),
        remainingFreeHours: Number(remainingFreeHours.toFixed(1)),
        currentUtilization,
        projectedUtilization,
      },
      isOverloaded,
      isNearCapacity,
      warningMessage: isOverloaded
        ? `Assigning this task (${estimatedHours}h) will overload ${targetUser.name} to ${projectedUtilization}% capacity.`
        : isNearCapacity
        ? `${targetUser.name} is close to capacity limit (${projectedUtilization}%).`
        : null,
      alternativeEmployees,
    };
  }
}
