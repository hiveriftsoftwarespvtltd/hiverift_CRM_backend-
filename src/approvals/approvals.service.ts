import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ApprovalRecord,
  ApprovalRecordDocument,
  ApprovalStatus,
} from './schemas/approval-record.schema';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectModel(ApprovalRecord.name)
    private approvalModel: Model<ApprovalRecordDocument>,
  ) {}

  async createRequest(
    userId: string,
    dto: CreateApprovalRequestDto,
  ): Promise<ApprovalRecordDocument> {
    if (!Types.ObjectId.isValid(dto.entityId)) {
      throw new BadRequestException('Invalid entityId format');
    }

    const payload: Partial<ApprovalRecord> = {
      entityType: dto.entityType,
      entityId: new Types.ObjectId(dto.entityId),
      approvalType: dto.approvalType || 'COMMERCIAL',
      status: ApprovalStatus.PENDING,
      requestedBy: new Types.ObjectId(userId),
      requestedAt: new Date(),
      approverRole: dto.approverRole,
      comments: dto.comments,
      policyRef: dto.policyRef,
      metadata: dto.metadata || {},
    };

    if (dto.assignedApprover && Types.ObjectId.isValid(dto.assignedApprover)) {
      payload.assignedApprover = new Types.ObjectId(dto.assignedApprover);
    }

    const record = new this.approvalModel(payload);
    return record.save();
  }

  async findPendingForUser(
    userId: string,
    userRole: string,
  ): Promise<ApprovalRecordDocument[]> {
    const filter: any = {
      status: ApprovalStatus.PENDING,
      $or: [
        { assignedApprover: new Types.ObjectId(userId) },
        { approverRole: userRole },
      ],
    };

    // If super admin or management, they can see all pending approvals
    if (['SUPER_ADMIN', 'admin', 'management', 'MANAGEMENT'].includes(userRole)) {
      delete filter.$or;
    }

    return this.approvalModel
      .find(filter)
      .populate('requestedBy', 'name email avatar department role')
      .populate('assignedApprover', 'name email avatar department role')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findHistoryForEntity(
    entityType: string,
    entityId: string,
  ): Promise<ApprovalRecordDocument[]> {
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('Invalid entityId');
    }

    return this.approvalModel
      .find({
        entityType,
        entityId: new Types.ObjectId(entityId),
      })
      .populate('requestedBy', 'name email avatar department role')
      .populate('assignedApprover', 'name email avatar department role')
      .populate('actionBy', 'name email avatar department role')
      .sort({ createdAt: -1 })
      .exec();
  }

  async decide(
    approvalId: string,
    userId: string,
    userRole: string,
    dto: DecideApprovalDto,
  ): Promise<ApprovalRecordDocument> {
    if (!Types.ObjectId.isValid(approvalId)) {
      throw new BadRequestException('Invalid approval ID');
    }

    const record = await this.approvalModel.findById(approvalId);
    if (!record) {
      throw new NotFoundException('Approval record not found');
    }

    if (record.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException(
        `Approval is already settled with status: ${record.status}`,
      );
    }

    const isAssigned =
      record.assignedApprover &&
      record.assignedApprover.toString() === userId.toString();
    const isRoleMatch = record.approverRole && record.approverRole === userRole;
    const isSuperAdmin = ['SUPER_ADMIN', 'admin', 'management', 'MANAGEMENT'].includes(
      userRole,
    );

    if (!isAssigned && !isRoleMatch && !isSuperAdmin) {
      throw new ForbiddenException(
        'You are not authorized to make a decision on this approval request',
      );
    }

    record.status = dto.status;
    record.actionBy = new Types.ObjectId(userId);
    record.actionAt = new Date();
    if (dto.decisionReason) record.decisionReason = dto.decisionReason;
    if (dto.comments) record.comments = dto.comments;

    return record.save();
  }

  async findAll(query: any = {}): Promise<{ total: number; data: ApprovalRecordDocument[] }> {
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.approvalType) filter.approvalType = query.approvalType;

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.approvalModel.countDocuments(filter),
      this.approvalModel
        .find(filter)
        .populate('requestedBy', 'name email avatar department role')
        .populate('assignedApprover', 'name email avatar department role')
        .populate('actionBy', 'name email avatar department role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    return { total, data };
  }
}

