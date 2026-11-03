import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Deal, DealDocument, DealStage } from './schemas/deal.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

@Injectable()
export class DealsService {
  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // Standard Stage Probability Defaults
  private getStageDefaultProbability(stage: DealStage): number {
    switch (stage) {
      case DealStage.DISCOVERY:
        return 20;
      case DealStage.QUALIFICATION:
        return 40;
      case DealStage.PROPOSAL_SENT:
        return 60;
      case DealStage.NEGOTIATION:
        return 80;
      case DealStage.CLOSED_WON:
        return 100;
      case DealStage.CLOSED_LOST:
        return 0;
      default:
        return 20;
    }
  }

  async create(dto: CreateDealDto, user: any): Promise<DealDocument> {
    const userId = user._id ? user._id.toString() : user.id;
    const initialStage = dto.stage || DealStage.DISCOVERY;
    const probability = dto.probability !== undefined ? dto.probability : this.getStageDefaultProbability(initialStage);

    const payload: any = {
      title: dto.title,
      amount: dto.amount,
      currency: dto.currency || 'INR',
      revenueType: dto.revenueType,
      dealType: dto.dealType,
      stage: initialStage,
      probability,
      notes: dto.notes,
      createdBy: new Types.ObjectId(userId),
      stageHistory: [
        {
          stage: initialStage,
          changedAt: new Date(),
          changedBy: new Types.ObjectId(userId),
          notes: 'Deal created',
        },
      ],
    };

    if (dto.lead && Types.ObjectId.isValid(dto.lead)) {
      payload.lead = new Types.ObjectId(dto.lead);
    }
    if (dto.client && Types.ObjectId.isValid(dto.client)) {
      payload.client = new Types.ObjectId(dto.client);
    }
    if (dto.expectedCloseDate) {
      payload.expectedCloseDate = new Date(dto.expectedCloseDate);
    }

    if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) {
      payload.assignedTo = new Types.ObjectId(dto.assignedTo);
    } else {
      payload.assignedTo = new Types.ObjectId(userId);
    }

    const deal = new this.dealModel(payload);
    return deal.save();
  }

  async findAll(query: any, user: any): Promise<{ deals: any[]; total: number }> {
    const { stage, revenueType, assignedTo, search, page = 1, limit = 50 } = query;
    const filter: any = {};

    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);

    if (userRole === 'sales' && !isSuperAdmin) {
      filter.$or = [{ assignedTo: new Types.ObjectId(uId) }, { createdBy: new Types.ObjectId(uId) }];
    }

    if (stage) filter.stage = stage;
    if (revenueType) filter.revenueType = revenueType;
    if (assignedTo && Types.ObjectId.isValid(assignedTo)) filter.assignedTo = new Types.ObjectId(assignedTo);

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const searchCond = [{ title: searchRegex }, { dealId: searchRegex }];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchCond }];
        delete filter.$or;
      } else {
        filter.$or = searchCond;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [deals, total] = await Promise.all([
      this.dealModel
        .find(filter)
        .populate('lead', 'name company phone email leadId')
        .populate('client', 'name company phone email clientId')
        .populate('assignedTo', 'name email role department')
        .populate('createdBy', 'name email')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.dealModel.countDocuments(filter),
    ]);

    return { deals, total };
  }

  async findOne(id: string): Promise<DealDocument> {
    const deal = await this.dealModel
      .findById(id)
      .populate('lead', 'name company phone email leadId')
      .populate('client', 'name company phone email clientId')
      .populate('assignedTo', 'name email role department')
      .populate('createdBy', 'name email')
      .populate('stageHistory.changedBy', 'name email');

    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async update(id: string, dto: UpdateDealDto, user: any): Promise<DealDocument> {
    const deal = await this.dealModel.findById(id);
    if (!deal) throw new NotFoundException('Deal not found');

    const userId = user._id ? user._id.toString() : user.id;

    if (dto.title !== undefined) deal.title = dto.title;
    if (dto.amount !== undefined) deal.amount = dto.amount;
    if (dto.currency !== undefined) deal.currency = dto.currency;
    if (dto.revenueType !== undefined) deal.revenueType = dto.revenueType;
    if (dto.dealType !== undefined) deal.dealType = dto.dealType;
    if (dto.notes !== undefined) deal.notes = dto.notes;
    if (dto.lostReason !== undefined) deal.lostReason = dto.lostReason;

    if (dto.expectedCloseDate !== undefined) {
      deal.expectedCloseDate = dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : (undefined as any);
    }
    if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) {
      deal.assignedTo = new Types.ObjectId(dto.assignedTo);
    }
    if (dto.client && Types.ObjectId.isValid(dto.client)) {
      deal.client = new Types.ObjectId(dto.client);
    }

    // Handle Stage Change
    if (dto.stage && dto.stage !== deal.stage) {
      deal.stage = dto.stage;
      if (dto.probability === undefined) {
        deal.probability = this.getStageDefaultProbability(dto.stage);
      }
      deal.stageHistory.push({
        stage: dto.stage,
        changedAt: new Date(),
        changedBy: new Types.ObjectId(userId),
        notes: dto.notes || `Stage updated to ${dto.stage}`,
      });
    }

    if (dto.probability !== undefined) {
      deal.probability = dto.probability;
    }

    return deal.save();
  }

  async getPipelineSummary(user: any): Promise<any> {
    const filter: any = {};
    const uId = (user._id ? user._id.toString() : user.id).toString();
    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = [UserRole.ADMIN, UserRole.MANAGEMENT].includes(user.role) || ['admin', 'management', 'super_admin', 'superadmin'].includes(userRole);

    if (userRole === 'sales' && !isSuperAdmin) {
      filter.$or = [{ assignedTo: new Types.ObjectId(uId) }, { createdBy: new Types.ObjectId(uId) }];
    }

    const deals = await this.dealModel.find(filter).lean();

    const summaryByStage: Record<string, { count: number; totalAmount: number; forecastValue: number }> = {
      [DealStage.DISCOVERY]: { count: 0, totalAmount: 0, forecastValue: 0 },
      [DealStage.QUALIFICATION]: { count: 0, totalAmount: 0, forecastValue: 0 },
      [DealStage.PROPOSAL_SENT]: { count: 0, totalAmount: 0, forecastValue: 0 },
      [DealStage.NEGOTIATION]: { count: 0, totalAmount: 0, forecastValue: 0 },
      [DealStage.CLOSED_WON]: { count: 0, totalAmount: 0, forecastValue: 0 },
      [DealStage.CLOSED_LOST]: { count: 0, totalAmount: 0, forecastValue: 0 },
    };

    let totalPipelineValue = 0;
    let totalWeightedForecast = 0;

    for (const d of deals) {
      const st = d.stage || DealStage.DISCOVERY;
      const amt = Number(d.amount) || 0;
      const fVal = Number(d.forecastValue) || 0;

      if (!summaryByStage[st]) {
        summaryByStage[st] = { count: 0, totalAmount: 0, forecastValue: 0 };
      }
      summaryByStage[st].count++;
      summaryByStage[st].totalAmount += amt;
      summaryByStage[st].forecastValue += fVal;

      if (st !== DealStage.CLOSED_LOST) {
        totalPipelineValue += amt;
        totalWeightedForecast += fVal;
      }
    }

    return {
      totalDeals: deals.length,
      totalPipelineValue,
      totalWeightedForecast: Math.round(totalWeightedForecast),
      stages: summaryByStage,
    };
  }

  async remove(id: string): Promise<void> {
    const res = await this.dealModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Deal not found');
  }
}

