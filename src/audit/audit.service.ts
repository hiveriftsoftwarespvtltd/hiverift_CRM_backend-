import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private auditModel: Model<AuditLogDocument>) {}

  async log(data: { userId: string; action: string; module: string; recordId?: string; oldValue?: any; newValue?: any; ip?: string; description?: string }): Promise<void> {
    await new this.auditModel({ user: data.userId, ...data }).save();
  }

  async findAll(query: any): Promise<{ logs: AuditLogDocument[]; total: number }> {
    const { module, user, page = 1, limit = 50 } = query;
    const filter: any = {};
    if (module) filter.module = module;
    if (user) filter.user = user;
    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      this.auditModel.find(filter).populate('user', 'name email role').skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
      this.auditModel.countDocuments(filter),
    ]);
    return { logs, total };
  }
}
