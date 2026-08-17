import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Renewal, RenewalDocument } from './schemas/renewal.schema';

@Injectable()
export class RenewalsService {
  constructor(@InjectModel(Renewal.name) private renewalModel: Model<RenewalDocument>) {}

  async create(dto: any, userId: string): Promise<RenewalDocument> {
    const payload: any = {
      ...dto,
      createdBy: new Types.ObjectId(userId),
    };
    if (dto.client) payload.client = new Types.ObjectId(dto.client);
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.assignedSales) payload.assignedSales = new Types.ObjectId(dto.assignedSales);

    const renewal = new this.renewalModel(payload);
    return renewal.save();
  }

  async findAll(query: any): Promise<{ renewals: RenewalDocument[]; total: number }> {
    const { status, client, page = 1, limit = 20 } = query;
    const filter: any = {};
    if (status) filter.status = status;
    if (client) filter.client = new Types.ObjectId(client);
    await this.syncStatuses();
    const skip = (Number(page) - 1) * Number(limit);
    const [renewals, total] = await Promise.all([
      this.renewalModel.find(filter).populate('client', 'name company').populate('assignedSales', 'name').skip(skip).limit(Number(limit)).sort({ expiryDate: 1 }),
      this.renewalModel.countDocuments(filter),
    ]);
    return { renewals, total };
  }

  async getDashboard(): Promise<any> {
    await this.syncStatuses();
    const today = await this.renewalModel.countDocuments({ status: 'due_today' });
    const next7 = await this.renewalModel.countDocuments({ status: 'next_7_days' });
    const next30 = await this.renewalModel.countDocuments({ status: 'next_30_days' });
    const renewed = await this.renewalModel.countDocuments({ status: 'renewed' });
    const expired = await this.renewalModel.countDocuments({ status: 'expired' });
    return { dueToday: today, next7Days: next7, next30Days: next30, renewed, expired };
  }

  private async syncStatuses(): Promise<void> {
    const now = new Date();
    const d7 = new Date(); d7.setDate(d7.getDate() + 7);
    const d30 = new Date(); d30.setDate(d30.getDate() + 30);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    await this.renewalModel.updateMany({ status: 'active', expiryDate: { $lt: now } }, { status: 'expired' });
    await this.renewalModel.updateMany({ status: 'active', expiryDate: { $gte: now, $lte: todayEnd } }, { status: 'due_today' });
    await this.renewalModel.updateMany({ status: 'active', expiryDate: { $gt: todayEnd, $lte: d7 } }, { status: 'next_7_days' });
    await this.renewalModel.updateMany({ status: 'active', expiryDate: { $gt: d7, $lte: d30 } }, { status: 'next_30_days' });
  }

  async renew(id: string, newExpiryDate: Date, amount?: number): Promise<RenewalDocument> {
    const renewal = await this.renewalModel.findByIdAndUpdate(
      id,
      { status: 'renewed', renewedAt: new Date(), newExpiryDate, ...(amount ? { amount } : {}) },
      { new: true },
    );
    if (!renewal) throw new NotFoundException('Renewal not found');
    return renewal;
  }

  async update(id: string, dto: any): Promise<RenewalDocument> {
    const payload = { ...dto };
    if (dto.client) payload.client = new Types.ObjectId(dto.client);
    if (dto.project) payload.project = new Types.ObjectId(dto.project);
    if (dto.assignedSales) payload.assignedSales = new Types.ObjectId(dto.assignedSales);
    const renewal = await this.renewalModel.findByIdAndUpdate(id, payload, { new: true });
    if (!renewal) throw new NotFoundException('Renewal not found');
    return renewal;
  }
}
