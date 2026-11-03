import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Timesheet,
  TimesheetDocument,
  TimesheetStatus,
} from './schemas/timesheet.schema';
import {
  TimeEntry,
  TimeEntryDocument,
} from '../tasks/schemas/time-entry.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
  ApprovalStatus,
} from '../approvals/schemas/approval-record.schema';
import {
  ApproveTimesheetDto,
  GenerateTimesheetDto,
} from './dto/generate-timesheet.dto';

@Injectable()
export class TimesheetsService {
  constructor(
    @InjectModel(Timesheet.name)
    private timesheetModel: Model<TimesheetDocument>,
    @InjectModel(TimeEntry.name)
    private timeEntryModel: Model<TimeEntryDocument>,
    private approvalsService: ApprovalsService,
  ) {}

  async generateWeeklyTimesheet(
    userId: string,
    dto: GenerateTimesheetDto,
  ): Promise<TimesheetDocument> {
    const targetEmployeeId = dto.employeeId || userId;
    if (!Types.ObjectId.isValid(targetEmployeeId)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const start = new Date(dto.periodStartDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(dto.periodEndDate);
    end.setHours(23, 59, 59, 999);

    if (start >= end) {
      throw new BadRequestException('periodStartDate must be before periodEndDate');
    }

    // Find all completed time entries for the user in this window
    const timeEntries = await this.timeEntryModel
      .find({
        user: new Types.ObjectId(targetEmployeeId),
        startTime: { $gte: start, $lte: end },
        isLive: false,
      })
      .populate('task', 'title')
      .populate('project', 'name')
      .sort({ startTime: 1 })
      .exec();

    const formattedEntries = timeEntries.map((te: any) => {
      const hours = Math.round(((te.durationSeconds || 0) / 3600) * 100) / 100;
      return {
        timeEntry: te._id,
        date: te.startTime,
        hours,
        taskTitle: te.task?.title || 'General Task Session',
        projectTitle: te.project?.name || 'General Project',
        isBillable: te.isBillable !== false,
        notes: te.notes || '',
      };
    });

    const totalLoggedHours = formattedEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalBillableHours = formattedEntries
      .filter((e) => e.isBillable)
      .reduce((sum, e) => sum + e.hours, 0);

    // Standard baseline: 40 working hours per week (5 business days * 8h)
    const standardWeekHours = 40;
    const utilizationPercentage = Math.round((totalLoggedHours / standardWeekHours) * 100 * 10) / 10;
    const billableUtilizationPercentage = Math.round((totalBillableHours / standardWeekHours) * 100 * 10) / 10;

    let timesheet = await this.timesheetModel.findOne({
      employee: new Types.ObjectId(targetEmployeeId),
      periodStartDate: start,
    });

    if (timesheet) {
      if (timesheet.isLocked) {
        throw new BadRequestException('Timesheet for this period is already approved and locked');
      }
      timesheet.periodEndDate = end;
      timesheet.entries = formattedEntries;
      timesheet.totalLoggedHours = Math.round(totalLoggedHours * 100) / 100;
      timesheet.totalBillableHours = Math.round(totalBillableHours * 100) / 100;
      timesheet.utilizationPercentage = utilizationPercentage;
      timesheet.billableUtilizationPercentage = billableUtilizationPercentage;
      return timesheet.save();
    }

    timesheet = new this.timesheetModel({
      employee: new Types.ObjectId(targetEmployeeId),
      periodStartDate: start,
      periodEndDate: end,
      status: TimesheetStatus.DRAFT,
      totalLoggedHours: Math.round(totalLoggedHours * 100) / 100,
      totalBillableHours: Math.round(totalBillableHours * 100) / 100,
      utilizationPercentage,
      billableUtilizationPercentage,
      entries: formattedEntries,
    });

    return timesheet.save();
  }

  async submit(id: string, userId: string): Promise<TimesheetDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid timesheet ID');

    const timesheet = await this.timesheetModel.findById(id);
    if (!timesheet) throw new NotFoundException('Timesheet not found');

    if (timesheet.employee.toString() !== userId.toString()) {
      throw new ForbiddenException('You can only submit your own timesheet');
    }

    if (timesheet.isLocked) {
      throw new BadRequestException('Timesheet is locked and cannot be re-submitted');
    }

    timesheet.status = TimesheetStatus.SUBMITTED;
    timesheet.submittedAt = new Date();
    return timesheet.save();
  }

  async approveOrReject(
    id: string,
    approverUser: any,
    dto: ApproveTimesheetDto,
  ): Promise<TimesheetDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid timesheet ID');

    const timesheet = await this.timesheetModel.findById(id);
    if (!timesheet) throw new NotFoundException('Timesheet not found');

    if (dto.action === 'APPROVE') {
      timesheet.status = TimesheetStatus.APPROVED;
      timesheet.approvedBy = new Types.ObjectId(approverUser._id);
      timesheet.approvedAt = new Date();
      timesheet.isLocked = true;
      if (dto.comments) timesheet.managerComments = dto.comments;

      // Lock all underlying time entries
      const entryIds: Types.ObjectId[] = timesheet.entries
        .map((e) => e.timeEntry)
        .filter((teId): teId is Types.ObjectId => Boolean(teId && Types.ObjectId.isValid(teId.toString())));

      if (entryIds.length > 0) {
        await this.timeEntryModel.updateMany(
          { _id: { $in: entryIds } },
          { $set: { isLocked: true } },
        );
      }

      // Log in Governance Approval Records
      await this.approvalsService.createRequest(approverUser._id, {
        entityType: ApprovalEntityType.TIMESHEET,
        entityId: timesheet._id.toString(),
        approvalType: 'TIMESHEET_APPROVAL',
        comments: `Timesheet ${timesheet.timesheetId} approved (${timesheet.totalLoggedHours}h, ${timesheet.totalBillableHours}h billable)`,
        metadata: {
          totalHours: timesheet.totalLoggedHours,
          billableHours: timesheet.totalBillableHours,
          utilization: timesheet.utilizationPercentage,
        },
      });
    } else {
      timesheet.status = TimesheetStatus.REJECTED;
      timesheet.rejectionReason = dto.rejectionReason || 'Timesheet rejected by reviewer';
      if (dto.comments) timesheet.managerComments = dto.comments;
    }

    return timesheet.save();
  }

  async findPending(): Promise<TimesheetDocument[]> {
    return this.timesheetModel
      .find({ status: TimesheetStatus.SUBMITTED })
      .populate('employee', 'name email employeeId department designation avatar')
      .sort({ submittedAt: 1 })
      .exec();
  }

  async getMyTimesheets(userId: string): Promise<TimesheetDocument[]> {
    return this.timesheetModel
      .find({ employee: new Types.ObjectId(userId) })
      .populate('approvedBy', 'name email')
      .sort({ periodStartDate: -1 })
      .exec();
  }

  async findOne(id: string): Promise<TimesheetDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid timesheet ID');
    const doc = await this.timesheetModel
      .findById(id)
      .populate('employee', 'name email employeeId department designation avatar')
      .populate('approvedBy', 'name email')
      .exec();

    if (!doc) throw new NotFoundException('Timesheet not found');
    return doc;
  }
}
