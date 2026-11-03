import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Checklist,
  ChecklistDocument,
  ChecklistType,
} from './schemas/checklist.schema';
import {
  EquipmentCustody,
  EquipmentCustodyDocument,
  EquipmentStatus,
} from './schemas/equipment-custody.schema';
import {
  Certification,
  CertificationDocument,
} from './schemas/certification.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import {
  CreateChecklistDto,
  ToggleChecklistItemDto,
} from './dto/create-checklist.dto';
import {
  CreateEquipmentDto,
  AssignEquipmentDto,
  ReturnEquipmentDto,
  CreateCertificationDto,
} from './dto/create-equipment.dto';

@Injectable()
export class EmployeeLifecycleService {
  constructor(
    @InjectModel(Checklist.name)
    private checklistModel: Model<ChecklistDocument>,
    @InjectModel(EquipmentCustody.name)
    private equipmentModel: Model<EquipmentCustodyDocument>,
    @InjectModel(Certification.name)
    private certificationModel: Model<CertificationDocument>,
    private approvalsService: ApprovalsService,
  ) {}

  // ================= CHECKLISTS =================

  private getDefaultChecklistItems(type: ChecklistType) {
    if (type === ChecklistType.ONBOARDING) {
      return [
        { taskName: 'Signed Offer Letter & NDA Received', category: 'HR', isCompleted: false },
        { taskName: 'Identity & Address Proof Verification', category: 'HR', isCompleted: false },
        { taskName: 'Bank Account & PAN/Aadhaar Collection', category: 'FINANCE', isCompleted: false },
        { taskName: 'Corporate Email & Slack Account Created', category: 'IT', isCompleted: false },
        { taskName: 'Workstation & Hardware Allocated', category: 'IT', isCompleted: false },
        { taskName: 'Access Credentials & VPN Configured', category: 'IT', isCompleted: false },
        { taskName: 'Introductory Team Orientation Completed', category: 'DEPARTMENT', isCompleted: false },
      ];
    } else {
      return [
        { taskName: 'Resignation Letter & Notice Period Documented', category: 'HR', isCompleted: false },
        { taskName: 'Knowledge Transfer & Repository Handover', category: 'DEPARTMENT', isCompleted: false },
        { taskName: 'Hardware / Laptop & Accessories Returned', category: 'IT', isCompleted: false },
        { taskName: 'Email, GitHub, Slack & System Access Revoked', category: 'IT', isCompleted: false },
        { taskName: 'Final Settlement & Gratuity Calculation', category: 'FINANCE', isCompleted: false },
        { taskName: 'Exit Interview Completed', category: 'HR', isCompleted: false },
        { taskName: 'Experience & Relieving Letter Issued', category: 'HR', isCompleted: false },
      ];
    }
  }

  async createChecklist(
    userId: string,
    dto: CreateChecklistDto,
  ): Promise<ChecklistDocument> {
    if (!Types.ObjectId.isValid(dto.employee)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const items =
      dto.customItems && dto.customItems.length > 0
        ? dto.customItems.map((i) => ({
            taskName: i.taskName,
            category: i.category || 'HR',
            isCompleted: false,
          }))
        : this.getDefaultChecklistItems(dto.checklistType);

    const payload: Partial<Checklist> = {
      employee: new Types.ObjectId(dto.employee),
      checklistType: dto.checklistType,
      items,
      status: 'IN_PROGRESS',
      createdBy: new Types.ObjectId(userId),
    };

    if (dto.targetCompletionDate) {
      payload.targetCompletionDate = new Date(dto.targetCompletionDate);
    }
    if (dto.assignedCoordinator && Types.ObjectId.isValid(dto.assignedCoordinator)) {
      payload.assignedCoordinator = new Types.ObjectId(dto.assignedCoordinator);
    }

    const doc = new this.checklistModel(payload);
    return doc.save();
  }

  async getChecklistsForEmployee(employeeId: string): Promise<ChecklistDocument[]> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee ID');
    }
    return this.checklistModel
      .find({ employee: new Types.ObjectId(employeeId) })
      .populate('employee', 'name email employeeId department designation')
      .populate('assignedCoordinator', 'name email')
      .populate('items.completedBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async toggleChecklistItem(
    checklistId: string,
    userId: string,
    dto: ToggleChecklistItemDto,
  ): Promise<ChecklistDocument> {
    if (!Types.ObjectId.isValid(checklistId)) {
      throw new BadRequestException('Invalid checklist ID');
    }

    const checklist = await this.checklistModel.findById(checklistId);
    if (!checklist) throw new NotFoundException('Checklist not found');

    const item = checklist.items.find((i) => i.taskName === dto.taskName);
    if (!item) throw new NotFoundException('Checklist item not found');

    item.isCompleted = !item.isCompleted;
    if (item.isCompleted) {
      item.completedAt = new Date();
      item.completedBy = new Types.ObjectId(userId);
      if (dto.notes) item.notes = dto.notes;
    } else {
      delete item.completedAt;
      delete item.completedBy;
    }

    // Check if all items are completed
    const allDone = checklist.items.every((i) => i.isCompleted);
    if (allDone) {
      checklist.status = 'COMPLETED';
      checklist.completedAt = new Date();

      if (checklist.checklistType === ChecklistType.OFFBOARDING) {
        // Log final No-Dues Clearance approval record
        await this.approvalsService.createRequest(userId, {
          entityType: ApprovalEntityType.CUSTOM,
          entityId: checklist._id.toString(),
          approvalType: 'OFFBOARDING_CLEARANCE',
          comments: `All offboarding items completed for employee ${checklist.employee}`,
        });
      }
    } else {
      checklist.status = 'IN_PROGRESS';
      delete checklist.completedAt;
    }

    return checklist.save();
  }

