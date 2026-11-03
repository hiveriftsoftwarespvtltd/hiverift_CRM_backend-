import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ServicePackage, ServicePackageDocument } from './schemas/service-package.schema';
import { CreateServicePackageDto } from './dto/create-service-package.dto';
import { UpdateServicePackageDto } from './dto/update-service-package.dto';

@Injectable()
export class ServicePackagesService {
  constructor(
    @InjectModel(ServicePackage.name) private packageModel: Model<ServicePackageDocument>,
  ) {}

  async create(dto: CreateServicePackageDto, user: any): Promise<ServicePackageDocument> {
    const userId = user._id ? user._id.toString() : user.id;
    const pkg = new this.packageModel({
      ...dto,
      createdBy: new Types.ObjectId(userId),
    });
    return pkg.save();
  }

  async findAll(query: any = {}): Promise<{ packages: ServicePackageDocument[]; total: number }> {
    const { category, billingModel, isActive, search, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (category) filter.category = category;
    if (billingModel) filter.billingModel = billingModel;
    if (isActive !== undefined) filter.isActive = isActive === 'true' || isActive === true;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { packageCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [packages, total] = await Promise.all([
      this.packageModel
        .find(filter)
        .populate('createdBy', 'name email')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.packageModel.countDocuments(filter),
    ]);

    return { packages, total };
  }

  async findOne(id: string): Promise<ServicePackageDocument> {
    const pkg = await this.packageModel.findById(id).populate('createdBy', 'name email');
    if (!pkg) throw new NotFoundException('Service package not found');
    return pkg;
  }

  async update(id: string, dto: UpdateServicePackageDto): Promise<ServicePackageDocument> {
    const pkg = await this.packageModel.findByIdAndUpdate(id, dto, { new: true });
    if (!pkg) throw new NotFoundException('Service package not found');
    return pkg;
  }

  async remove(id: string): Promise<void> {
    const res = await this.packageModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Service package not found');
  }
}

