import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AccountType,
  ChartOfAccount,
  ChartOfAccountDocument,
} from './schemas/chart-of-account.schema';
import {
  JournalEntry,
  JournalEntryDocument,
  JournalStatus,
} from './schemas/journal-entry.schema';
import {
  AccountingPeriod,
  AccountingPeriodDocument,
} from './schemas/accounting-period.schema';
import {
  CreateChartOfAccountDto,
  LockPeriodDto,
} from './dto/create-account.dto';
import {
  CreateJournalEntryDto,
  ReverseJournalDto,
} from './dto/create-journal.dto';

@Injectable()
export class GeneralLedgerService implements OnModuleInit {
  constructor(
    @InjectModel(ChartOfAccount.name)
    private coaModel: Model<ChartOfAccountDocument>,
    @InjectModel(JournalEntry.name)
    private journalModel: Model<JournalEntryDocument>,
    @InjectModel(AccountingPeriod.name)
    private periodModel: Model<AccountingPeriodDocument>,
  ) {}

  async onModuleInit() {
    try {
      await this.seedDefaultChartOfAccounts();
    } catch (err: any) {
      console.warn('Chart of Accounts initial seeding skipped/deferred:', err?.message || err);
    }
  }

  private async seedDefaultChartOfAccounts() {
    const count = await this.coaModel.countDocuments();
    if (count > 0) return;

    const defaultAccounts = [
      { accountCode: '1010', accountName: 'Cash on Hand', accountType: AccountType.ASSET, category: 'CURRENT_ASSET' },
      { accountCode: '1020', accountName: 'HDFC Operating Bank Account', accountType: AccountType.ASSET, category: 'CURRENT_ASSET' },
      { accountCode: '1100', accountName: 'Accounts Receivable (Trade Debtors)', accountType: AccountType.ASSET, category: 'CURRENT_ASSET' },
      { accountCode: '1500', accountName: 'Office & IT Equipment', accountType: AccountType.ASSET, category: 'FIXED_ASSET' },
      { accountCode: '2010', accountName: 'Accounts Payable (Trade Creditors)', accountType: AccountType.LIABILITY, category: 'CURRENT_LIABILITY' },
      { accountCode: '2020', accountName: 'Output GST Payable', accountType: AccountType.LIABILITY, category: 'TAX_LIABILITY' },
      { accountCode: '2030', accountName: 'TDS Payable', accountType: AccountType.LIABILITY, category: 'TAX_LIABILITY' },
      { accountCode: '3010', accountName: "Owner's Equity / Retained Earnings", accountType: AccountType.EQUITY, category: 'EQUITY' },
      { accountCode: '4010', accountName: 'Software Development & IT Revenue', accountType: AccountType.REVENUE, category: 'OPERATING_REVENUE' },
      { accountCode: '4020', accountName: 'Digital Marketing & SEO Revenue', accountType: AccountType.REVENUE, category: 'OPERATING_REVENUE' },
      { accountCode: '5010', accountName: 'Salaries & Employee Compensation', accountType: AccountType.EXPENSE, category: 'OPERATING_EXPENSE' },
      { accountCode: '5020', accountName: 'Office Rent & Facilities', accountType: AccountType.EXPENSE, category: 'OPERATING_EXPENSE' },
      { accountCode: '5030', accountName: 'Cloud Infrastructure & Software SaaS', accountType: AccountType.EXPENSE, category: 'OPERATING_EXPENSE' },
    ];

    await this.coaModel.insertMany(defaultAccounts);
  }

  // ================= CHART OF ACCOUNTS =================

  async createAccount(
    userId: string,
    dto: CreateChartOfAccountDto,
  ): Promise<ChartOfAccountDocument> {
    const existing = await this.coaModel.findOne({ accountCode: dto.accountCode });
    if (existing) {
      throw new BadRequestException(`Account code ${dto.accountCode} already exists`);
    }

    const account = new this.coaModel({
      accountCode: dto.accountCode,
      accountName: dto.accountName,
      accountType: dto.accountType,
      category: dto.category,
      currency: dto.currency || 'INR',
      description: dto.description,
      createdBy: new Types.ObjectId(userId),
    });

    return account.save();
  }

