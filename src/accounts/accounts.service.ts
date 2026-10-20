import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CompanyAccount, CompanyAccountDocument } from './schemas/account.schema';
import { AccountTransaction, AccountTransactionDocument, TransactionType } from './schemas/transaction.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';

@Injectable()
export class AccountsService implements OnModuleInit {
  constructor(
    @InjectModel(CompanyAccount.name) private accountModel: Model<CompanyAccountDocument>,
    @InjectModel(AccountTransaction.name) private transactionModel: Model<AccountTransactionDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
  ) {}

  async onModuleInit() {
    try {
      const count = await this.accountModel.countDocuments();
      if (count === 0) {
        await this.accountModel.create([
          {
            name: 'HDFC Current Account',
            accountType: 'bank',
            accountNumber: '50200088921820',
            bankName: 'HDFC Bank Ltd.',
            ifscCode: 'HDFC0001234',
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
            isDefault: true,
          },
          {
            name: 'Petty Cash Wallet',
            accountType: 'cash',
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
            isDefault: false,
          },
          {
            name: 'UPI / Digital Gateway',
            accountType: 'wallet',
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
            isDefault: false,
          },
        ]);
        console.log('[AccountsService] Initialized default company financial accounts.');
      }
    } catch (err) {
      console.error('[AccountsService] Error seeding default accounts:', err);
    }
  }

  // ==========================================
  // Accounts CRUD
  // ==========================================
  async getAccounts(): Promise<CompanyAccountDocument[]> {
    let accounts = await this.accountModel.find().sort({ isDefault: -1, createdAt: 1 });
    if (!accounts || accounts.length === 0) {
      await this.accountModel.create([
        {
          name: 'HDFC Current Account',
          accountType: 'bank',
          accountNumber: '50200088921820',
          bankName: 'HDFC Bank Ltd.',
          ifscCode: 'HDFC0001234',
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isDefault: true,
        },
        {
          name: 'Petty Cash Wallet',
          accountType: 'cash',
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isDefault: false,
        },
        {
          name: 'UPI / Digital Gateway',
          accountType: 'wallet',
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isDefault: false,
        },
      ]);
      accounts = await this.accountModel.find().sort({ isDefault: -1, createdAt: 1 });
    }
    return accounts;
  }

  async createAccount(dto: any, userId?: string): Promise<CompanyAccountDocument> {
    const opening = Number(dto.openingBalance) || 0;
    const account = new this.accountModel({
      ...dto,
      openingBalance: opening,
      currentBalance: opening,
      createdBy: userId ? new Types.ObjectId(userId) : undefined,
    });
    return account.save();
  }

  async updateAccount(id: string, dto: any): Promise<CompanyAccountDocument> {
    const updateData: any = { ...dto };
    if (dto.currentBalance !== undefined) {
      updateData.currentBalance = Number(dto.currentBalance) || 0;
    }
    if (dto.openingBalance !== undefined) {
      updateData.openingBalance = Number(dto.openingBalance) || 0;
    }
    const acc = await this.accountModel.findByIdAndUpdate(id, updateData, { new: true });
    if (!acc) throw new NotFoundException('Account not found');
    return acc;
  }

  async deleteAccount(id: string, force = false): Promise<{ success: boolean; message: string }> {
    const totalAccounts = await this.accountModel.countDocuments();
    if (totalAccounts <= 1) {
      throw new BadRequestException('At least one operating account must remain active. You can edit this account instead of deleting it.');
    }

    const txnCount = await this.transactionModel.countDocuments({
      $or: [{ account: new Types.ObjectId(id) }, { toAccount: new Types.ObjectId(id) }],
    });

    if (txnCount > 0) {
      if (force) {
        await this.transactionModel.deleteMany({
          $or: [{ account: new Types.ObjectId(id) }, { toAccount: new Types.ObjectId(id) }],
        });
      } else {
        throw new BadRequestException(
          `HAS_TRANSACTIONS:${txnCount}`,
        );
      }
    }
    const res = await this.accountModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Account not found');
    return { success: true, message: 'Account deleted successfully' };
  }

