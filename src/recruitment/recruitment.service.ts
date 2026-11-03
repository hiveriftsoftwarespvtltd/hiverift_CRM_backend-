import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import {
  JobRequisition,
  JobRequisitionDocument,
} from './schemas/job-requisition.schema';
import {
  Candidate,
  CandidateDocument,
  CandidateStage,
} from './schemas/candidate.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import { CreateJobRequisitionDto } from './dto/create-requisition.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { AddScorecardDto } from './dto/add-scorecard.dto';
import { CreateOfferDto, ConvertEmployeeDto } from './dto/create-offer.dto';

@Injectable()
export class RecruitmentService {
  constructor(
    @InjectModel(JobRequisition.name)
    private requisitionModel: Model<JobRequisitionDocument>,
    @InjectModel(Candidate.name)
    private candidateModel: Model<CandidateDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private approvalsService: ApprovalsService,
  ) {}

  // ================= REQUISITIONS =================

  async createRequisition(
    userId: string,
    dto: CreateJobRequisitionDto,
  ): Promise<JobRequisitionDocument> {
    const payload: Partial<JobRequisition> = {
      jobTitle: dto.jobTitle,
      department: dto.department,
      openingsCount: dto.openingsCount || 1,
      minExperienceYears: dto.minExperienceYears || 0,
      maxExperienceYears: dto.maxExperienceYears || 0,
      minSalaryBudget: dto.minSalaryBudget || 0,
      maxSalaryBudget: dto.maxSalaryBudget || 0,
      employmentType: dto.employmentType,
      workplaceType: dto.workplaceType,
      jobDescription: dto.jobDescription,
      skillsRequired: dto.skillsRequired || [],
      status: dto.status,
      createdBy: new Types.ObjectId(userId),
    };

    if (dto.hiringManager && Types.ObjectId.isValid(dto.hiringManager)) {
      payload.hiringManager = new Types.ObjectId(dto.hiringManager);
    }

    const doc = new this.requisitionModel(payload);
    return doc.save();
  }

  async findAllRequisitions(query: any = {}) {
    const filter: any = {};
    if (query.department) filter.department = query.department;
    if (query.status) filter.status = query.status;

    return this.requisitionModel
      .find(filter)
      .populate('hiringManager', 'name email avatar')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findRequisitionById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid requisition ID');
    const requisition = await this.requisitionModel
      .findById(id)
      .populate('hiringManager', 'name email avatar')
      .populate('createdBy', 'name email')
      .exec();

    if (!requisition) throw new NotFoundException('Requisition not found');

    const candidates = await this.candidateModel
      .find({ jobRequisition: requisition._id })
      .sort({ createdAt: -1 })
      .exec();

    const stageBreakdown = {
      applied: candidates.filter((c) => c.stage === CandidateStage.APPLIED).length,
      screening: candidates.filter((c) => c.stage === CandidateStage.SCREENING).length,
      interviewing: candidates.filter((c) => c.stage === CandidateStage.INTERVIEW_SCHEDULED).length,
      offered: candidates.filter((c) => c.stage === CandidateStage.OFFERED).length,
      hired: candidates.filter((c) => c.stage === CandidateStage.HIRED).length,
      rejected: candidates.filter((c) => c.stage === CandidateStage.REJECTED).length,
      total: candidates.length,
    };

    return { requisition, candidates, stageBreakdown };
  }

  // ================= CANDIDATES =================

  async createCandidate(
    userId: string,
    dto: CreateCandidateDto,
  ): Promise<CandidateDocument> {
    if (!Types.ObjectId.isValid(dto.jobRequisition)) {
      throw new BadRequestException('Invalid jobRequisition ID');
    }

    const requisition = await this.requisitionModel.findById(dto.jobRequisition);
    if (!requisition) throw new NotFoundException('Job Requisition not found');

    const initialStage = dto.stage || CandidateStage.APPLIED;

    const candidate = new this.candidateModel({
      jobRequisition: requisition._id,
      name: dto.name,
      email: dto.email.toLowerCase().trim(),
      phone: dto.phone,
      currentCompany: dto.currentCompany,
      currentCtc: dto.currentCtc || 0,
      expectedCtc: dto.expectedCtc || 0,
      noticePeriodDays: dto.noticePeriodDays || 0,
      resumeUrl: dto.resumeUrl,
      stage: initialStage,
      stageHistory: [
        {
          stage: initialStage,
          changedAt: new Date(),
          changedBy: new Types.ObjectId(userId),
          notes: 'Candidate profile entered into recruitment pipeline',
        },
      ],
      createdBy: new Types.ObjectId(userId),
    });

    return candidate.save();
  }

