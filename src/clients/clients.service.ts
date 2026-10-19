import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Client, ClientDocument } from './schemas/client.schema';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class ClientsService {
  constructor(@InjectModel(Client.name) private clientModel: Model<ClientDocument>) {}

  private async generateClientId(): Promise<string> {
    const clients = await this.clientModel.find({}, { clientId: 1 }).lean();
    let maxNum = 0;
    for (const c of clients) {
      if (c.clientId) {
        const match = c.clientId.match(/CLT-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.clientModel.findOne({ clientId: `CLT-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `CLT-${String(nextNum).padStart(4, '0')}`;
  }
  
  async create(dto: CreateClientDto, userId: string): Promise<ClientDocument> {
    const clientId = await this.generateClientId();
    const client = new this.clientModel({ ...dto, clientId, createdBy: new Types.ObjectId(userId) });
    return client.save();
  }

  async findAll(query: any, user?: any): Promise<{ clients: ClientDocument[]; total: number }> {
    const { search, status, page = 1, limit = 1000 } = query;
    const conditions: any[] = [];

    const role = String(user?.role || '').toLowerCase().trim();
    const isAdmin = role === 'admin' || role === 'management' || role === 'super_admin';
    const isSales = role === 'sales';

    // Sales reps are scoped to their portfolio, but technical/employee staff can view clients for project coordination
    if (isSales && !isAdmin) {
      const uId = user?._id ? user._id.toString() : user?.id ? user.id.toString() : user?.sub ? user.sub.toString() : '';
      if (uId && Types.ObjectId.isValid(uId)) {
        const uObjId = new Types.ObjectId(uId);
        conditions.push({
          $or: [
            { createdBy: uObjId },
            { createdBy: uId },
            { assignedSales: uObjId },
            { assignedSales: uId },
            { accountManager: uObjId },
            { accountManager: uId },
          ],
        });
      }
    }

    if (search) {
      conditions.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { company: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { clientId: { $regex: search, $options: 'i' } },
        ],
      });
    }

    if (status) conditions.push({ status });

    const filter = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : { $and: conditions }) : {};

    const skip = (Number(page) - 1) * Number(limit);
    const [rawClients, total] = await Promise.all([
      this.clientModel
        .find(filter)
        .populate('assignedSales', 'name email')
        .populate('createdBy', 'name email role')
        .populate('leadRef', 'leadId name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.clientModel.countDocuments(filter),
    ]);

    // Redact sensitive billing/financial totals for non-commercial staff
    const canSeeCommercial = isAdmin || isSales;
    const clients = rawClients.map(c => {
      if (canSeeCommercial) return c;
      const cObj = c.toObject ? c.toObject() : { ...c };
      cObj.totalRevenue = 0;
      cObj.totalBusiness = 0;
      cObj.pendingAmount = 0;
      return cObj as ClientDocument;
    });

    return { clients, total };
  }

  async findOne(id: string, user?: any): Promise<ClientDocument> {
    const client = await this.clientModel
      .findById(id)
      .populate('assignedSales', 'name email')
      .populate('leadRef', 'leadId name requirement status');

    if (!client) throw new NotFoundException('Client not found');

    const role = String(user?.role || '').toLowerCase().trim();
    const isAdmin = role === 'admin' || role === 'management' || role === 'super_admin';
    const isSales = role === 'sales';
    const canSeeCommercial = isAdmin || isSales;

    // Redact financial balances for employees while allowing full access to contact details
    if (!canSeeCommercial) {
      const clientObj = client.toObject ? client.toObject() : { ...client };
      clientObj.totalRevenue = 0;
      clientObj.totalBusiness = 0;
      clientObj.pendingAmount = 0;
      return clientObj as any;
    }

    return client;
  }

  async update(id: string, dto: any): Promise<ClientDocument> {
    const client = await this.clientModel.findByIdAndUpdate(id, dto, { new: true });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async remove(id: string): Promise<void> {
    const result = await this.clientModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Client not found');
  }
  
  async delete(id: string): Promise<void> {
    return this.remove(id);
  }
}
