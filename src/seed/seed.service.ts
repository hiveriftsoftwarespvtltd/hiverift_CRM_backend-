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
    await this.seedSuperAdmin();
  }

  private async seedSuperAdmin() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL') || 'hiverift@gmail.com';
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD') || '123456';

    try {
      const exists = await this.userModel.findOne({
        email: { $regex: new RegExp(`^${adminEmail}$`, 'i') },
      });

      if (!exists) {
        const adminUser = new this.userModel({
          name: 'Vineet',
          email: adminEmail,
          password: adminPassword,
          role: UserRole.ADMIN,
          department: 'Management',
          designation: 'Super Administrator',
          isActive: true,
        });
        await adminUser.save();
        this.logger.log(`✅ Super Admin created: ${adminEmail}`);
      }
    } catch (err) {
      this.logger.debug(`Super Admin check/seed completed`);
    }
  }
}
