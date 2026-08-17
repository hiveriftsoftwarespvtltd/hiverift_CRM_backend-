import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedAllRoles();
  }

  private async seedAllRoles() {
    const defaultUsers = [
      {
        name: 'Vineet',
        email: this.configService.get<string>('ADMIN_EMAIL') || 'vineetvineet8006@gmail.com',
        password: this.configService.get<string>('ADMIN_PASSWORD') || '123456',
        role: UserRole.ADMIN,
        department: 'Management',
        designation: 'System Administrator',
      },
      {
        name: 'Vikram Singh (General Manager)',
        email: this.configService.get<string>('MANAGEMENT_EMAIL') || 'management@hiverift.com',
        password: this.configService.get<string>('MANAGEMENT_PASSWORD') || 'password123',
        role: UserRole.MANAGEMENT,
        department: 'Management',
        designation: 'General Manager',
      },
      {
        name: 'Rahul Sharma (Sales Executive)',
        email: this.configService.get<string>('SALES_EMAIL') || 'sales@hiverift.com',
        password: this.configService.get<string>('SALES_PASSWORD') || 'password123',
        role: UserRole.SALES,
        department: 'Sales',
        designation: 'Senior Sales Executive',
      },
      {
        name: 'Ankit Marketing (Digital Marketer)',
        email: this.configService.get<string>('MARKETING_EMAIL') || 'marketing@hiverift.com',
        password: this.configService.get<string>('MARKETING_PASSWORD') || 'password123',
        role: UserRole.DIGITAL_MARKETING,
        department: 'Digital Marketing',
        designation: 'SEO & Ads Specialist',
      },
      {
        name: 'Priya Verma (Fullstack Developer)',
        email: this.configService.get<string>('DEV_EMAIL') || 'dev@hiverift.com',
        password: this.configService.get<string>('DEV_PASSWORD') || 'password123',
        role: UserRole.DEVELOPMENT,
        department: 'Development',
        designation: 'Senior React & Node Developer',
      },
      {
        name: 'Neha Kapoor (HR Manager)',
        email: this.configService.get<string>('HR_EMAIL') || 'hr@hiverift.com',
        password: this.configService.get<string>('HR_PASSWORD') || 'password123',
        role: UserRole.HR,
        department: 'Human Resources',
        designation: 'HR Lead',
      },
    ];

    for (const u of defaultUsers) {
      try {
        const exists = await this.userModel.findOne({ email: { $regex: new RegExp(`^${u.email}$`, 'i') } });
        if (!exists) {
          const user = new this.userModel({ ...u, isActive: true });
          await user.save();
          this.logger.log(`✅ Seeded user: ${u.email} (${u.role})`);
        } else if (u.role === UserRole.ADMIN && exists.name !== 'Vineet') {
          exists.name = 'Vineet';
          await exists.save();
          this.logger.log(`🔄 Updated Admin name to Vineet in database`);
        }
      } catch (err) {
        this.logger.debug(`User ${u.email} already exists or seed error skipped`);
      }
    }
  }
}
