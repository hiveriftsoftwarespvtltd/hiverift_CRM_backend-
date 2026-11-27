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
      metaAppId: setting?.metaAppId || this.configService.get<string>('META_APP_ID') || '',
      apiVersion: setting?.apiVersion || this.configService.get<string>('META_GRAPH_API_VERSION') || 'v20.0',
      defaultCountryCode: setting?.defaultCountryCode || '91',
      defaultDelaySeconds: setting?.defaultDelaySeconds ?? 10,
      lastQualityRating: setting?.lastQualityRating || '',
      lastMessagingLimit: setting?.lastMessagingLimit || '',
      accessTokenMasked: maskedToken,
      hasAccessToken: !!actualToken,
      webhookVerifyToken: setting?.webhookVerifyToken || envVerifyToken,
      isVerified: setting?.isVerified ?? true,
      lastTestedAt: setting?.lastTestedAt,
      webhookUrl: '/api/v1/meta/webhook',
    };
  }

  async updateSettings(dto: {
    wabaId?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    accessToken?: string;
    webhookVerifyToken?: string;
    metaAppId?: string;
    apiVersion?: string;
    defaultCountryCode?: string;
    defaultDelaySeconds?: number;
  }, userId?: string) {
    const updateData: any = {};
    if (dto.wabaId) updateData.wabaId = dto.wabaId.trim();
    if (dto.phoneNumberId) updateData.phoneNumberId = dto.phoneNumberId.trim();
    if (dto.businessAccountId) updateData.businessAccountId = dto.businessAccountId.trim();
    if (dto.accessToken && !dto.accessToken.includes('...')) updateData.accessToken = dto.accessToken.trim();
    if (dto.webhookVerifyToken) updateData.webhookVerifyToken = dto.webhookVerifyToken.trim();
    if (dto.metaAppId !== undefined) updateData.metaAppId = String(dto.metaAppId).trim();
    if (dto.apiVersion) updateData.apiVersion = String(dto.apiVersion).trim();
    if (dto.defaultCountryCode) updateData.defaultCountryCode = String(dto.defaultCountryCode).replace(/\D/g, '') || '91';
    if (dto.defaultDelaySeconds !== undefined) updateData.defaultDelaySeconds = Math.max(1, Number(dto.defaultDelaySeconds) || 10);
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
      const url = `https://graph.facebook.com/${apiVersion}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,messaging_limit_tier&access_token=${encodeURIComponent(token)}`;
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
        {
          $set: {
            isVerified: true,
            lastTestedAt: new Date(),
            ...(data.quality_rating ? { lastQualityRating: data.quality_rating } : {}),
            ...(data.messaging_limit_tier ? { lastMessagingLimit: data.messaging_limit_tier } : {}),
          },
        },
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
          messagingLimitTier: data.messaging_limit_tier,
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
