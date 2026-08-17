import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Leave, LeaveDocument } from './schemas/leave.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';

@Injectable()
export class LeavesService {
  constructor(
    @InjectModel(Leave.name) private leaveModel: Model<LeaveDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async apply(dto: any, userId: string): Promise<LeaveDocument> {
    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const applicant = await this.userModel.findById(userId);
    if (!applicant) throw new NotFoundException('Applicant not found');

    const payload: any = {
      ...dto,
      employee: new Types.ObjectId(userId),
      days,
      status: 'pending',
    };

    // If applicant is HR or Manager, their leave request MUST go ONLY to Super Admin
    if (applicant.role === UserRole.MANAGEMENT || applicant.role === UserRole.HR) {
      const adminUser = await this.userModel.findOne({ role: UserRole.ADMIN, isActive: true });
      if (adminUser) {
        payload.requestedTo = adminUser._id;
      } else {
        payload.requestedTo = null;
      }
    } else if (dto.requestedTo && dto.requestedTo !== 'all' && dto.requestedTo !== '') {
      payload.requestedTo = new Types.ObjectId(dto.requestedTo);
    } else {
      payload.requestedTo = null;
    }

    const leave = new this.leaveModel(payload);
    return leave.save();
  }

  async findAll(query: any, user: any): Promise<{ leaves: LeaveDocument[]; total: number }> {
    const { status, employee, page = 1, limit = 50 } = query;
    const filter: any = {};
    const uId = user._id ? user._id.toString() : user.id;

    // Regular employees see ONLY their own leave applications
    if (!['admin', 'management', 'hr'].includes(user?.role)) {
      filter.$or = [
        { employee: new Types.ObjectId(uId) },
        { employee: uId },
      ];
    } else {
      // Super Admin sees ALL leaves
      if (user?.role === 'admin') {
        if (employee) filter.employee = new Types.ObjectId(employee);
      } else {
        // HR / Manager can see regular staff leaves assigned to all or to them, plus their own leaves
        filter.$or = [
          { employee: new Types.ObjectId(uId) }, // Their own leave
          { requestedTo: null }, // General company leaves
          { requestedTo: new Types.ObjectId(uId) }, // Specifically assigned to them
        ];
        if (employee) filter.employee = new Types.ObjectId(employee);
      }
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [leaves, total] = await Promise.all([
      this.leaveModel
        .find(filter)
        .populate('employee', 'name email department role designation')
        .populate('approvedBy', 'name email role designation')
        .populate('requestedTo', 'name email role designation')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.leaveModel.countDocuments(filter),
    ]);
    return { leaves, total };
  }

  async approve(id: string, approverId: string): Promise<LeaveDocument> {
    const leave = await this.leaveModel.findById(id).populate('employee', 'name email role');
    if (!leave) throw new NotFoundException('Leave not found');

    const applicant = leave.employee as any;
    const approver = await this.userModel.findById(approverId);
    if (!approver) throw new NotFoundException('Approver not found');

    // 1. Prevent self-approval
    if (applicant._id.toString() === approverId) {
      throw new ForbiddenException('Self-approval is forbidden. Your leave application must be reviewed by Super Admin.');
    }

    // 2. HR & Management leaves can ONLY be approved by Super Admin
    if ([UserRole.MANAGEMENT, UserRole.HR].includes(applicant.role)) {
      if (approver.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Only Super Admin has authority to approve Leave requests for HR and Management.');
      }
    }

    leave.status = 'approved';
    leave.approvedBy = new Types.ObjectId(approverId);
    leave.approvedAt = new Date();
    await leave.save();

    const updated = await this.leaveModel
      .findById(id)
      .populate('employee', 'name email role')
      .populate('approvedBy', 'name role')
      .populate('requestedTo', 'name role');

    if (!updated) throw new NotFoundException('Leave not found');
    return updated;
  }

  async reject(id: string, approverId: string, reason: string): Promise<LeaveDocument> {
    const leave = await this.leaveModel.findById(id).populate('employee', 'name email role');
    if (!leave) throw new NotFoundException('Leave not found');

    const applicant = leave.employee as any;
    const approver = await this.userModel.findById(approverId);
    if (!approver) throw new NotFoundException('Approver not found');

    // 1. Prevent self-rejection / self-review
    if (applicant._id.toString() === approverId) {
      throw new ForbiddenException('Self-review is not allowed.');
    }

    // 2. HR & Management leaves can ONLY be rejected by Super Admin
    if ([UserRole.MANAGEMENT, UserRole.HR].includes(applicant.role)) {
      if (approver.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Only Super Admin has authority to reject Leave requests for HR and Management.');
      }
    } 

    leave.status = 'rejected';
    leave.approvedBy = new Types.ObjectId(approverId);
    leave.rejectionReason = reason;
    leave.approvedAt = new Date();
    await leave.save();

    const updated = await this.leaveModel
      .findById(id)
      .populate('employee', 'name email role')
      .populate('approvedBy', 'name role')
      .populate('requestedTo', 'name role');

    if (!updated) throw new NotFoundException('Leave not found');
    return updated;
  }
}
