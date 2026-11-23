import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  WhatsappSetting,
  WhatsappSettingDocument,
} from '../schemas/whatsapp-setting.schema';

@Injectable()
export class WhatsappSettingsService {
  private readonly logger = new Logger(WhatsappSettingsService.name);

  constructor(
    @InjectModel(WhatsappSetting.name)
    private readonly settingModel: Model<WhatsappSettingDocument>,
    private readonly configService: ConfigService,
  ) {}

  async getSettings() {
    let setting = await this.settingModel.findOne().lean();

    const envWabaId = this.configService.get<string>('META_WABA_ID') || '1850522739692580';
    const envPhoneId = this.configService.get<string>('META_PHONE_NUMBER_ID') || '1320625991128154';
    const envToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN') || '';
    const envVerifyToken = this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN') || 'hivecrm_webhook_2026_secure';

    const actualToken = setting?.accessToken || envToken;
    const maskedToken = actualToken
      ? `${actualToken.slice(0, 8)}...${actualToken.slice(-6)}`
      : 'Not configured';

    return {
      wabaId: setting?.wabaId || envWabaId,
      phoneNumberId: setting?.phoneNumberId || envPhoneId,
      businessAccountId: setting?.businessAccountId || envWabaId,
      accessTokenMasked: maskedToken,
      hasAccessToken: !!actualToken,
      webhookVerifyToken: setting?.webhookVerifyToken || envVerifyToken,
      isVerified: setting?.isVerified ?? true,
      lastTestedAt: setting?.lastTestedAt,
      webhookUrl: '/api/v1/whatsapp-campaigns/webhook',
    };
  }

  async updateSettings(dto: {
    wabaId?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    accessToken?: string;
    webhookVerifyToken?: string;
  }, userId?: string) {
    const updateData: any = {};
    if (dto.wabaId) updateData.wabaId = dto.wabaId.trim();
    if (dto.phoneNumberId) updateData.phoneNumberId = dto.phoneNumberId.trim();
    if (dto.businessAccountId) updateData.businessAccountId = dto.businessAccountId.trim();
    if (dto.accessToken && !dto.accessToken.includes('...')) updateData.accessToken = dto.accessToken.trim();
    if (dto.webhookVerifyToken) updateData.webhookVerifyToken = dto.webhookVerifyToken.trim();
    if (userId) updateData.updatedBy = new Types.ObjectId(userId);

    const setting = await this.settingModel.findOneAndUpdate(
      {},
      { $set: updateData },
      { upsert: true, new: true },
    );

    return this.getSettings();
  }

  async testConnection() {
    const setting = await this.settingModel.findOne().lean();
    const token = setting?.accessToken || this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const phoneId = setting?.phoneNumberId || this.configService.get<string>('META_PHONE_NUMBER_ID') || '1320625991128154';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || 'v22.0';

    if (!token) {
      return {
        success: false,
        message: 'No Access Token found. Please configure META_PAGE_ACCESS_TOKEN.',
      };
    }

    try {
      const url = `https://graph.facebook.com/${apiVersion}/${phoneId}?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          message: data?.error?.message || `HTTP ${res.status}: Failed to reach Meta Cloud API`,
          error: data?.error,
        };
      }

      await this.settingModel.findOneAndUpdate(
        {},
        { $set: { isVerified: true, lastTestedAt: new Date() } },
        { upsert: true },
      );

      return {
        success: true,
        message: 'Meta WhatsApp Cloud API connection successful!',
        data: {
          displayPhoneNumber: data.display_phone_number,
          verifiedName: data.verified_name,
          qualityRating: data.quality_rating,
          codeVerificationStatus: data.code_verification_status,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error connecting to Meta: ${err.message}`,
      };
    }
  }
}
