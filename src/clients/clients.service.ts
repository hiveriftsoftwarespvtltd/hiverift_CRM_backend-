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

    if (!isAdmin && user) {
      const uId = user._id ? user._id.toString() : user.id ? user.id.toString() : '';
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
    const [clients, total] = await Promise.all([
      this.clientModel
        .find(filter)
        .populate('assignedSales', 'name email')
        .populate('leadRef', 'leadId name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.clientModel.countDocuments(filter),
    ]);

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

    if (!isAdmin && user) {
      const uId = user._id ? user._id.toString() : user.id ? user.id.toString() : '';
      const createdByStr = client.createdBy?.toString();
      const assignedSalesStr = client.assignedSales?._id ? client.assignedSales._id.toString() : client.assignedSales?.toString();
      const accountManagerStr = client.accountManager?.toString();

      if (createdByStr !== uId && assignedSalesStr !== uId && accountManagerStr !== uId) {
        throw new NotFoundException('Client not found');
      }
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
