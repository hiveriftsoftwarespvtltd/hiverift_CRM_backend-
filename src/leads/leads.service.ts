import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument, LeadStatus } from './schemas/lead.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { Quotation, QuotationDocument } from '../quotations/schemas/quotation.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateFollowupDto } from './dto/create-followup.dto';

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Quotation.name) private quotationModel: Model<QuotationDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

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

  async autoCreateClientFromWonLead(lead: LeadDocument, userId?: string): Promise<ClientDocument | null> {
    if (!lead || lead.status !== LeadStatus.WON) return null;

    // Check if client record already exists for this lead
    let existingClient = await this.clientModel.findOne({
      $or: [
        { leadRef: lead._id },
        ...(lead.email ? [{ email: lead.email.toLowerCase().trim() }] : []),
        ...(lead.phone ? [{ phone: lead.phone.trim() }] : []),
      ],
    });

    if (existingClient) {
      if (!existingClient.leadRef) {
        existingClient.leadRef = lead._id;
        await existingClient.save();
      }
      await this.quotationModel.updateMany({ lead: lead._id, client: { $exists: false } }, { client: existingClient._id });
      await this.paymentModel.updateMany({ lead: lead._id, client: { $exists: false } }, { client: existingClient._id });
      return existingClient;
    }

    // Automatically generate new client profile
    const clientId = await this.generateClientId();
    const newClient = new this.clientModel({
      clientId,
      name: lead.name,
      company: lead.company || lead.name,
      phone: lead.phone,
      whatsapp: lead.whatsapp || lead.phone,
      email: lead.email ? lead.email.toLowerCase().trim() : undefined,
      city: lead.city || undefined,
      address: lead.address || undefined,
      leadRef: lead._id,
      assignedSales: lead.assignedTo || undefined,
      createdBy: userId ? new Types.ObjectId(userId) : lead.createdBy,
      status: 'active',
      totalBusiness: lead.estimatedValue || 0,
      totalRevenue: 0,
      pendingAmount: lead.estimatedValue || 0,
    });

    const savedClient = await newClient.save();

    // Link quotations & payments of this lead to the newly created client
    await this.quotationModel.updateMany({ lead: lead._id }, { $set: { client: savedClient._id } });
    await this.paymentModel.updateMany({ lead: lead._id }, { $set: { client: savedClient._id } });

    return savedClient;
  }

  async create(createLeadDto: CreateLeadDto, userId: string, user?: any): Promise<LeadDocument> {
    const leadId = await this.generateLeadId();
    const mode = createLeadDto.meetingMode || 'online';
    const payload: any = {
      ...createLeadDto,
      meetingMode: mode,
      leadId,
      createdBy: new Types.ObjectId(userId),
    };

    // If user is sales executive, automatically assign to themselves
    if (user?.role === 'sales') {
      payload.assignedTo = new Types.ObjectId(userId);
      payload.status = LeadStatus.ASSIGNED;
    } else if (createLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(createLeadDto.assignedTo);
      payload.status = LeadStatus.ASSIGNED;
    } else {
      payload.status = LeadStatus.NEW;
    }

    const lead = new this.leadModel(payload);
    const saved = await lead.save();

    if (saved.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(saved, userId);
    }
    return saved;
  }

  async findAll(query: any, user: any): Promise<{ leads: LeadDocument[]; total: number }> {
    const { search, status, source, meetingMode, assignedTo, page = 1, limit = 20, startDate, endDate } = query;
    const filter: any = {};

    // Sales users see only their assigned leads or leads created by them
    if (user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.$or = [
        { assignedTo: new Types.ObjectId(uId) },
        { assignedTo: uId },
        { createdBy: new Types.ObjectId(uId) },
        { createdBy: uId },
      ];
    }

    if (search) {
      // Find all users whose name or email matches search term
      const matchingUsers = await this.userModel.find(
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        },
        { _id: 1 },
      ).lean();

      const matchingUserIds = matchingUsers.map((u) => u._id);

      const searchConditions: any[] = [
        { name: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { requirement: { $regex: search, $options: 'i' } },
      ];

      if (matchingUserIds.length > 0) {
        searchConditions.push(
          { assignedTo: { $in: matchingUserIds } },
          { createdBy: { $in: matchingUserIds } },
        );
      }

      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (source && source !== 'all') {
      filter.source = source;
    }

    if (meetingMode && meetingMode !== 'all') {
      filter.meetingMode = meetingMode;
    }

    if (assignedTo && user.role !== 'sales') {
      filter.assignedTo = new Types.ObjectId(assignedTo);
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
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
      .populate('followups.createdBy', 'name email role')
      .populate('notes.createdBy', 'name email role');

    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async update(id: string, updateLeadDto: UpdateLeadDto, userId?: string, user?: any): Promise<LeadDocument> {
    const payload: any = { ...updateLeadDto };

    if (updateLeadDto.meetingMode) {
      payload.meetingMode = updateLeadDto.meetingMode;
    }

    // If sales role, do not allow changing assignedTo
    if (user?.role === 'sales') {
      delete payload.assignedTo;
    } else if (updateLeadDto.assignedTo) {
      payload.assignedTo = new Types.ObjectId(updateLeadDto.assignedTo);
    }

    const lead = await this.leadModel.findByIdAndUpdate(id, payload, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(lead, userId);
    }

    return lead;
  }

  async updateStatus(id: string, status: string, lostReason?: string, userId?: string): Promise<LeadDocument> {
    const update: any = { status };
    if (lostReason) update.lostReason = lostReason;
    const lead = await this.leadModel.findByIdAndUpdate(id, update, { new: true });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === LeadStatus.WON) {
      await this.autoCreateClientFromWonLead(lead, userId);
    }

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
    await lead.save();
    return this.findOne(id);
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

    await lead.save();
    return this.findOne(id);
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
