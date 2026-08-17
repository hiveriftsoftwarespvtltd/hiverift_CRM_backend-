import { Injectable, NotFoundException } from '@nestjs/common';
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

  async findAll(query: any): Promise<{ payments: PaymentDocument[]; total: number }> {
    const { status, client, project, page = 1, limit = 50 } = query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (client) filter.client = new Types.ObjectId(client);
    if (project) filter.project = new Types.ObjectId(project);
    const skip = (Number(page) - 1) * Number(limit);
    const [payments, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('client', 'name company email phone')
        .populate('lead', 'name company email phone')
        .populate('quotation', 'quotationNo totalAmount services')
        .populate('project', 'name projectId')
        .populate('createdBy', 'name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.paymentModel.countDocuments(filter),
    ]);
    return { payments, total };
  }

  async findOne(id: string): Promise<PaymentDocument> {
    const p = await this.paymentModel
      .findById(id)
      .populate('client', 'name company email phone address gstin')
      .populate('lead', 'name company email phone address')
      .populate('quotation', 'quotationNo totalAmount services')
      .populate('project', 'name projectId')
      .populate('createdBy', 'name email');
    if (!p) throw new NotFoundException('Payment record not found');
    return p;
  }

  async update(id: string, dto: any): Promise<PaymentDocument> {
    const existing = await this.paymentModel.findById(id);
    if (!existing) throw new NotFoundException('Payment record not found');

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

  async remove(id: string): Promise<void> {
    const result = await this.paymentModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Payment record not found');
  }

  async delete(id: string): Promise<void> {
    return this.remove(id);
  }

  async getSummary(): Promise<any> {
    const result = await this.paymentModel.aggregate([
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
