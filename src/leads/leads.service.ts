import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument, LeadStatus } from './schemas/lead.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateFollowupDto } from './dto/create-followup.dto';

@Injectable()
export class LeadsService {
  constructor(@InjectModel(Lead.name) private leadModel: Model<LeadDocument>) {}

  private async generateLeadId(): Promise<string> {
    const leads = await this.leadModel.find({}, { leadId: 1 }).lean();
    let maxNum = 0;
    for (const l of leads) {
      if (l.leadId) {
        const match = l.leadId.match(/LEAD-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.leadModel.findOne({ leadId: `LEAD-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `LEAD-${String(nextNum).padStart(4, '0')}`;
  }

  async create(createLeadDto: CreateLeadDto, userId: string): Promise<LeadDocument> {
    const leadId = await this.generateLeadId();
    const payload: any = {
      ...createLeadDto,
      leadId,
      createdBy: new Types.ObjectId(userId),
      status: createLeadDto.assignedTo ? LeadStatus.ASSIGNED : LeadStatus.NEW,
    };
    if (createLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(createLeadDto.assignedTo);
    }

    const lead = new this.leadModel(payload);
    return lead.save();
  }

  async findAll(query: any, user: any): Promise<{ leads: LeadDocument[]; total: number }> {
    const { search, status, source, assignedTo, page = 1, limit = 20, startDate, endDate } = query;
    const filter: any = {};

    // Sales users see only their assigned leads
    if (user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }

    if (search) {
      const searchConditions = [
        { name: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
      ];
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions }
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    if (status) filter.status = status;
    if (source) filter.source = source;
    if (assignedTo) filter.assignedTo = new Types.ObjectId(assignedTo);

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [leads, total] = await Promise.all([
      this.leadModel
        .find(filter)
        .populate('assignedTo', 'name email role')
        .populate('createdBy', 'name email role')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.leadModel.countDocuments(filter),
    ]);

    return { leads, total };
  }

  async findOne(id: string): Promise<LeadDocument> {
    const lead = await this.leadModel
      .findById(id)
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role')
      .populate('followups.createdBy', 'name');

    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async update(id: string, updateLeadDto: UpdateLeadDto): Promise<LeadDocument> {
    const payload: any = { ...updateLeadDto };
    if (updateLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(updateLeadDto.assignedTo);
    }
    const lead = await this.leadModel.findByIdAndUpdate(id, payload, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async updateStatus(id: string, status: string, lostReason?: string): Promise<LeadDocument> {
    const update: any = { status };
    if (lostReason) update.lostReason = lostReason;
    const lead = await this.leadModel.findByIdAndUpdate(id, update, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async assign(id: string, assignedTo: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      { assignedTo: new Types.ObjectId(assignedTo), status: LeadStatus.ASSIGNED },
      { new: true },
    );
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async addFollowup(id: string, createFollowupDto: CreateFollowupDto, userId: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');

    const followup = {
      ...createFollowupDto,
      _id: new Types.ObjectId(),
      createdBy: new Types.ObjectId(userId),
      createdAt: new Date(),
    };

    lead.followups.push(followup as any);
    if (createFollowupDto.nextAction) {
      lead.nextFollowup = new Date(createFollowupDto.date);
    }
    return lead.save();
  }

  async addNote(id: string, text: string, userId: string): Promise<LeadDocument> {
    const lead = await this.leadModel.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');

    lead.notes.push({
      _id: new Types.ObjectId(),
      text,
      createdBy: new Types.ObjectId(userId),
      createdAt: new Date(),
    } as any);

    return lead.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.leadModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Lead not found');
  }

  async delete(id: string): Promise<void> {
    return this.remove(id);
  }

  async getStats(user?: any): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filter: any = {};
    if (user?.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }

    const [total, byStatus, todayFollowups] = await Promise.all([
      this.leadModel.countDocuments(filter),
      this.leadModel.aggregate([
        ...(filter.$or ? [{ $match: filter }] : []),
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.leadModel.countDocuments({
        ...filter,
        nextFollowup: {
          $gte: today,
          $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return { total, byStatus, todayFollowups };
  }

  async getTodayFollowups(user?: any): Promise<LeadDocument[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const filter: any = { nextFollowup: { $gte: today, $lt: tomorrow } };
    if (user?.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
      ];
    }

    return this.leadModel
      .find(filter)
      .populate('assignedTo', 'name email')
      .sort({ nextFollowup: 1 });
  }
}
