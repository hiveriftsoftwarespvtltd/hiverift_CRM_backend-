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

@Injectable()
export class WhatsappTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    @InjectModel(WhatsappTemplate.name)
    private readonly templateModel: Model<WhatsappTemplateDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultTemplates();
    try {
      this.logger.log('Syncing official Meta Cloud API approved templates on startup...');
      await this.syncMetaTemplates();
    } catch (e: any) {
      this.logger.warn(`Initial Meta template sync warning: ${e?.message || e}`);
    }
  }

  private async seedDefaultTemplates() {
    try {
      const count = await this.templateModel.countDocuments();
      if (count === 0) {
        this.logger.log('Seeding default approved WhatsApp templates...');
        const defaults = [
          {
            name: 'lead_followup_v1',
            displayName: 'Lead Follow-up & Greeting',
            category: TemplateCategory.UTILITY,
            language: 'en',
            headerType: 'NONE',
            body: 'Hello {{1}},\n\nThank you for reaching out to us at HiveRift. We are following up regarding {{2}}.\n\nPlease let us know if you have any questions or when would be a good time to connect.\n\nBest regards,\nHiveRift Team',
            footer: 'HiveRift CRM • Reply STOP to unsubscribe',
            variables: ['Name', 'Service / Requirement'],
            buttons: [
              { type: 'QUICK_REPLY', text: 'I am interested' },
              { type: 'QUICK_REPLY', text: 'Call me later' },
            ],
            status: TemplateStatus.APPROVED,
            isActive: true,
          },
          {
            name: 'promotional_offer_v1',
            displayName: 'Special Festival Offer',
            category: TemplateCategory.MARKETING,
            language: 'en',
            headerType: 'TEXT',
            headerText: 'Exclusive Business Offer',
            body: 'Dear {{1}},\n\nUnlock high-impact digital solutions with HiveRift. We are pleased to offer {{2}} tailored for {{3}}.\n\nConnect with our solution experts today and elevate your operations.\n\nThank you!',
            footer: 'HiveRift Solutions',
            variables: ['Name', 'Offer Details', 'Company Name'],
            buttons: [
              { type: 'URL', text: 'View Offers', value: 'https://hiverift.com' },
            ],
            status: TemplateStatus.APPROVED,
            isActive: true,
          },
          {
            name: 'order_status_update',
            displayName: 'Status & Milestone Update',
            category: TemplateCategory.UTILITY,
            language: 'en',
            headerType: 'NONE',
            body: 'Hi {{1}},\n\nThis is a quick update regarding your project with HiveRift. The latest milestone {{2}} has been successfully completed.\n\nYou can review progress in your client portal or reach out to your manager.\n\nBest regards,\nHiveRift Support',
            footer: 'Powered by HiveRift Desk',
            variables: ['Customer Name', 'Milestone Name'],
            buttons: [],
            status: TemplateStatus.APPROVED,
            isActive: true,
          },
        ];

        await this.templateModel.insertMany(defaults);
        this.logger.log('Default WhatsApp templates seeded successfully.');
      }
    } catch (e: any) {
      this.logger.error(`Error seeding templates: ${e.message}`);
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