  // ==========================================
  // Transactions Management
  // ==========================================
  async getTransactions(query: any): Promise<{ transactions: AccountTransactionDocument[]; total: number }> {
    const { type, category, account, startDate, endDate, search, page = 1, limit = 20 } = query;
    const filter: any = {};

    if (type && type !== 'all') filter.type = type;
    if (category && category !== 'all') filter.category = category;
    if (account && account !== 'all') {
      filter.$or = [{ account: new Types.ObjectId(account) }, { toAccount: new Types.ObjectId(account) }];
    }

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      filter.$or = [
        { transactionNo: searchRegex },
        { payeeOrPayer: searchRegex },
        { description: searchRegex },
        { referenceNo: searchRegex },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .populate('account', 'name accountType accountNumber bankName')
        .populate('toAccount', 'name accountType')
        .populate('client', 'name company email phone')
        .populate('createdBy', 'name email role')
        .skip(skip)
        .limit(Number(limit))
        .sort({ date: -1, createdAt: -1 }),
      this.transactionModel.countDocuments(filter),
    ]);

    return { transactions, total };
  }

  async createTransaction(dto: any, userId: string): Promise<any> {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('Transaction amount must be greater than zero');
    }

    const account = await this.accountModel.findById(dto.account);
    if (!account) throw new NotFoundException('Account not found');

    if (dto.type === TransactionType.TRANSFER) {
      if (!dto.toAccount) throw new BadRequestException('Destination account required for transfer');
      if (dto.account === dto.toAccount) throw new BadRequestException('Source and destination accounts must be different');
      const toAcc = await this.accountModel.findById(dto.toAccount);
      if (!toAcc) throw new NotFoundException('Destination account not found');

      account.currentBalance -= amount;
      toAcc.currentBalance += amount;
      await Promise.all([account.save(), toAcc.save()]);
    } else if (dto.type === TransactionType.INCOME) {
      account.currentBalance += amount;
      await account.save();
    } else if (dto.type === TransactionType.EXPENSE) {
      account.currentBalance -= amount;
      await account.save();
    }

    const payload: any = {
      ...dto,
      amount,
      date: dto.date ? new Date(dto.date) : new Date(),
      account: new Types.ObjectId(dto.account),
      createdBy: new Types.ObjectId(userId),
    };
    if (dto.toAccount) payload.toAccount = new Types.ObjectId(dto.toAccount);
    if (dto.client) payload.client = new Types.ObjectId(dto.client);

    const txn = new this.transactionModel(payload);
    const saved = await txn.save();
    return this.transactionModel
      .findById(saved._id)
      .populate('account', 'name accountType')
      .populate('toAccount', 'name accountType')
      .populate('client', 'name company')
      .populate('createdBy', 'name email');
  }

  async deleteTransaction(id: string): Promise<{ success: boolean; message: string }> {
    const txn = await this.transactionModel.findById(id);
    if (!txn) throw new NotFoundException('Transaction not found');

    const amount = txn.amount || 0;
    const account = await this.accountModel.findById(txn.account);

    if (account) {
      if (txn.type === TransactionType.INCOME) {
        account.currentBalance -= amount;
        await account.save();
      } else if (txn.type === TransactionType.EXPENSE) {
        account.currentBalance += amount;
        await account.save();
      } else if (txn.type === TransactionType.TRANSFER && txn.toAccount) {
        account.currentBalance += amount;
        const toAcc = await this.accountModel.findById(txn.toAccount);
        if (toAcc) {
          toAcc.currentBalance -= amount;
          await toAcc.save();
        }
        await account.save();
      }
    }

    await this.transactionModel.findByIdAndDelete(id);
    return { success: true, message: 'Transaction deleted and account balance adjusted successfully' };
  }

  // ==========================================
  // Financial Overview & P&L Analytics
  // ==========================================
  async getFinancialOverview(query: any = {}): Promise<any> {
    const { startDate, endDate } = query;
    const dateFilter: any = {};

    if (startDate || endDate) {
      dateFilter.date = {};
      if (startDate) dateFilter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.date.$lte = end;
      }
    }

    // 1. Overall Account Balances
    const accounts = await this.accountModel.find({ isActive: true }).lean();
    const totalBankBalance = accounts.reduce((acc, a) => acc + (a.currentBalance || 0), 0);

    // 2. Receivables from CRM client payment ledger
    const pendingPayments = await this.paymentModel.aggregate([
      { $group: { _id: null, totalPending: { $sum: '$pendingAmount' }, totalInvoiced: { $sum: '$invoiceAmount' }, totalReceived: { $sum: '$receivedAmount' } } },
    ]);
    const totalReceivables = pendingPayments[0]?.totalPending || 0;
    const totalCRMInvoiced = pendingPayments[0]?.totalInvoiced || 0;
    const totalCRMReceived = pendingPayments[0]?.totalReceived || 0;

    // 3. Transactions Aggregation
    const [totalsByType, expenseByCategory, incomeByCategory] = await Promise.all([
      this.transactionModel.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.transactionModel.aggregate([
        { $match: { ...dateFilter, type: TransactionType.EXPENSE } },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      this.transactionModel.aggregate([
        { $match: { ...dateFilter, type: TransactionType.INCOME } },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    for (const item of totalsByType) {
      if (item._id === TransactionType.INCOME) totalIncome = item.total;
      if (item._id === TransactionType.EXPENSE) totalExpense = item.total;
    }

    const netProfit = totalIncome - totalExpense;

    // 4. Monthly Cashflow Trend (Past 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyData = await this.transactionModel.aggregate([
      { $match: { date: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
            type: '$type',
          },
          total: { $sum: '$amount' },
        },
      },
    ]);

    const monthMap: Record<string, { month: string; income: number; expense: number; net: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      monthMap[key] = { month: label, income: 0, expense: 0, net: 0 };
    }

    for (const item of monthlyData) {
      const key = `${item._id.year}-${String(item._id.month).padStart(2, '0')}`;
      if (monthMap[key]) {
        if (item._id.type === TransactionType.INCOME) monthMap[key].income += item.total;
        if (item._id.type === TransactionType.EXPENSE) monthMap[key].expense += item.total;
      }
    }

    const cashflowTrend = Object.values(monthMap).map((m) => ({
      ...m,
      net: m.income - m.expense,
    }));

    // 5. Recent Transactions
    const recentTransactions = await this.transactionModel
      .find()
      .populate('account', 'name accountType')
      .populate('client', 'name company')
      .sort({ date: -1, createdAt: -1 })
      .limit(6);

    return {
      summary: {
        totalIncome,
        totalExpense,
        netProfit,
        totalBankBalance,
        totalReceivables,
        totalCRMInvoiced,
        totalCRMReceived,
      },
      accounts,
      expenseByCategory,
      incomeByCategory,
      cashflowTrend,
      recentTransactions,
    };
  }

  getCategories() {
    return {
      incomeCategories: [
        { id: 'client_payment', label: 'Client Project / Invoice Payment', icon: 'DollarSign' },
        { id: 'retainer', label: 'Monthly Retainer Fee', icon: 'Repeat' },
        { id: 'consulting', label: 'Consulting & Strategy Service', icon: 'Briefcase' },
        { id: 'interest', label: 'Bank Interest / Returns', icon: 'TrendingUp' },
        { id: 'other_income', label: 'Other Operating Income', icon: 'PlusCircle' },
      ],
      expenseCategories: [
        { id: 'software_tools', label: 'Software Licenses & SaaS Subscriptions', icon: 'Layers' },
        { id: 'cloud_hosting', label: 'Cloud Hosting & Domain Services', icon: 'Server' },
        { id: 'office_rent', label: 'Office Rent & Facilities', icon: 'Building' },
        { id: 'payroll_salaries', label: 'Employee Salaries & Payroll', icon: 'Users' },
        { id: 'marketing_ads', label: 'Marketing, Meta & Google Ads', icon: 'Megaphone' },
        { id: 'contractor_payout', label: 'Contractor & Freelancer Fees', icon: 'UserCheck' },
        { id: 'office_supplies', label: 'Office Supplies & Hardware', icon: 'Package' },
        { id: 'tax_gst', label: 'Tax, GST & Compliance Fees', icon: 'ShieldCheck' },
        { id: 'utilities', label: 'Electricity & Internet Utilities', icon: 'Zap' },
        { id: 'other_expense', label: 'Miscellaneous Operating Expense', icon: 'MoreHorizontal' },
      ],
    };
  }
}
