import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  WhatsappTemplate,
  WhatsappTemplateDocument,
  TemplateStatus,
  TemplateCategory,
} from '../schemas/whatsapp-template.schema';
import { WhatsappSetting, WhatsappSettingDocument } from '../schemas/whatsapp-setting.schema';
import { CreateTemplateDto, UpdateTemplateDto } from '../dto/template.dto';
import { OFFICIAL_HIVERIFT_TEMPLATES } from '../official-templates.data';

@Injectable()
export class WhatsappTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    @InjectModel(WhatsappTemplate.name)
    private readonly templateModel: Model<WhatsappTemplateDocument>,
    @InjectModel(WhatsappSetting.name)
    private readonly settingModel: Model<WhatsappSettingDocument>,
    private readonly configService: ConfigService,
  ) { }

  async onModuleInit() {
    try {
      this.logger.log('Syncing official Meta Cloud API approved templates on startup...');
      await this.syncMetaTemplates();
    } catch (e: any) {
      this.logger.warn(`Initial Meta template sync warning: ${e?.message || e}`);
    }
  }

  /**
   * Installs the 20 reference HiveRift templates as DRAFT, then syncs with Meta WABA
   * so only genuinely Meta-approved templates remain APPROVED & selectable.
   */
  async resetToOfficialTemplates(cleanOld = false) {
    try {
      this.logger.log('Installing reference HiveRift templates library...');

      if (cleanOld) {
        const officialNames = OFFICIAL_HIVERIFT_TEMPLATES.map((t) => t.name);
        const delRes = await this.templateModel.deleteMany({
          name: { $nin: officialNames },
          metaTemplateId: { $exists: false },
        });
        if (delRes.deletedCount > 0) {
          this.logger.log(`Cleaned up ${delRes.deletedCount} unverified draft templates.`);
        }
      }

      let count = 0;
      for (const tpl of OFFICIAL_HIVERIFT_TEMPLATES) {
        const existing = await this.templateModel.findOne({ name: tpl.name }).lean();
        if (existing?.metaTemplateId) {
          count++;
          continue;
        }
        await this.templateModel.findOneAndUpdate(
          { name: tpl.name },
          {
            $set: {
              ...tpl,
              status: TemplateStatus.DRAFT,
              isActive: false,
            },
          },
          { upsert: true, new: true },
        );
        count++;
      }

      const syncRes = await this.syncMetaTemplates();
      return {
        success: true,
        message: `Installed ${count} reference templates and synced ${syncRes.syncedCount || 0} live Meta-approved templates.`,
        count,
        syncedCount: syncRes.syncedCount || 0,
      };
    } catch (e: any) {
      this.logger.error(`Error loading official templates: ${e.message}`);
      throw new BadRequestException(`Failed to install official templates: ${e.message}`);
    }
  }

  async findAll(query?: any) {
    const filter: any = {};
    if (query?.status && query.status !== 'all') {
      filter.status = { $regex: new RegExp(`^${query.status}$`, 'i') };
    }
    if (query?.category && query.category !== 'all') {
      filter.category = query.category;
    }
    if (query?.metaVerifiedOnly === 'true' || query?.metaVerifiedOnly === true) {
      filter.metaTemplateId = { $exists: true, $nin: [null, ''] };
      filter.isActive = true;
    }
    if (query?.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { displayName: { $regex: query.search, $options: 'i' } },
        { body: { $regex: query.search, $options: 'i' } },
      ];
    }
    return await this.templateModel.find(filter).sort({ metaTemplateId: -1, createdAt: -1 }).lean();
  }

  async findOne(id: string) {
    const template = await this.templateModel.findById(id).lean();
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(dto: CreateTemplateDto, userId?: string) {
    const normalizedName = dto.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = await this.templateModel.findOne({ name: normalizedName });
    if (existing) {
      throw new BadRequestException(`Template with name '${dto.name}' already exists.`);
    }

    // Auto extract variables {{1}}, {{2}} etc. if not provided
    const varMatches = dto.body.match(/\{\{(\d+)\}\}/g) || [];
    const extractedVars = varMatches.map((m) => `Variable ${m.replace(/\D/g, '')}`);

    const template = new this.templateModel({
      ...dto,
      name: normalizedName,
      variables: dto.variables && dto.variables.length > 0 ? dto.variables : extractedVars,
      // Local custom templates remain DRAFT until approved in Meta Business Manager and synced
      status: TemplateStatus.DRAFT,
      isActive: false,
      createdBy: userId ? new Types.ObjectId(userId) : undefined,
    });

    return await template.save();
  }

  async update(id: string, dto: UpdateTemplateDto) {
    const updated = await this.templateModel.findByIdAndUpdate(id, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException('Template not found');
    return updated;
  }

  async delete(id: string) {
    const res = await this.templateModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Template not found');
    return { success: true, message: 'Template deleted' };
  }

  async syncMetaTemplates() {
    const setting = await this.settingModel.findOne().lean();
    const pageAccessToken = setting?.accessToken || this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const wabaId = setting?.wabaId || this.configService.get<string>('META_WABA_ID') || '1850522739692580';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || 'v20.0';

    if (!pageAccessToken || !wabaId) {
      return {
        success: false,
        message: 'Meta credentials (META_PAGE_ACCESS_TOKEN or META_WABA_ID) not configured',
        syncedCount: 0,
      };
    }

    try {
      const metaTemplates: any[] = [];
      let nextUrl: string | null = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100&access_token=${encodeURIComponent(pageAccessToken)}`;

      while (nextUrl) {
        const res = await fetch(nextUrl);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error?.message || 'Failed to fetch templates from Meta');
        }

        if (Array.isArray(data.data)) {
          metaTemplates.push(...data.data);
        }
        nextUrl = data?.paging?.next || null;
      }

      const syncedNames: string[] = [];
      let syncedCount = 0;

      for (const mt of metaTemplates) {
        syncedNames.push(mt.name);
        const bodyComp = mt.components?.find((c: any) => c.type === 'BODY') || {};
        const headerComp = mt.components?.find((c: any) => c.type === 'HEADER');
        const footerComp = mt.components?.find((c: any) => c.type === 'FOOTER');
        const buttonsComp = mt.components?.find((c: any) => c.type === 'BUTTONS');

        const buttons: any[] = [];
        if (buttonsComp && Array.isArray(buttonsComp.buttons)) {
          for (const b of buttonsComp.buttons) {
            buttons.push({
              type: b.type === 'URL' ? 'URL' : b.type === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'QUICK_REPLY',
              text: b.text || 'Action',
              value: b.url || b.phone_number || undefined,
            });
          }
        }

        const varMatches = (bodyComp.text || '').match(/\{\{(\d+)\}\}/g) || [];
        const variables = varMatches.map((m: string) => `Var ${m.replace(/\D/g, '')}`);

        await this.templateModel.findOneAndUpdate(
          { name: mt.name },
          {
            $set: {
              name: mt.name,
              displayName: mt.name.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
              category: mt.category || TemplateCategory.MARKETING,
              language: mt.language || 'en',
              headerType: headerComp ? (headerComp.format || 'TEXT') : 'NONE',
              headerText: headerComp?.text || undefined,
              body: bodyComp.text || '',
              footer: footerComp?.text || undefined,
              buttons,
              variables,
              status: mt.status || TemplateStatus.APPROVED,
              metaTemplateId: mt.id,
              isActive: mt.status === 'APPROVED',
            },
          },
          { upsert: true, new: true },
        );
        syncedCount++;
      }

      // Demote any local templates not found in Meta WABA so they cannot be falsely shown as APPROVED
      if (syncedNames.length > 0) {
        await this.templateModel.updateMany(
          { name: { $nin: syncedNames } },
          {
            $set: { status: TemplateStatus.DRAFT, isActive: false },
            $unset: { metaTemplateId: 1 },
          },
        );
      }

      return {
        success: true,
        message: `Successfully synchronized ${syncedCount} templates from Meta Cloud API`,
        syncedCount,
      };
    } catch (e: any) {
      this.logger.error(`Error syncing Meta templates: ${e.message}`);
      return {
        success: false,
        message: e.message,
        syncedCount: 0,
      };
    }
  }

  renderPreview(body: string, mappings: Record<string, string>, sampleValues: Record<string, string>): string {
    let rendered = body || '';
    Object.keys(mappings || {}).forEach((varIndex) => {
      const fieldKey = mappings[varIndex];
      const val = sampleValues[fieldKey] || sampleValues[varIndex] || `[${fieldKey || varIndex}]`;
      rendered = rendered.replace(new RegExp(`\\{\\{${varIndex}\\}\\}`, 'g'), val);
    });
    return rendered;
  }
}
