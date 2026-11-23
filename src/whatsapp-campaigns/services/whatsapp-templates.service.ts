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
import { CreateTemplateDto, UpdateTemplateDto } from '../dto/template.dto';
import { OFFICIAL_HIVERIFT_TEMPLATES } from '../official-templates.data';

@Injectable()
export class WhatsappTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    @InjectModel(WhatsappTemplate.name)
    private readonly templateModel: Model<WhatsappTemplateDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.resetToOfficialTemplates(true);
    try {
      this.logger.log('Syncing official Meta Cloud API approved templates on startup...');
      await this.syncMetaTemplates();
    } catch (e: any) {
      this.logger.warn(`Initial Meta template sync warning: ${e?.message || e}`);
    }
  }

  /**
   * Resets and populates the database with the 20 official Meta-approved HiveRift WhatsApp templates.
   */
  async resetToOfficialTemplates(cleanOld = true) {
    try {
      this.logger.log('Seeding official Meta-approved HiveRift WhatsApp templates library...');

      if (cleanOld) {
        // Remove old non-official templates to ensure clean official library
        const officialNames = OFFICIAL_HIVERIFT_TEMPLATES.map((t) => t.name);
        const delRes = await this.templateModel.deleteMany({ name: { $nin: officialNames } });
        if (delRes.deletedCount > 0) {
          this.logger.log(`Cleaned up ${delRes.deletedCount} old non-official templates.`);
        }
      }

      let count = 0;
      for (const tpl of OFFICIAL_HIVERIFT_TEMPLATES) {
        await this.templateModel.findOneAndUpdate(
          { name: tpl.name },
          { $set: tpl },
          { upsert: true, new: true },
        );
        count++;
      }

      this.logger.log(`Successfully installed all ${count} official Meta-approved HiveRift templates.`);
      return {
        success: true,
        message: `Successfully installed and synchronized all ${count} official Meta-approved HiveRift templates.`,
        count,
      };
    } catch (e: any) {
      this.logger.error(`Error loading official templates: ${e.message}`);
      throw new BadRequestException(`Failed to install official templates: ${e.message}`);
    }
  }

  async findAll(query?: any) {
    const filter: any = {};
    if (query?.status && query.status !== 'all') {
      filter.status = query.status;
    }
    if (query?.category && query.category !== 'all') {
      filter.category = query.category;
    }
    if (query?.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { displayName: { $regex: query.search, $options: 'i' } },
        { body: { $regex: query.search, $options: 'i' } },
      ];
    }
    return await this.templateModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  async findOne(id: string) {
    const template = await this.templateModel.findById(id).lean();
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(dto: CreateTemplateDto, userId?: string) {
    const existing = await this.templateModel.findOne({ name: dto.name.trim().toLowerCase() });
    if (existing) {
      throw new BadRequestException(`Template with name '${dto.name}' already exists.`);
    }

    // Auto extract variables {{1}}, {{2}} etc. if not provided
    const varMatches = dto.body.match(/\{\{(\d+)\}\}/g) || [];
    const extractedVars = varMatches.map((m) => `Variable ${m.replace(/\D/g, '')}`);

    const template = new this.templateModel({
      ...dto,
      name: dto.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      variables: dto.variables && dto.variables.length > 0 ? dto.variables : extractedVars,
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
    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const wabaId = this.configService.get<string>('META_WABA_ID') || '1850522739692580';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || 'v22.0';

    if (!pageAccessToken || !wabaId) {
      return {
        success: false,
        message: 'Meta credentials (META_PAGE_ACCESS_TOKEN or META_WABA_ID) not configured',
        syncedCount: 0,
      };
    }

    try {
      const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || 'Failed to fetch templates from Meta');
      }

      const metaTemplates: any[] = data.data || [];
      let syncedCount = 0;

      for (const mt of metaTemplates) {
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
              displayName: mt.name.replace(/_/g, ' ').toUpperCase(),
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
