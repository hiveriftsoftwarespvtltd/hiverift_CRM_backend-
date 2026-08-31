import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentDocument } from './schemas/payment.schema';

@Injectable()
export class PaymentsService {
  constructor(@InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>) {}

  private async generatePaymentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const payments = await this.paymentModel.find({}, { paymentNo: 1 }).lean();
    let maxNum = 0;
    for (const p of payments) {
      if (p.paymentNo) {
        const match = p.paymentNo.match(/PAY-\d+-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.paymentModel.findOne({ paymentNo: `PAY-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `PAY-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  async create(dto: any, userId: string): Promise<PaymentDocument> {
    const paymentNo = await this.generatePaymentNo();
    const invoiceAmount = Number(dto.invoiceAmount) || 0;
    const receivedAmount = Number(dto.receivedAmount) || 0;
    const pendingAmount = Math.max(0, invoiceAmount - receivedAmount);
    let status = dto.status || 'pending';
    if (receivedAmount >= invoiceAmount && invoiceAmount > 0) status = 'paid';
    else if (receivedAmount > 0) status = 'partial';

    const payload: any = {
      ...dto,
      paymentNo,
      invoiceAmount,
      receivedAmount,
      pendingAmount,
      status,
      receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : new Date(),
      createdBy: new Types.ObjectId(userId),
    };
    if (dto.client) payload.client = new Types.ObjectId(dto.client);
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.quotation) payload.quotation = new Types.ObjectId(dto.quotation);

    const payment = new this.paymentModel(payload);
    return payment.save();
  }

  async findAll(query: any, user?: any): Promise<{ payments: PaymentDocument[]; total: number }> {
    const { status, client, project, page = 1, limit = 50, search } = query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (client) filter.client = new Types.ObjectId(client);
    if (project) filter.project = new Types.ObjectId(project);

    // Sales role isolation:
    // Only Super Admin and Management see ALL company-wide payments.
    // Sales users see ONLY payments created by themselves (or linked to their own quotations).
    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.createdBy = new Types.ObjectId(uId);
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const searchConditions = [
        { paymentNo: searchRegex },
        { reference: searchRegex },
      ];
      if (filter.createdBy) {
        filter.$and = [
          { createdBy: filter.createdBy },
          { $or: searchConditions }
        ];
        delete filter.createdBy;
      } else {
        filter.$or = searchConditions;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rawPayments, totalRaw] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('client', 'name company email phone status')
        .populate('lead', 'name company email phone status')
        .populate('quotation', 'quotationNo totalAmount services createdBy status')
        .populate('project', 'name projectId')
        .populate('createdBy', 'name email role')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.paymentModel.countDocuments(filter),
    ]);

    // Only include payments for WON leads (or payments for clients/projects, or payments where money was received)
    const payments = rawPayments.filter((p: any) => {
      if (p.lead) {
        const leadStatus = p.lead?.status;
        if (leadStatus && leadStatus !== 'won' && (!p.receivedAmount || p.receivedAmount === 0)) {
          return false;
        }
      }
      return true;
    });

    return { payments, total: payments.length };
  }

  async findOne(id: string, user?: any): Promise<PaymentDocument> {
    const p = await this.paymentModel
      .findById(id)
      .populate('client', 'name company email phone address gstin')
      .populate('lead', 'name company email phone address')
      .populate('quotation', 'quotationNo totalAmount services createdBy')
      .populate('project', 'name projectId')
      .populate('createdBy', 'name email role');
    if (!p) throw new NotFoundException('Payment record not found');

    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      const creatorId = (p.createdBy as any)?._id ? (p.createdBy as any)._id.toString() : (p.createdBy as any)?.toString();
      if (creatorId && creatorId !== uId) {
        throw new ForbiddenException('You do not have permission to view this payment record');
      }
    }
    return p;
  }

  async update(id: string, dto: any, user?: any): Promise<PaymentDocument> {
    const existing = await this.findOne(id, user);

    const invoiceAmount = dto.invoiceAmount !== undefined ? Number(dto.invoiceAmount) : existing.invoiceAmount;
    const receivedAmount = dto.receivedAmount !== undefined ? Number(dto.receivedAmount) : existing.receivedAmount;
    const pendingAmount = Math.max(0, invoiceAmount - receivedAmount);
    
    let status = dto.status || existing.status;
    if (receivedAmount >= invoiceAmount && invoiceAmount > 0) {
      status = 'paid';
    } else if (receivedAmount > 0) {
      status = 'partial';
    } else {
      status = 'pending';
    }

    const payload = {
      ...dto,
      invoiceAmount,
      receivedAmount,
      pendingAmount,
      status,
    };

    const updated = await this.paymentModel.findByIdAndUpdate(id, payload, { new: true });
    if (!updated) throw new NotFoundException('Payment record not found');
    return updated;
  }

  async remove(id: string, user?: any): Promise<void> {
    await this.findOne(id, user);
    const result = await this.paymentModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Payment record not found');
  }

  async delete(id: string, user?: any): Promise<void> {
    return this.remove(id, user);
  }

  async getSummary(user?: any): Promise<any> {
    const match: any = {};
    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      match.createdBy = new Types.ObjectId(uId);
    }

    const result = await this.paymentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalInvoiced: { $sum: '$invoiceAmount' },
          totalReceived: { $sum: '$receivedAmount' },
          totalPending: { $sum: '$pendingAmount' },
          count: { $sum: 1 },
        },
      },
    ]);
    return result[0] || { totalInvoiced: 0, totalReceived: 0, totalPending: 0, count: 0 };
  }
}

