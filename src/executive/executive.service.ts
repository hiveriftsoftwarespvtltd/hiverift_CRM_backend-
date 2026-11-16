import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ExecutiveSnapshot,
  ExecutiveSnapshotDocument,
} from './schemas/executive-snapshot.schema';
import { GeneralLedgerService } from '../general-ledger/general-ledger.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import { Timesheet, TimesheetDocument } from '../timesheets/schemas/timesheet.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { CloseMonthDto } from './dto/close-month.dto';

@Injectable()
export class ExecutiveService {
  constructor(
    @InjectModel(ExecutiveSnapshot.name)
    private snapshotModel: Model<ExecutiveSnapshotDocument>,
    @InjectModel(Project.name)
    private projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name)
    private taskModel: Model<TaskDocument>,
    @InjectModel(Timesheet.name)
    private timesheetModel: Model<TimesheetDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Client.name)
    private clientModel: Model<ClientDocument>,
    private glService: GeneralLedgerService,
    private reconService: ReconciliationService,
    private approvalsService: ApprovalsService,
  ) {}

  async calculateLiveMetrics(periodKey?: string) {
    const now = new Date();
    const period = periodKey || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const [
      accounts,
      arAgeing,
      apAgeing,
      activeProjectsCount,
      completedTasksCount,
      timesheets,
      newClientsCount,
      activeHeadcount,
    ] = await Promise.all([
      this.glService.getAllAccounts(),
      this.reconService.getArAgeingSummary(),
      this.reconService.getApAgeingSummary(),
      this.projectModel.countDocuments({ status: { $in: ['active', 'in_progress', 'review'] } }),
      this.taskModel.countDocuments({
        status: TaskStatus.DONE,
        updatedAt: { $gte: startDate, $lte: endDate },
      }),
      this.timesheetModel.find({
        periodStartDate: { $gte: startDate, $lte: endDate },
      }),
      this.clientModel.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
      }),
      this.userModel.countDocuments({ isActive: true, role: { $ne: 'client' } }),
    ]);

    // Financial aggregation from Chart of Accounts
    let totalRevenue = 0;
    let payrollCosts = 0;
    let operatingExpenses = 0;
    let cashAndBank = 0;

    for (const acc of accounts) {
      const bal = Math.abs(acc.currentBalance || 0);
      if (acc.accountCode.startsWith('4')) {
        totalRevenue += bal;
      } else if (acc.accountCode === '5010') {
        payrollCosts += bal;
      } else if (acc.accountCode.startsWith('5')) {
        operatingExpenses += bal;
      } else if (['1010', '1020'].includes(acc.accountCode)) {
        cashAndBank += acc.currentBalance || 0;
      }
    }

    totalRevenue = Math.round(totalRevenue * 100) / 100;
    payrollCosts = Math.round(payrollCosts * 100) / 100;
    operatingExpenses = Math.round(operatingExpenses * 100) / 100;
    cashAndBank = Math.round(cashAndBank * 100) / 100;

    const directCosts = 0; // Configurable direct project supplies
    const grossProfit = Math.round((totalRevenue - directCosts) * 100) / 100;
    const totalCosts = payrollCosts + operatingExpenses;
    const operatingProfit = Math.round((grossProfit - totalCosts) * 100) / 100;
    const operatingMarginPercentage =
      totalRevenue > 0
        ? Math.round((operatingProfit / totalRevenue) * 100 * 10) / 10
        : 0;

    // Working Capital
    const accountsReceivable = arAgeing.totalArOutstanding;
    const accountsPayable = apAgeing.totalApOutstanding;
    const netWorkingCapital = Math.round((accountsReceivable + cashAndBank - accountsPayable) * 100) / 100;

    // Timesheet Aggregations
    const timesheetLoggedHours = Math.round(
      timesheets.reduce((sum, t) => sum + (t.totalLoggedHours || 0), 0) * 10,
    ) / 10;
    const avgUtilization =
      timesheets.length > 0
        ? Math.round(
            (timesheets.reduce((sum, t) => sum + (t.billableUtilizationPercentage || 0), 0) /
              timesheets.length) *
              10,
          ) / 10
        : 0;

    return {
      period,
      asOfDate: now,
      financialSummary: {
        totalRevenue,
        directCosts,
        payrollCosts,
        operatingExpenses,
        grossProfit,
        operatingProfit,
        operatingMarginPercentage,
      },
      workingCapital: {
        accountsReceivable,
        accountsPayable,
        cashAndBank,
        netWorkingCapital,
      },
      operationalKPIs: {
        activeProjectsCount,
        completedTasksCount,
        timesheetLoggedHours,
        billableUtilizationPercentage: avgUtilization,
        newClientsAcquired: newClientsCount,
        activeEmployeeHeadcount: activeHeadcount,
      },
    };
  }

  async closeMonth(userId: string, dto: CloseMonthDto): Promise<ExecutiveSnapshotDocument> {
    const existing = await this.snapshotModel.findOne({ period: dto.period });
    if (existing && existing.isClosed) {
      throw new ConflictException(`Accounting period ${dto.period} is already closed`);
    }

    const liveData = await this.calculateLiveMetrics(dto.period);

    // Lock General Ledger Period
    await this.glService.lockPeriod(userId, {
      periodKey: dto.period,
      closingNotes: dto.closingNotes || 'Monthly financial close completed',
    });

    if (existing) {
      existing.asOfDate = new Date();
      existing.financialSummary = liveData.financialSummary;
      existing.workingCapital = liveData.workingCapital;
      existing.operationalKPIs = liveData.operationalKPIs;
      existing.isClosed = true;
      existing.closedAt = new Date();
      existing.closedBy = new Types.ObjectId(userId);
      existing.closingNotes = dto.closingNotes;
      return existing.save();
    }

    const snapshot = new this.snapshotModel({
      period: dto.period,
      asOfDate: new Date(),
      financialSummary: liveData.financialSummary,
      workingCapital: liveData.workingCapital,
      operationalKPIs: liveData.operationalKPIs,
      isClosed: true,
      closedAt: new Date(),
      closedBy: new Types.ObjectId(userId),
      closingNotes: dto.closingNotes,
    });

    const saved = await snapshot.save();

    // Log in Governance Approval Records
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.CUSTOM,
      entityId: saved._id.toString(),
      approvalType: 'MONTHLY_FINANCIAL_CLOSE',
      comments: `Monthly financial books closed for ${dto.period} (Revenue: ₹${liveData.financialSummary.totalRevenue}, Operating Profit: ₹${liveData.financialSummary.operatingProfit})`,
      metadata: {
        period: dto.period,
        revenue: liveData.financialSummary.totalRevenue,
        operatingProfit: liveData.financialSummary.operatingProfit,
        netWorkingCapital: liveData.workingCapital.netWorkingCapital,
      },
    });

    return saved;
  }

  async getSnapshotHistory(): Promise<ExecutiveSnapshotDocument[]> {
    return this.snapshotModel
      .find()
      .populate('closedBy', 'name email')
      .sort({ period: -1 })
      .exec();
  }

  async getSnapshotByPeriod(period: string): Promise<any> {
    const snapshot = await this.snapshotModel
      .findOne({ period })
      .populate('closedBy', 'name email')
      .exec();

    if (snapshot) return snapshot;

    // Return live calculated data if not yet closed
    return this.calculateLiveMetrics(period);
  }
}

