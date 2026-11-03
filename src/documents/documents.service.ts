import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DocumentCategory,
  DocumentRecord,
  DocumentRecordDocument,
} from './schemas/document-record.schema';
import {
  AddDocumentVersionDto,
  CreateDocumentDto,
} from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(DocumentRecord.name)
    private docModel: Model<DocumentRecordDocument>,
  ) {}

  async create(userId: string, dto: CreateDocumentDto): Promise<DocumentRecordDocument> {
    const payload: Partial<DocumentRecord> = {
      title: dto.title,
      description: dto.description || '',
      category: dto.category || DocumentCategory.GENERAL,
      fileUrl: dto.fileUrl,
      fileName: dto.fileName,
      fileSize: dto.fileSize || 0,
      mimeType: dto.mimeType,
      currentVersion: 1,
      versions: [
        {
          versionNumber: 1,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          fileSize: dto.fileSize || 0,
          uploadedBy: new Types.ObjectId(userId),
          uploadedAt: new Date(),
          changeSummary: 'Initial document upload',
        },
      ],
      permissions: {
        allowedRoles: dto.allowedRoles || [],
        allowedDepartments: dto.allowedDepartments || [],
        isPublicToAllEmployees: dto.isPublicToAllEmployees !== undefined ? dto.isPublicToAllEmployees : true,
      },
      uploadedBy: new Types.ObjectId(userId),
    };

    if (dto.linkedClient && Types.ObjectId.isValid(dto.linkedClient) && payload.permissions) {
      payload.permissions.linkedClient = new Types.ObjectId(dto.linkedClient);
    }

    if (dto.linkedEntityType && dto.linkedEntityId && Types.ObjectId.isValid(dto.linkedEntityId)) {
      payload.linkedEntity = {
        entityType: dto.linkedEntityType,
        entityId: new Types.ObjectId(dto.linkedEntityId),
      };
    }

    if (dto.expiryDate) {
      payload.expiryDate = new Date(dto.expiryDate);
    }

    const doc = new this.docModel(payload);
    return doc.save();
  }

  async findAll(user: any, query: any = {}) {
    const filter: any = { isArchived: false };

    // Role-based Security Gate (P1-11)
    const userRole = (user.role || '').toLowerCase().trim();
    const isAdmin = ['admin', 'management', 'super_admin'].includes(userRole);

    if (userRole === 'client') {
      if (!user.clientRef) {
        throw new ForbiddenException('Client account has no linked client organization');
      }
      filter['permissions.linkedClient'] = new Types.ObjectId(user.clientRef);
    } else if (!isAdmin) {
      // Internal Employee Scoping
      filter.$or = [
        { 'permissions.isPublicToAllEmployees': true },
        { 'permissions.allowedRoles': user.role },
        { 'permissions.allowedDepartments': user.department },
      ];
    }

    // Additional query filters
    if (query.category) filter.category = query.category;
    if (query.linkedEntityType && query.linkedEntityId) {
      filter['linkedEntity.entityType'] = query.linkedEntityType;
      filter['linkedEntity.entityId'] = new Types.ObjectId(query.linkedEntityId);
    }
    if (query.search) {
      const searchRegex = new RegExp(query.search, 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { title: searchRegex },
          { description: searchRegex },
          { fileName: searchRegex },
          { docId: searchRegex },
        ],
      });
    }

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.docModel.countDocuments(filter),
      this.docModel
        .find(filter)
        .populate('uploadedBy', 'name email avatar')
        .populate('permissions.linkedClient', 'name company clientId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    return { total, data, page, limit };
  }

  async findOne(id: string, user: any): Promise<DocumentRecordDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid document ID');

    const doc = await this.docModel
      .findById(id)
      .populate('uploadedBy', 'name email avatar')
      .populate('versions.uploadedBy', 'name email')
      .populate('permissions.linkedClient', 'name company clientId')
      .exec();

    if (!doc || doc.isArchived) throw new NotFoundException('Document not found');

    // Permission Verification
    const userRole = (user.role || '').toLowerCase().trim();
    const isAdmin = ['admin', 'management', 'super_admin'].includes(userRole);

    if (userRole === 'client') {
      if (!doc.permissions.linkedClient || doc.permissions.linkedClient.toString() !== (user.clientRef || '').toString()) {
        throw new ForbiddenException('You do not have access to this document');
      }
    } else if (!isAdmin) {
      const isPublic = doc.permissions.isPublicToAllEmployees;
      const isRoleAllowed = doc.permissions.allowedRoles?.includes(user.role);
      const isDeptAllowed = doc.permissions.allowedDepartments?.includes(user.department);
      if (!isPublic && !isRoleAllowed && !isDeptAllowed) {
        throw new ForbiddenException('You do not have access to this document');
      }
    }

    return doc;
  }

  async addVersion(
    id: string,
    userId: string,
    dto: AddDocumentVersionDto,
  ): Promise<DocumentRecordDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid document ID');

    const doc = await this.docModel.findById(id);
    if (!doc || doc.isArchived) throw new NotFoundException('Document not found');

    const nextVersionNumber = doc.currentVersion + 1;

    doc.versions.push({
      versionNumber: nextVersionNumber,
      fileUrl: dto.fileUrl,
      fileName: dto.fileName,
      fileSize: dto.fileSize || 0,
      uploadedBy: new Types.ObjectId(userId),
      uploadedAt: new Date(),
      changeSummary: dto.changeSummary || `Updated to version ${nextVersionNumber}`,
    });

    doc.currentVersion = nextVersionNumber;
    doc.fileUrl = dto.fileUrl;
    doc.fileName = dto.fileName;
    if (dto.fileSize) doc.fileSize = dto.fileSize;

    return doc.save();
  }

  async archive(id: string): Promise<{ success: boolean; message: string }> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid document ID');
    const doc = await this.docModel.findByIdAndUpdate(id, { $set: { isArchived: true } });
    if (!doc) throw new NotFoundException('Document not found');
    return { success: true, message: 'Document archived successfully' };
  }

  async getExpiringDocuments(daysThreshold: number = 30) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return this.docModel
      .find({
        isArchived: false,
        expiryDate: { $gte: new Date(), $lte: thresholdDate },
      })
      .populate('uploadedBy', 'name email')
      .populate('permissions.linkedClient', 'name company')
      .sort({ expiryDate: 1 })
      .exec();
  }
}
