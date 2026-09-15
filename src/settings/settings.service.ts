import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting, SettingDocument } from './schemas/setting.schema';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Setting.name) private settingModel: Model<SettingDocument>,
  ) {}

  async getSettings(): Promise<SettingDocument> {
    let settings = await this.settingModel.findOne();
    if (!settings) {
      settings = await this.settingModel.create({
        companyName: 'HiveRift Softwares Pvt. Ltd.',
        companyEmail: 'info@hiverift.com',
        receiverEmail: 'info@hiverift.com',
        companyPhone: '+91 8005550199',
        companyAddress: 'HiveRift Tower, Karol Bagh, New Delhi-110005',
        companyWebsite: 'https://hiverift.com',
        currencySymbol: '₹ (INR)',
        taxRate: 18,
      });
    }
    return settings;
  }

  async updateSettings(data: Partial<Setting>, userId: string): Promise<SettingDocument> {
    let settings = await this.settingModel.findOne();
    if (!settings) {
      settings = new this.settingModel(data);
    } else {
      Object.assign(settings, data);
    }
    settings.updatedBy = userId as any;
    return await settings.save();
  }
}
