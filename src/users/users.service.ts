import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const existing = await this.userModel.findOne({ email: createUserDto.email.toLowerCase().trim() });
    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }
    const payload: any = { ...createUserDto };
    if (payload.reportingTo && Types.ObjectId.isValid(payload.reportingTo)) {
      payload.reportingTo = new Types.ObjectId(payload.reportingTo);
    } else {
      delete payload.reportingTo;
    }
    const user = new this.userModel(payload);
    return user.save();
  }

  async findAll(query: any = {}): Promise<{ users: UserDocument[]; total: number }> {
    const { role, department, isActive, search, page = 1, limit = 100 } = query;
    const filter: any = {};

    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true' || isActive === true;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { designation: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .populate('reportingTo', 'name email role designation isDepartmentHead')
        .select('-password -refreshToken')
        .skip(skip)
        .limit(Number(limit))
        .sort({ isDepartmentHead: -1, createdAt: -1 }),
      this.userModel.countDocuments(filter),
    ]);

    return { users, total };
  }

  async findOne(id: string): Promise<UserDocument> {
    const user = await this.userModel
      .findById(id)
      .populate('reportingTo', 'name email role designation isDepartmentHead')
      .select('-password -refreshToken');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+password +refreshToken');
  }

  async findByRefreshToken(id: string, refreshToken: string): Promise<UserDocument | null> {
    const user = await this.userModel.findById(id).select('+refreshToken');
    if (!user || !user.refreshToken) return null;
    const isMatch = await bcrypt.compare(refreshToken, user.refreshToken);
    return isMatch ? user : null;
  }

  async updateRefreshToken(id: string, refreshToken: string | null): Promise<void> {
    if (refreshToken) {
      const hashed = await bcrypt.hash(refreshToken, 10);
      await this.userModel.findByIdAndUpdate(id, { refreshToken: hashed });
    } else {
      await this.userModel.findByIdAndUpdate(id, { $unset: { refreshToken: 1 } });
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    const payload: any = { ...updateUserDto };
    if (payload.password) {
      payload.password = await bcrypt.hash(payload.password, 12);
    }
    if (payload.reportingTo && Types.ObjectId.isValid(payload.reportingTo)) {
      payload.reportingTo = new Types.ObjectId(payload.reportingTo);
    } else if (payload.reportingTo === '' || payload.reportingTo === null) {
      payload.reportingTo = null;
    }
    const user = await this.userModel
      .findByIdAndUpdate(id, payload, { new: true })
      .populate('reportingTo', 'name email role designation isDepartmentHead')
      .select('-password -refreshToken');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async remove(id: string): Promise<void> {
    const res = await this.userModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('User not found');
  }
}