  async getAllAccounts(query: any = {}): Promise<ChartOfAccountDocument[]> {
    const filter: any = {};
    if (query.accountType) filter.accountType = query.accountType;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

    return this.coaModel.find(filter).sort({ accountCode: 1 }).exec();
  }

  // ================= JOURNAL ENTRIES =================

  async createAndPostJournal(
    userId: string,
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntryDocument> {
    if (!dto.lines || dto.lines.length < 2) {
      throw new BadRequestException('A journal entry must contain at least 2 balanced lines');
    }

    const entryDate = new Date(dto.entryDate);
    const accountingPeriod = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;

    // Period Lock Check (P2-03)
    const period = await this.periodModel.findOne({ periodKey: accountingPeriod });
    if (period && period.isLocked) {
      throw new ForbiddenException(`Accounting period ${accountingPeriod} is locked. New entries cannot be posted.`);
    }

    // Resolve accounts and validate lines
    let totalDebit = 0;
    let totalCredit = 0;
    const resolvedLines: any[] = [];

    for (const line of dto.lines) {
      if (!Types.ObjectId.isValid(line.account)) {
        throw new BadRequestException(`Invalid account ID: ${line.account}`);
      }
      const acc = await this.coaModel.findById(line.account);
      if (!acc || !acc.isActive) {
        throw new BadRequestException(`Account not found or inactive: ${line.account}`);
      }

      const debit = Math.round((line.debit || 0) * 100) / 100;
      const credit = Math.round((line.credit || 0) * 100) / 100;

      if (debit < 0 || credit < 0) {
        throw new BadRequestException('Debits and credits cannot be negative');
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException('A line must have either a debit or a credit amount');
      }

      totalDebit += debit;
      totalCredit += credit;

      resolvedLines.push({
        account: acc._id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        debit,
        credit,
        description: line.description || dto.description,
        referenceEntity:
          line.referenceEntityType && line.referenceEntityId && Types.ObjectId.isValid(line.referenceEntityId)
            ? { entityType: line.referenceEntityType, entityId: new Types.ObjectId(line.referenceEntityId) }
            : undefined,
      });
    }

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    // Strict Double-Entry Balanced Validation (P2-02)
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Journal entry is out of balance. Total Debit: ₹${totalDebit}, Total Credit: ₹${totalCredit}. Debits and Credits must exactly balance.`,
      );
    }

    const journal = new this.journalModel({
      entryDate,
      reference: dto.reference,
      description: dto.description,
      status: JournalStatus.POSTED,
      lines: resolvedLines,
      totalDebit,
      totalCredit,
      isBalanced: true,
      accountingPeriod,
      postedAt: new Date(),
      postedBy: new Types.ObjectId(userId),
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await journal.save();

    // Update account balances
    for (const line of resolvedLines) {
      const netChange = line.debit - line.credit;
      await this.coaModel.findByIdAndUpdate(line.account, {
        $inc: { currentBalance: netChange },
      });
    }

    return saved;
  }

  async reverseJournal(
    journalId: string,
    userId: string,
    dto: ReverseJournalDto,
  ): Promise<JournalEntryDocument> {
    if (!Types.ObjectId.isValid(journalId)) throw new BadRequestException('Invalid journal ID');

    const original = await this.journalModel.findById(journalId);
    if (!original) throw new NotFoundException('Journal entry not found');

    if (original.status === JournalStatus.REVERSED) {
      throw new BadRequestException('Journal entry is already reversed');
    }

    // Create offsetting lines
    const reversingLines = original.lines.map((l) => ({
      account: l.account,
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: l.credit,
      credit: l.debit,
      description: `Reversal of ${original.journalNumber}: ${dto.reversalReason}`,
    }));

    const now = new Date();
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const reversingJournal = new this.journalModel({
      entryDate: now,
      reference: `REV-${original.journalNumber}`,
      description: `Reversal of ${original.journalNumber}: ${dto.reversalReason}`,
      status: JournalStatus.POSTED,
      lines: reversingLines,
      totalDebit: original.totalCredit,
      totalCredit: original.totalDebit,
      isBalanced: true,
      accountingPeriod: periodKey,
      postedAt: now,
      postedBy: new Types.ObjectId(userId),
      reversalOfJournal: original._id,
      reversalReason: dto.reversalReason,
      createdBy: new Types.ObjectId(userId),
    });

    const savedReversal = await reversingJournal.save();

    // Mark original as reversed
    original.status = JournalStatus.REVERSED;
    original.reversalReason = dto.reversalReason;
    await original.save();

    // Update balances with reversal
    for (const line of reversingLines) {
      const netChange = line.debit - line.credit;
      await this.coaModel.findByIdAndUpdate(line.account, {
        $inc: { currentBalance: netChange },
      });
    }

    return savedReversal;
  }

  async getTrialBalance(asOfDate?: string) {
    const dateLimit = asOfDate ? new Date(asOfDate) : new Date();

    const accounts = await this.coaModel.find({ isActive: true }).sort({ accountCode: 1 }).exec();

    const trialBalanceLines: any[] = [];
    let totalDebitSum = 0;
    let totalCreditSum = 0;

    for (const acc of accounts) {
      const journalLines = await this.journalModel.aggregate([
        { $match: { status: JournalStatus.POSTED, entryDate: { $lte: dateLimit } } },
        { $unwind: '$lines' },
        { $match: { 'lines.account': acc._id } },
        {
          $group: {
            _id: null,
            totalDebit: { $sum: '$lines.debit' },
            totalCredit: { $sum: '$lines.credit' },
          },
        },
      ]);

      const debits = journalLines[0]?.totalDebit || 0;
      const credits = journalLines[0]?.totalCredit || 0;
      const net = debits - credits;

      let debitCol = 0;
      let creditCol = 0;

      if ([AccountType.ASSET, AccountType.EXPENSE].includes(acc.accountType as AccountType)) {
        if (net >= 0) debitCol = net;
        else creditCol = Math.abs(net);
      } else {
        if (net <= 0) creditCol = Math.abs(net);
        else debitCol = net;
      }

      debitCol = Math.round(debitCol * 100) / 100;
      creditCol = Math.round(creditCol * 100) / 100;

      totalDebitSum += debitCol;
      totalCreditSum += creditCol;

      trialBalanceLines.push({
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        category: acc.category,
        debit: debitCol,
        credit: creditCol,
      });
    }

    totalDebitSum = Math.round(totalDebitSum * 100) / 100;
    totalCreditSum = Math.round(totalCreditSum * 100) / 100;
    const isBalanced = Math.abs(totalDebitSum - totalCreditSum) < 0.01;

    return {
      asOfDate: dateLimit,
      isBalanced,
      totalDebit: totalDebitSum,
      totalCredit: totalCreditSum,
      lines: trialBalanceLines,
    };
  }

  async getJournals(query: any = {}) {
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.accountingPeriod) filter.accountingPeriod = query.accountingPeriod;

    return this.journalModel
      .find(filter)
      .populate('postedBy', 'name email')
      .sort({ entryDate: -1, createdAt: -1 })
      .exec();
  }

  async getJournalById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid journal ID');
    const journal = await this.journalModel
      .findById(id)
      .populate('postedBy', 'name email')
      .populate('lines.account', 'accountCode accountName accountType')
      .exec();

    if (!journal) throw new NotFoundException('Journal entry not found');
    return journal;
  }

  // ================= PERIOD CONTROLS =================

  async lockPeriod(userId: string, dto: LockPeriodDto) {
    let period = await this.periodModel.findOne({ periodKey: dto.periodKey });
    if (!period) {
      const [year, month] = dto.periodKey.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      period = new this.periodModel({
        periodKey: dto.periodKey,
        startDate: start,
        endDate: end,
      });
    }

    period.isLocked = true;
    period.lockedAt = new Date();
    period.lockedBy = new Types.ObjectId(userId);
    if (dto.closingNotes) period.closingNotes = dto.closingNotes;

    await period.save();
    return { success: true, message: `Accounting period ${dto.periodKey} locked successfully` };
  }

  async getPeriods() {
    return this.periodModel.find().sort({ periodKey: -1 }).exec();
  }
}