  async findAllCandidates(query: any = {}) {
    const filter: any = {};
    if (query.jobRequisition && Types.ObjectId.isValid(query.jobRequisition)) {
      filter.jobRequisition = new Types.ObjectId(query.jobRequisition);
    }
    if (query.stage) filter.stage = query.stage;

    return this.candidateModel
      .find(filter)
      .populate('jobRequisition', 'jobTitle requisitionId department')
      .populate('createdBy', 'name email')
      .populate('convertedUserId', 'name email employeeId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findCandidateById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid candidate ID');
    const candidate = await this.candidateModel
      .findById(id)
      .populate('jobRequisition', 'jobTitle requisitionId department hiringManager minSalaryBudget maxSalaryBudget')
      .populate('stageHistory.changedBy', 'name email')
      .populate('scorecards.interviewer', 'name email avatar')
      .populate('convertedUserId', 'name email employeeId role department')
      .exec();

    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  async updateStage(
    candidateId: string,
    userId: string,
    newStage: CandidateStage,
    notes?: string,
    rejectionReason?: string,
  ): Promise<CandidateDocument> {
    if (!Types.ObjectId.isValid(candidateId)) throw new BadRequestException('Invalid candidate ID');

    const candidate = await this.candidateModel.findById(candidateId);
    if (!candidate) throw new NotFoundException('Candidate not found');

    candidate.stage = newStage;
    if (rejectionReason) candidate.rejectionReason = rejectionReason;

    candidate.stageHistory.push({
      stage: newStage,
      changedAt: new Date(),
      changedBy: new Types.ObjectId(userId),
      notes: notes || `Moved to ${newStage}`,
    });

    return candidate.save();
  }

  async addScorecard(
    candidateId: string,
    interviewerId: string,
    dto: AddScorecardDto,
  ): Promise<CandidateDocument> {
    if (!Types.ObjectId.isValid(candidateId)) throw new BadRequestException('Invalid candidate ID');

    const candidate = await this.candidateModel.findById(candidateId);
    if (!candidate) throw new NotFoundException('Candidate not found');

    candidate.scorecards.push({
      roundName: dto.roundName,
      interviewer: new Types.ObjectId(interviewerId),
      rating: dto.rating,
      recommendation: dto.recommendation,
      strengths: dto.strengths,
      weaknesses: dto.weaknesses,
      notes: dto.notes,
      submittedAt: new Date(),
    });

    return candidate.save();
  }

  async manageOffer(
    candidateId: string,
    userId: string,
    dto: CreateOfferDto,
  ): Promise<CandidateDocument> {
    if (!Types.ObjectId.isValid(candidateId)) throw new BadRequestException('Invalid candidate ID');

    const candidate = await this.candidateModel.findById(candidateId);
    if (!candidate) throw new NotFoundException('Candidate not found');

    candidate.offerDetails = {
      offeredCtc: dto.offeredCtc,
      joiningDate: new Date(dto.joiningDate),
      offerLetterUrl: dto.offerLetterUrl,
      offerStatus: dto.offerStatus || 'DRAFT',
    };

    candidate.stage = CandidateStage.OFFERED;
    candidate.stageHistory.push({
      stage: CandidateStage.OFFERED,
      changedAt: new Date(),
      changedBy: new Types.ObjectId(userId),
      notes: `Offer extended: ₹${dto.offeredCtc.toLocaleString()} CTC, Joining Date: ${new Date(dto.joiningDate).toLocaleDateString()}`,
    });

    await candidate.save();

    // Log offer approval record
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.CUSTOM,
      entityId: candidate._id.toString(),
      approvalType: 'JOB_OFFER',
      comments: `Job offer generated for ${candidate.name} (₹${dto.offeredCtc})`,
      metadata: {
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        offeredCtc: dto.offeredCtc,
      },
    });

    return candidate;
  }

  async convertToEmployee(
    candidateId: string,
    adminUserId: string,
    dto: ConvertEmployeeDto,
  ) {
    if (!Types.ObjectId.isValid(candidateId)) throw new BadRequestException('Invalid candidate ID');

    const candidate = await this.candidateModel.findById(candidateId);
    if (!candidate) throw new NotFoundException('Candidate not found');

    if (candidate.convertedUserId) {
      throw new ConflictException('Candidate is already converted to an employee');
    }

    // Check if email already registered in User collection
    const existing = await this.userModel.findOne({ email: candidate.email });
    if (existing) {
      throw new ConflictException(`User with email ${candidate.email} already exists`);
    }

    const rawPassword = dto.initialPassword || 'HiveRift@2026!';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const newUser = new this.userModel({
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      password: hashedPassword,
      role: dto.role,
      department: dto.department,
      designation: dto.designation || 'Associate',
      employeeId: dto.employeeId || `HR-${Date.now().toString().slice(-4)}`,
      isActive: true,
      joiningDate: candidate.offerDetails?.joiningDate || new Date(),
    });

    const savedUser = await newUser.save();

    candidate.stage = CandidateStage.HIRED;
    candidate.convertedUserId = savedUser._id as Types.ObjectId;
    candidate.stageHistory.push({
      stage: CandidateStage.HIRED,
      changedAt: new Date(),
      changedBy: new Types.ObjectId(adminUserId),
      notes: `Converted to Employee (User ID: ${savedUser._id}) with role: ${savedUser.role}`,
    });

    await candidate.save();

    return {
      success: true,
      message: `Candidate ${candidate.name} successfully converted to employee!`,
      userId: savedUser._id,
      employeeId: savedUser.employeeId,
      email: savedUser.email,
    };
  }
}

