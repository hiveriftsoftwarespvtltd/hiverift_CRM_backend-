import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreditNote,
  CreditNoteDocument,
} from './schemas/credit-note.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../invoices/schemas/invoice.schema';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
} from '../procurement/schemas/purchase-order.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import { GeneralLedgerService } from '../general-ledger/general-ledger.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectModel(CreditNote.name)
    private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(Invoice.name)
    private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(PurchaseOrder.name)
    private poModel: Model<PurchaseOrderDocument>,
    private approvalsService: ApprovalsService,
    private glService: GeneralLedgerService,
  ) {}

  // ================= CREDIT NOTES =================

  async createCreditNote(
    userId: string,
    dto: CreateCreditNoteDto,
  ): Promise<CreditNoteDocument> {
    if (!Types.ObjectId.isValid(dto.invoiceId)) {
      throw new BadRequestException('Invalid invoice ID');
    }

    const invoice = await this.invoiceModel.findById(dto.invoiceId).populate('client');
    if (!invoice) throw new NotFoundException('Invoice not found');

    const amount = Math.round(dto.amount * 100) / 100;
    const taxAdjustment = Math.round((dto.taxAdjustment || 0) * 100) / 100;
    const totalAmount = Math.round((amount + taxAdjustment) * 100) / 100;

    const currentBalance = invoice.balanceDue || 0;

    if (totalAmount > currentBalance) {
      throw new BadRequestException(
        `Credit note total (₹${totalAmount}) cannot exceed outstanding balance due (₹${currentBalance})`,
      );
    }

    const creditNote = new this.creditNoteModel({
      invoice: invoice._id,
      client: invoice.client,
      amount,
      taxAdjustment,
      totalAmount,
      reason: dto.reason,
      status: 'APPLIED',
      notes: dto.notes,
      approvedBy: new Types.ObjectId(userId),
      approvedAt: new Date(),
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await creditNote.save();

    // Deduct from Invoice balance
    const newBalance = Math.max(0, Math.round((currentBalance - totalAmount) * 100) / 100);
    invoice.balanceDue = newBalance;
    if (newBalance === 0) {
      invoice.status = 'paid';
    }
    await invoice.save();

    // Post Double-Entry Journal in General Ledger (P2-04)
    try {
      const accounts = await this.glService.getAllAccounts();
      const revenueAcc = accounts.find((a) => a.accountCode === '4010') || accounts[0];
      const arAcc = accounts.find((a) => a.accountCode === '1100') || accounts[1];

      const journal = await this.glService.createAndPostJournal(userId, {
        entryDate: new Date().toISOString(),
        description: `Credit Note ${saved.creditNoteNumber} for Invoice ${invoice.invoiceNo}`,
        reference: saved.creditNoteNumber,
        lines: [
          {
            account: revenueAcc._id.toString(),
            debit: totalAmount,
            credit: 0,
            description: `Sales allowance / Credit note against ${invoice.invoiceNo}`,
          },
          {
            account: arAcc._id.toString(),
            debit: 0,
            credit: totalAmount,
            description: `Accounts Receivable reduction for ${saved.creditNoteNumber}`,
          },
        ],
      });

      saved.linkedJournalEntry = journal._id as Types.ObjectId;
      await saved.save();
    } catch (err) {
      // Continue even if automatic journal fails
    }

    // Log approval record
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.CUSTOM,
      entityId: saved._id.toString(),
      approvalType: 'CREDIT_NOTE_ISSUANCE',
      comments: `Credit Note ${saved.creditNoteNumber} issued for ₹${totalAmount} on Invoice ${invoice.invoiceNo}`,
      metadata: {
        creditNoteNumber: saved.creditNoteNumber,
        invoiceNumber: invoice.invoiceNo,
        totalAmount,
      },
    });

    return saved;
  }

  async getAllCreditNotes(query: any = {}): Promise<CreditNoteDocument[]> {
    const filter: any = {};
    if (query.client && Types.ObjectId.isValid(query.client)) {
      filter.client = new Types.ObjectId(query.client);
    }
    return this.creditNoteModel
      .find(filter)
      .populate('invoice', 'invoiceNumber total balanceDue status')
      .populate('client', 'name company clientId')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  // ================= AR / AP AGEING =================

  async getArAgeingSummary() {
    const unpaidInvoices = await this.invoiceModel
      .find({ status: { $nin: ['paid', 'cancelled', 'draft'] } })
      .populate('client', 'name company clientId phone email')
      .sort({ dueDate: 1 })
      .exec();

    const now = Date.now();
    const buckets = {
      current0To30: { label: '0 - 30 Days', total: 0, count: 0, invoices: [] as any[] },
      days31To60: { label: '31 - 60 Days', total: 0, count: 0, invoices: [] as any[] },
      days61To90: { label: '61 - 90 Days', total: 0, count: 0, invoices: [] as any[] },
      over90Days: { label: '90+ Days (High Risk)', total: 0, count: 0, invoices: [] as any[] },
    };

    let totalArOutstanding = 0;

    for (const inv of unpaidInvoices) {
      const balance = inv.balanceDue || 0;
      if (balance <= 0) continue;

      const refDate = inv.dueDate
        ? new Date(inv.dueDate).getTime()
        : new Date(inv.date || (inv as any).createdAt).getTime();
      const ageDays = Math.max(0, Math.floor((now - refDate) / (1000 * 60 * 60 * 24)));

      totalArOutstanding += balance;

      const item = {
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNo,
        client: inv.client,
        total: inv.total,
        balanceDue: balance,
        dueDate: inv.dueDate,
        ageDays,
      };

      if (ageDays <= 30) {
        buckets.current0To30.total += balance;
        buckets.current0To30.count += 1;
        buckets.current0To30.invoices.push(item);
      } else if (ageDays <= 60) {
        buckets.days31To60.total += balance;
        buckets.days31To60.count += 1;
        buckets.days31To60.invoices.push(item);
      } else if (ageDays <= 90) {
        buckets.days61To90.total += balance;
        buckets.days61To90.count += 1;
        buckets.days61To90.invoices.push(item);
      } else {
        buckets.over90Days.total += balance;
        buckets.over90Days.count += 1;
        buckets.over90Days.invoices.push(item);
      }
    }

    return {
      totalArOutstanding: Math.round(totalArOutstanding * 100) / 100,
      buckets,
    };
  }

  async getApAgeingSummary() {
    const unpaidPOs = await this.poModel
      .find({ status: { $in: ['APPROVED', 'ORDERED', 'RECEIVED'] }, paymentStatus: { $ne: 'PAID' } })
      .populate('vendor', 'name vendorId email phone')
      .sort({ orderDate: 1 })
      .exec();

    const now = Date.now();
    const buckets = {
      current0To30: { label: '0 - 30 Days', total: 0, count: 0, orders: [] as any[] },
      days31To60: { label: '31 - 60 Days', total: 0, count: 0, orders: [] as any[] },
      days61To90: { label: '61 - 90 Days', total: 0, count: 0, orders: [] as any[] },
      over90Days: { label: '90+ Days', total: 0, count: 0, orders: [] as any[] },
    };

    let totalApOutstanding = 0;

    for (const po of unpaidPOs) {
      const refDate = new Date(po.orderDate).getTime();
      const ageDays = Math.max(0, Math.floor((now - refDate) / (1000 * 60 * 60 * 24)));
      const amount = po.totalAmount || 0;

      totalApOutstanding += amount;

      const item = {
        poId: po._id,
        poNumber: po.poNumber,
        vendor: po.vendor,
        totalAmount: amount,
        orderDate: po.orderDate,
        ageDays,
      };

      if (ageDays <= 30) {
        buckets.current0To30.total += amount;
        buckets.current0To30.count += 1;
        buckets.current0To30.orders.push(item);
      } else if (ageDays <= 60) {
        buckets.days31To60.total += amount;
        buckets.days31To60.count += 1;
        buckets.days31To60.orders.push(item);
      } else if (ageDays <= 90) {
        buckets.days61To90.total += amount;
        buckets.days61To90.count += 1;
        buckets.days61To90.orders.push(item);
      } else {
        buckets.over90Days.total += amount;
        buckets.over90Days.count += 1;
        buckets.over90Days.orders.push(item);
      }
    }

    return {
      totalApOutstanding: Math.round(totalApOutstanding * 100) / 100,
      buckets,
    };
  }

  async getReconciliationSummary() {
    const [arSummary, apSummary, creditNotes] = await Promise.all([
      this.getArAgeingSummary(),
      this.getApAgeingSummary(),
      this.creditNoteModel.find({ status: 'APPLIED' }).select('totalAmount'),
    ]);

    const totalCreditNotesApplied = creditNotes.reduce((sum, cn) => sum + (cn.totalAmount || 0), 0);

    return {
      receivables: {
        totalOutstanding: arSummary.totalArOutstanding,
        highRiskOverdue: arSummary.buckets.over90Days.total,
        totalCreditNotesApplied: Math.round(totalCreditNotesApplied * 100) / 100,
      },
      payables: {
        totalOutstanding: apSummary.totalApOutstanding,
        overduePayables: apSummary.buckets.over90Days.total,
      },
      netWorkingCapitalPosition: Math.round((arSummary.totalArOutstanding - apSummary.totalApOutstanding) * 100) / 100,
    };
  }
}
