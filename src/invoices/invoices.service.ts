import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { CompanyAccount, CompanyAccountDocument } from '../accounts/schemas/account.schema';
import { AccountTransaction, AccountTransactionDocument, TransactionType } from '../accounts/schemas/transaction.schema';
import { CreateInvoiceDto, SendInvoiceEmailDto } from './dto/create-invoice.dto';
import { MailService } from '../common/services/mail.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(CompanyAccount.name) private accountModel: Model<CompanyAccountDocument>,
    @InjectModel(AccountTransaction.name) private transactionModel: Model<AccountTransactionDocument>,
    private mailService: MailService,
  ) {}

  private async getTargetAccount(accountId?: string): Promise<CompanyAccountDocument | null> {
    if (accountId && Types.ObjectId.isValid(accountId)) {
      const acc = await this.accountModel.findById(accountId);
      if (acc) return acc;
    }
    const defaultAcc = await this.accountModel.findOne({ isDefault: true });
    if (defaultAcc) return defaultAcc;
    return this.accountModel.findOne({ isActive: true });
  }

  private calculateAmounts(dto: any) {
    const items = (dto.items || []).map((item) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const rate = Math.max(0, Number(item.rate) || 0);
      const amount = item.amount !== undefined ? Number(item.amount) : quantity * rate;
      return {
        description: item.description || '',
        quantity,
        rate,
        amount,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const taxRate = Math.max(0, Number(dto.taxRate) || 0);
    const taxAmount = (subtotal * taxRate) / 100;

    let discountAmount = 0;
    const discountVal = Math.max(0, Number(dto.discountValue) || 0);
    if (dto.discountType === 'percentage') {
      discountAmount = (subtotal * discountVal) / 100;
    } else {
      discountAmount = discountVal;
    }

    const shipping = Math.max(0, Number(dto.shipping) || 0);
    const total = Math.max(0, subtotal + taxAmount - discountAmount + shipping);
    const amountPaid = Math.max(0, Number(dto.amountPaid) || 0);
    const balanceDue = Math.max(0, total - amountPaid);

    let status = dto.status || 'draft';
    if (amountPaid >= total && total > 0) {
      status = 'paid';
    } else if (amountPaid > 0 && amountPaid < total) {
      status = 'partially_paid';
    }

    return {
      items,
      subtotal,
      taxRate,
      taxAmount,
      discountType: dto.discountType || 'percentage',
      discountValue: discountVal,
      discountAmount,
      shipping,
      total,
      amountPaid,
      balanceDue,
      status,
    };
  }

  async create(dto: CreateInvoiceDto, userId: string): Promise<InvoiceDocument> {
    let invoiceNo = dto.invoiceNo?.trim();
    if (!invoiceNo) {
      const count = await this.invoiceModel.countDocuments();
      invoiceNo = `INV-${String(count + 1).padStart(4, '0')}`;
    }

    const exists = await this.invoiceModel.findOne({ invoiceNo });
    if (exists) {
      const randomSuffix = Math.floor(100 + Math.random() * 900);
      invoiceNo = `${invoiceNo}-${randomSuffix}`;
    }

    const calculated = this.calculateAmounts(dto);

    const newInvoice = new this.invoiceModel({
      ...dto,
      invoiceNo,
      ...calculated,
      createdBy: new Types.ObjectId(userId),
      client: dto.client && Types.ObjectId.isValid(dto.client) ? new Types.ObjectId(dto.client) : undefined,
      lead: dto.lead && Types.ObjectId.isValid(dto.lead) ? new Types.ObjectId(dto.lead) : undefined,
      depositAccount: dto.depositAccount && Types.ObjectId.isValid(dto.depositAccount) ? new Types.ObjectId(dto.depositAccount) : undefined,
    });

    const saved = await newInvoice.save();

    // If an initial payment was received upon creation, deposit it into the company account and record an income transaction
    if (saved.amountPaid > 0) {
      const targetAcc = await this.getTargetAccount(dto.depositAccount);
      if (targetAcc) {
        targetAcc.currentBalance += saved.amountPaid;
        await targetAcc.save();

        saved.depositAccount = targetAcc._id as any;
        await saved.save();

        const txn = new this.transactionModel({
          type: TransactionType.INCOME,
          category: 'client_payment',
          amount: saved.amountPaid,
          account: targetAcc._id,
          invoice: saved._id,
          client: saved.client,
          date: saved.date || new Date(),
          paymentMethod: 'bank_transfer',
          referenceNo: saved.invoiceNo,
          payeeOrPayer: saved.billTo?.split('\n')[0] || 'Client',
          description: `Initial payment received for Invoice #${saved.invoiceNo}`,
          createdBy: new Types.ObjectId(userId),
        });
        await txn.save();
      }
    }

    return saved;
  }

  async findAll(query: any, user: any): Promise<{ invoices: any[]; total: number }> {
    const { search, status, client, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (client) {
      filter.client = new Types.ObjectId(client);
    }

    if (search) {
      filter.$or = [
        { invoiceNo: { $regex: search, $options: 'i' } },
        { billTo: { $regex: search, $options: 'i' } },
        { 'items.description': { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [invoices, total] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .populate('client', 'name email company phone')
        .populate('createdBy', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      this.invoiceModel.countDocuments(filter),
    ]);

    return { invoices, total };
  }
  
  async findOne(id: string): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel
      .findById(id)
      .populate('client', 'name email company phone address')
      .populate('lead', 'name email phone company')
      .populate('createdBy', 'name email role');
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async update(id: string, dto: Partial<CreateInvoiceDto>, userId?: string): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel.findById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');

    const oldAmountPaid = Number(invoice.amountPaid) || 0;
    const calculated = this.calculateAmounts({ ...invoice.toObject(), ...dto });
    const newAmountPaid = Number(calculated.amountPaid) || 0;
    const diff = newAmountPaid - oldAmountPaid;

    if (diff !== 0) {
      const targetAcc = await this.getTargetAccount(dto.depositAccount || (invoice.depositAccount ? invoice.depositAccount.toString() : undefined));
      if (targetAcc) {
        targetAcc.currentBalance += diff;
        await targetAcc.save();

        if (diff > 0) {
          const txn = new this.transactionModel({
            type: TransactionType.INCOME,
            category: 'client_payment',
            amount: diff,
            account: targetAcc._id,
            invoice: invoice._id,
            client: dto.client && Types.ObjectId.isValid(dto.client) ? new Types.ObjectId(dto.client) : invoice.client,
            date: new Date(),
            paymentMethod: 'bank_transfer',
            referenceNo: invoice.invoiceNo,
            payeeOrPayer: (dto.billTo || invoice.billTo)?.split('\n')[0] || 'Client',
            description: `Payment update received for Invoice #${invoice.invoiceNo}`,
            createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : invoice.createdBy,
          });
          await txn.save();
        }
      }
    }

    Object.assign(invoice, {
      ...dto,
      ...calculated,
      client: dto.client && Types.ObjectId.isValid(dto.client) ? new Types.ObjectId(dto.client) : invoice.client,
      lead: dto.lead && Types.ObjectId.isValid(dto.lead) ? new Types.ObjectId(dto.lead) : invoice.lead,
      depositAccount: dto.depositAccount && Types.ObjectId.isValid(dto.depositAccount) ? new Types.ObjectId(dto.depositAccount) : invoice.depositAccount,
    });

    return invoice.save();
  }

  async recordPayment(
    id: string,
    paymentDto: {
      amount: number;
      accountId?: string;
      paymentMethod?: string;
      referenceNo?: string;
      notes?: string;
      date?: string;
    },
    userId: string,
  ): Promise<any> {
    const invoice = await this.invoiceModel.findById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');

    const paymentAmount = Number(paymentDto.amount);
    if (!paymentAmount || paymentAmount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const targetAcc = await this.getTargetAccount(paymentDto.accountId || (invoice.depositAccount ? invoice.depositAccount.toString() : undefined));
    if (!targetAcc) throw new NotFoundException('Company operating account not found');

    // Credit company account balance
    targetAcc.currentBalance += paymentAmount;
    await targetAcc.save();

    // Update invoice paid & balance due
    invoice.amountPaid = (Number(invoice.amountPaid) || 0) + paymentAmount;
    invoice.balanceDue = Math.max(0, invoice.total - invoice.amountPaid);
    if (invoice.balanceDue === 0) {
      invoice.status = 'paid';
    } else {
      invoice.status = 'partially_paid';
    }
    invoice.depositAccount = targetAcc._id as any;
    await invoice.save();

    // Record income transaction in Accounts ledger
    const txn = new this.transactionModel({
      type: TransactionType.INCOME,
      category: 'client_payment',
      amount: paymentAmount,
      account: targetAcc._id,
      invoice: invoice._id,
      client: invoice.client,
      date: paymentDto.date ? new Date(paymentDto.date) : new Date(),
      paymentMethod: paymentDto.paymentMethod || 'bank_transfer',
      referenceNo: paymentDto.referenceNo || invoice.invoiceNo,
      payeeOrPayer: invoice.billTo?.split('\n')[0] || 'Client',
      description: paymentDto.notes || `Payment received for Invoice #${invoice.invoiceNo}`,
      createdBy: new Types.ObjectId(userId),
    });
    const savedTxn = await txn.save();

    return {
      invoice,
      transaction: savedTxn,
      account: {
        _id: targetAcc._id,
        name: targetAcc.name,
        currentBalance: targetAcc.currentBalance,
      },
    };
  }

  async delete(id: string): Promise<void> {
    const invoice = await this.invoiceModel.findById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Reverse any linked transactions in accounts
    const linkedTxns = await this.transactionModel.find({ invoice: new Types.ObjectId(id) });
    for (const txn of linkedTxns) {
      const acc = await this.accountModel.findById(txn.account);
      if (acc) {
        acc.currentBalance -= txn.amount;
        await acc.save();
      }
    }
    await this.transactionModel.deleteMany({ invoice: new Types.ObjectId(id) });
    await this.invoiceModel.findByIdAndDelete(id);
  }

  async sendEmail(id: string, emailDto: SendInvoiceEmailDto): Promise<{ message: string; success: boolean }> {
    const invoice = await this.findOne(id);
    const success = await this.mailService.sendInvoiceMail(
      emailDto.email,
      invoice,
      emailDto.subject,
      emailDto.customMessage,
    );

    if (success && invoice.status === 'draft') {
      invoice.status = 'sent';
      await invoice.save();
    }

    return {
      message: success ? `Invoice sent successfully to ${emailDto.email}` : 'Failed to send email',
      success,
    };
  }

  async getStats(): Promise<{
    totalInvoices: number;
    totalInvoiced: number;
    totalPaid: number;
    totalBalanceDue: number;
    draftCount: number;
    paidCount: number;
    partiallyPaidCount: number;
    overdueCount: number;
  }> {
    const [statsAgg, countsAgg] = await Promise.all([
      this.invoiceModel.aggregate([
        {
          $group: {
            _id: null,
            totalInvoiced: { $sum: '$total' },
            totalPaid: { $sum: '$amountPaid' },
            totalBalanceDue: { $sum: '$balanceDue' },
          },
        },
      ]),
      this.invoiceModel.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalInvoices = await this.invoiceModel.countDocuments();
    const stats = statsAgg[0] || { totalInvoiced: 0, totalPaid: 0, totalBalanceDue: 0 };

    const getStatusCount = (st: string) => countsAgg.find((c) => c._id === st)?.count || 0;

    return {
      totalInvoices,
      totalInvoiced: stats.totalInvoiced || 0,
      totalPaid: stats.totalPaid || 0,
      totalBalanceDue: stats.totalBalanceDue || 0,
      draftCount: getStatusCount('draft'),
      paidCount: getStatusCount('paid'),
      partiallyPaidCount: getStatusCount('partially_paid'),
      overdueCount: getStatusCount('overdue'),
    };
  }
}
