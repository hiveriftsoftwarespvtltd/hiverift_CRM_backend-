import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SalaryStructure,
  SalaryStructureDocument,
} from './schemas/salary-structure.schema';
import {
  PayrollRun,
  PayrollRunDocument,
  PayrollStatus,
} from './schemas/payroll-run.schema';
import {
  Payslip,
  PayslipDocument,
} from './schemas/payslip.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import { GeneralLedgerService } from '../general-ledger/general-ledger.service';
import {
  RunPayrollDto,
  UpsertSalaryStructureDto,
} from './dto/upsert-salary.dto';

@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(SalaryStructure.name)
    private salaryModel: Model<SalaryStructureDocument>,
    @InjectModel(PayrollRun.name)
    private runModel: Model<PayrollRunDocument>,
    @InjectModel(Payslip.name)
    private payslipModel: Model<PayslipDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private approvalsService: ApprovalsService,
    private glService: GeneralLedgerService,
  ) {}

  // ================= SALARY STRUCTURES =================

  async upsertSalaryStructure(
    dto: UpsertSalaryStructureDto,
  ): Promise<SalaryStructureDocument> {
    if (!Types.ObjectId.isValid(dto.employee)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const employee = await this.userModel.findById(dto.employee);
    if (!employee) throw new NotFoundException('Employee not found');

    const monthlyCtc = Math.round(dto.monthlyCtc * 100) / 100;

    // Standard Indian Payroll Components formula
    const basic = dto.basic !== undefined ? dto.basic : Math.round(monthlyCtc * 0.5 * 100) / 100;
    const hra = dto.hra !== undefined ? dto.hra : Math.round(monthlyCtc * 0.25 * 100) / 100;
    const specialAllowance =
      dto.specialAllowance !== undefined
        ? dto.specialAllowance
        : Math.max(0, Math.round((monthlyCtc - basic - hra) * 100) / 100);

    // Statutory deductions
    const providentFund =
      dto.providentFund !== undefined
        ? dto.providentFund
        : Math.round(basic * 0.12 * 100) / 100; // 12% of basic
    const professionalTax = dto.professionalTax !== undefined ? dto.professionalTax : 200;
    const tds = dto.tds || 0;

    const payload = {
      employee: employee._id,
      monthlyCtc,
      basic,
      hra,
      specialAllowance,
      providentFund,
      professionalTax,
      tds,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      isActive: true,
    };

    return this.salaryModel.findOneAndUpdate(
      { employee: employee._id },
      { $set: payload },
      { new: true, upsert: true },
    );
  }

  async getSalaryStructure(employeeId: string): Promise<SalaryStructureDocument> {
    if (!Types.ObjectId.isValid(employeeId)) throw new BadRequestException('Invalid employee ID');
    const structure = await this.salaryModel
      .findOne({ employee: new Types.ObjectId(employeeId) })
      .populate('employee', 'name email employeeId designation department')
      .exec();

    if (!structure) throw new NotFoundException('Salary structure not defined for employee');
    return structure;
  }

  async getAllSalaryStructures(): Promise<SalaryStructureDocument[]> {
    return this.salaryModel
      .find({ isActive: true })
      .populate('employee', 'name email employeeId designation department')
      .exec();
  }

  // ================= PAYROLL RUNS =================

  async generateDraftPayroll(
    userId: string,
    dto: RunPayrollDto,
  ): Promise<PayrollRunDocument> {
    const existing = await this.runModel.findOne({ monthYear: dto.monthYear });
    if (existing && existing.status === PayrollStatus.PROCESSED) {
      throw new ConflictException(`Payroll for ${dto.monthYear} has already been processed`);
    }

    // Get all active salary structures
    const structures = await this.salaryModel
      .find({ isActive: true })
      .populate('employee')
      .exec();

    if (structures.length === 0) {
      throw new BadRequestException('No active employee salary structures found');
    }

    let totalGrossPay = 0;
    let totalDeductions = 0;

    for (const s of structures) {
      const gross = s.basic + s.hra + s.specialAllowance;
      const deductions = s.providentFund + s.professionalTax + s.tds;
      totalGrossPay += gross;
      totalDeductions += deductions;
    }

    totalGrossPay = Math.round(totalGrossPay * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    const totalNetPay = Math.round((totalGrossPay - totalDeductions) * 100) / 100;

    if (existing) {
      existing.totalEmployees = structures.length;
      existing.totalGrossPay = totalGrossPay;
      existing.totalDeductions = totalDeductions;
      existing.totalNetPay = totalNetPay;
      existing.status = PayrollStatus.DRAFT;
      if (dto.notes) existing.notes = dto.notes;
      return existing.save();
    }

    const run = new this.runModel({
      monthYear: dto.monthYear,
      status: PayrollStatus.DRAFT,
      totalEmployees: structures.length,
      totalGrossPay,
      totalDeductions,
      totalNetPay,
      notes: dto.notes,
      createdBy: new Types.ObjectId(userId),
    });

    return run.save();
  }

  async approvePayroll(runId: string, userId: string): Promise<PayrollRunDocument> {
    if (!Types.ObjectId.isValid(runId)) throw new BadRequestException('Invalid payroll run ID');

    const run = await this.runModel.findById(runId);
    if (!run) throw new NotFoundException('Payroll run not found');

    run.status = PayrollStatus.APPROVED;
    await run.save();

    // Log approval record
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.CUSTOM,
      entityId: run._id.toString(),
      approvalType: 'PAYROLL_APPROVAL',
      comments: `Payroll for ${run.monthYear} approved (Gross: ₹${run.totalGrossPay}, Net: ₹${run.totalNetPay})`,
      metadata: {
        monthYear: run.monthYear,
        totalEmployees: run.totalEmployees,
        totalNetPay: run.totalNetPay,
      },
    });

    return run;
  }

  async processPayroll(runId: string, userId: string): Promise<PayrollRunDocument> {
    if (!Types.ObjectId.isValid(runId)) throw new BadRequestException('Invalid payroll run ID');

    const run = await this.runModel.findById(runId);
    if (!run) throw new NotFoundException('Payroll run not found');

    if (run.status === PayrollStatus.PROCESSED) {
      throw new ConflictException('Payroll run is already processed');
    }

    const structures = await this.salaryModel.find({ isActive: true }).exec();

    // Generate individual payslips
    for (const s of structures) {
      const gross = Math.round((s.basic + s.hra + s.specialAllowance) * 100) / 100;
      const deductionsSum = Math.round((s.providentFund + s.professionalTax + s.tds) * 100) / 100;
      const net = Math.round((gross - deductionsSum) * 100) / 100;

      await this.payslipModel.findOneAndUpdate(
        { employee: s.employee, monthYear: run.monthYear },
        {
          $set: {
            payrollRun: run._id,
            employee: s.employee,
            monthYear: run.monthYear,
            earnings: [
              { component: 'Basic Salary', amount: s.basic },
              { component: 'House Rent Allowance (HRA)', amount: s.hra },
              { component: 'Special Allowance', amount: s.specialAllowance },
            ],
            deductions: [
              { component: 'Provident Fund (PF)', amount: s.providentFund },
              { component: 'Professional Tax (PT)', amount: s.professionalTax },
              { component: 'TDS (Income Tax)', amount: s.tds },
            ],
            grossSalary: gross,
            totalDeductions: deductionsSum,
            netSalary: net,
            paymentStatus: 'PAID',
            paidAt: new Date(),
            paymentReference: `SALARY-${run.monthYear}`,
          },
        },
        { upsert: true, new: true },
      );
    }

    // Post Double-Entry Journal to General Ledger (P2-11)
    try {
      const accounts = await this.glService.getAllAccounts();
      const salaryExpenseAcc = accounts.find((a) => a.accountCode === '5010') || accounts[0];
      const bankAcc = accounts.find((a) => a.accountCode === '1020') || accounts[1];
      const tdsAcc = accounts.find((a) => a.accountCode === '2030');
      const apAcc = accounts.find((a) => a.accountCode === '2010');

      let statutorySum = run.totalDeductions;
      const lines: any[] = [
        {
          account: salaryExpenseAcc._id.toString(),
          debit: run.totalGrossPay,
          credit: 0,
          description: `Total Salary Expense for ${run.monthYear}`,
        },
        {
          account: bankAcc._id.toString(),
          debit: 0,
          credit: run.totalNetPay,
          description: `Net salary disbursement via Bank for ${run.monthYear}`,
        },
      ];

      if (tdsAcc && statutorySum > 0) {
        lines.push({
          account: tdsAcc._id.toString(),
          debit: 0,
          credit: statutorySum,
          description: `Statutory deductions liability (TDS/PF/PT) for ${run.monthYear}`,
        });
      } else if (apAcc && statutorySum > 0) {
        lines.push({
          account: apAcc._id.toString(),
          debit: 0,
          credit: statutorySum,
          description: `Statutory liability for ${run.monthYear}`,
        });
      }

      const journal = await this.glService.createAndPostJournal(userId, {
        entryDate: new Date().toISOString(),
        description: `Monthly Payroll Run for ${run.monthYear} (${run.totalEmployees} employees)`,
        reference: `PAYROLL-${run.monthYear}`,
        lines,
      });

      run.linkedJournalEntry = journal._id as Types.ObjectId;
    } catch (err) {
      // Continue even if automatic journal fails
    }

    run.status = PayrollStatus.PROCESSED;
    run.processedAt = new Date();
    run.processedBy = new Types.ObjectId(userId);

    return run.save();
  }

  async getAllPayrollRuns(): Promise<PayrollRunDocument[]> {
    return this.runModel
      .find()
      .populate('createdBy', 'name email')
      .populate('processedBy', 'name email')
      .sort({ monthYear: -1 })
      .exec();
  }

  async getMyPayslips(userId: string): Promise<PayslipDocument[]> {
    return this.payslipModel
      .find({ employee: new Types.ObjectId(userId) })
      .populate('employee', 'name email employeeId designation department')
      .sort({ monthYear: -1 })
      .exec();
  }

  async getPayslipById(id: string): Promise<PayslipDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid payslip ID');
    const payslip = await this.payslipModel
      .findById(id)
      .populate('employee', 'name email employeeId designation department')
      .exec();

    if (!payslip) throw new NotFoundException('Payslip not found');
    return payslip;
  }
}