  // ================= EQUIPMENT CUSTODY =================

  async createEquipment(
    userId: string,
    dto: CreateEquipmentDto,
  ): Promise<EquipmentCustodyDocument> {
    const doc = new this.equipmentModel({
      assetName: dto.assetName,
      assetType: dto.assetType,
      serialNumber: dto.serialNumber,
      conditionAtIssue: dto.conditionAtIssue || 'GOOD',
      status: EquipmentStatus.AVAILABLE,
      notes: dto.notes,
      createdBy: new Types.ObjectId(userId),
    });
    return doc.save();
  }

  async getAllEquipment(query: any = {}): Promise<EquipmentCustodyDocument[]> {
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.assetType) filter.assetType = query.assetType;

    return this.equipmentModel
      .find(filter)
      .populate('assignedTo', 'name email employeeId department')
      .populate('returnVerifiedBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async assignEquipment(
    assetId: string,
    userId: string,
    dto: AssignEquipmentDto,
  ): Promise<EquipmentCustodyDocument> {
    if (!Types.ObjectId.isValid(assetId)) throw new BadRequestException('Invalid asset ID');
    if (!Types.ObjectId.isValid(dto.employeeId)) throw new BadRequestException('Invalid employee ID');

    const asset = await this.equipmentModel.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    asset.assignedTo = new Types.ObjectId(dto.employeeId);
    asset.issuedDate = dto.issuedDate ? new Date(dto.issuedDate) : new Date();
    asset.status = EquipmentStatus.ASSIGNED;
    if (dto.conditionAtIssue) asset.conditionAtIssue = dto.conditionAtIssue;
    if (dto.notes) asset.notes = dto.notes;

    return asset.save();
  }

  async returnEquipment(
    assetId: string,
    verifierUserId: string,
    dto: ReturnEquipmentDto,
  ): Promise<EquipmentCustodyDocument> {
    if (!Types.ObjectId.isValid(assetId)) throw new BadRequestException('Invalid asset ID');

    const asset = await this.equipmentModel.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    asset.status = EquipmentStatus.RETURNED;
    asset.returnedDate = dto.returnedDate ? new Date(dto.returnedDate) : new Date();
    asset.conditionAtReturn = dto.conditionAtReturn;
    asset.returnVerifiedBy = new Types.ObjectId(verifierUserId);
    if (dto.notes) asset.notes = dto.notes;

    return asset.save();
  }

  // ================= CERTIFICATIONS =================

  async addCertification(
    dto: CreateCertificationDto,
  ): Promise<CertificationDocument> {
    if (!Types.ObjectId.isValid(dto.employee)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const payload: Partial<Certification> = {
      employee: new Types.ObjectId(dto.employee),
      certificationName: dto.certificationName,
      issuingOrganization: dto.issuingOrganization,
      credentialId: dto.credentialId,
      credentialUrl: dto.credentialUrl,
      issueDate: new Date(dto.issueDate),
      notes: dto.notes,
    };

    if (dto.expiryDate) {
      payload.expiryDate = new Date(dto.expiryDate);
    }

    const cert = new this.certificationModel(payload);
    return cert.save();
  }

  async getCertificationsForEmployee(employeeId: string): Promise<CertificationDocument[]> {
    if (!Types.ObjectId.isValid(employeeId)) throw new BadRequestException('Invalid employee ID');
    return this.certificationModel
      .find({ employee: new Types.ObjectId(employeeId) })
      .populate('employee', 'name email employeeId department')
      .populate('verifiedBy', 'name email')
      .sort({ issueDate: -1 })
      .exec();
  }

  async getExpiringCertifications(daysThreshold: number = 60) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return this.certificationModel
      .find({
        expiryDate: { $gte: new Date(), $lte: thresholdDate },
      })
      .populate('employee', 'name email employeeId department')
      .sort({ expiryDate: 1 })
      .exec();
  }
}

