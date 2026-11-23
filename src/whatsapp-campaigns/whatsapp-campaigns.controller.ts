import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Res,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

import { WhatsappLeadsService } from './services/whatsapp-leads.service';
import { WhatsappTemplatesService } from './services/whatsapp-templates.service';
import { WhatsappCampaignsService } from './services/whatsapp-campaigns.service';
import { WhatsappSettingsService } from './services/whatsapp-settings.service';
import { CreateImportedLeadDto, UpdateImportedLeadDto } from './dto/imported-lead.dto';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { CreateCampaignDto } from './dto/campaign.dto';

@Controller('whatsapp-campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsappCampaignsController {
  constructor(
    private readonly leadsService: WhatsappLeadsService,
    private readonly templatesService: WhatsappTemplatesService,
    private readonly campaignsService: WhatsappCampaignsService,
    private readonly settingsService: WhatsappSettingsService,
  ) {}

  // ==========================================
  // DASHBOARD
  // ==========================================
  @Get('dashboard-stats')
  @Roles('super_admin', 'superadmin', 'admin')
  async getDashboardStats() {
    const data = await this.campaignsService.getDashboardStats();
    return { success: true, data };
  }

  // ==========================================
  // CRM LEADS (READ-ONLY REFERENCE)
  // ==========================================
  @Get('crm-leads')
  @Roles('super_admin', 'superadmin', 'admin')
  async getCrmLeads(@Query() query: any, @CurrentUser() user: any) {
    const data = await this.leadsService.getCrmLeads(query, user);
    return { success: true, data };
  }

  // ==========================================
  // IMPORTED LEADS (SEPARATE DATABASE)
  // ==========================================
  @Get('imported-leads')
  @Roles('super_admin', 'superadmin', 'admin')
  async getImportedLeads(@Query() query: any) {
    const data = await this.leadsService.getImportedLeads(query);
    return { success: true, data };
  }

  @Post('imported-leads')
  @Roles('super_admin', 'superadmin', 'admin')
  async createImportedLead(@Body() dto: CreateImportedLeadDto, @CurrentUser() user: any) {
    const data = await this.leadsService.createImportedLead(dto, user?._id?.toString());
    return { success: true, message: 'Lead added to WhatsApp imported leads', data };
  }

  @Put('imported-leads/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async updateImportedLead(@Param('id') id: string, @Body() dto: UpdateImportedLeadDto) {
    const data = await this.leadsService.updateImportedLead(id, dto);
    return { success: true, message: 'Lead updated', data };
  }

  @Delete('imported-leads/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async deleteImportedLead(@Param('id') id: string) {
    return await this.leadsService.deleteImportedLead(id);
  }

  @Post('imported-leads/bulk-delete')
  @Roles('super_admin', 'superadmin', 'admin')
  async bulkDeleteImportedLeads(@Body() body: { ids: string[] }) {
    return await this.leadsService.bulkDeleteImportedLeads(body.ids || []);
  }

  @Get('imported-leads/export')
  @Roles('super_admin', 'superadmin', 'admin')
  async exportImportedLeads(@Res() res: Response, @Query('ids') idsStr?: string) {
    const ids = idsStr ? idsStr.split(',').filter(Boolean) : undefined;
    const csvData = await this.leadsService.exportImportedLeadsCsv(ids);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=whatsapp_imported_leads_${Date.now()}.csv`);
    return res.send(csvData);
  }

  // ==========================================
  // FILE IMPORT & PARSING (CSV, XLSX, PDF, TXT, DOCX)
  // ==========================================
  @Post('parse-file')
  @Roles('super_admin', 'superadmin', 'admin')
  @UseInterceptors(FileInterceptor('file'))
  async parseFile(@UploadedFile() file: Express.Multer.File) {
    const data = await this.leadsService.parseFileForPreview(file);
    return { success: true, data };
  }

  @Post('import')
  @Roles('super_admin', 'superadmin', 'admin')
  async executeImport(@Body() body: any, @CurrentUser() user: any) {
    const data = await this.leadsService.executeImport(body, user);
    return { success: true, data };
  }

  @Get('import-batches')
  @Roles('super_admin', 'superadmin', 'admin')
  async getImportBatches(@Query() query: any) {
    const data = await this.leadsService.getImportBatches(query);
    return { success: true, data };
  }

  // ==========================================
  // TEMPLATES MANAGEMENT
  // ==========================================
  @Get('templates')
  @Roles('super_admin', 'superadmin', 'admin')
  async getTemplates(@Query() query: any) {
    const data = await this.templatesService.findAll(query);
    return { success: true, data };
  }

  @Get('templates/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async getTemplate(@Param('id') id: string) {
    const data = await this.templatesService.findOne(id);
    return { success: true, data };
  }

  @Post('templates')
  @Roles('super_admin', 'superadmin', 'admin')
  async createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: any) {
    const data = await this.templatesService.create(dto, user?._id?.toString());
    return { success: true, message: 'Template created successfully', data };
  }

  @Put('templates/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    const data = await this.templatesService.update(id, dto);
    return { success: true, message: 'Template updated', data };
  }

  @Delete('templates/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async deleteTemplate(@Param('id') id: string) {
    return await this.templatesService.delete(id);
  }

  @Post('templates/sync')
  @Roles('super_admin', 'superadmin', 'admin')
  async syncMetaTemplates() {
    const data = await this.templatesService.syncMetaTemplates();
    return { success: true, data };
  }

  // ==========================================
  // CAMPAIGNS
  // ==========================================
  @Get('campaigns')
  @Roles('super_admin', 'superadmin', 'admin')
  async getCampaigns(@Query() query: any) {
    const data = await this.campaignsService.findAllCampaigns(query);
    return { success: true, data };
  }

  @Post('campaigns')
  @Roles('super_admin', 'superadmin', 'admin')
  async createCampaign(@Body() dto: CreateCampaignDto, @CurrentUser() user: any) {
    const data = await this.campaignsService.createCampaign(dto, user);
    return { success: true, message: 'Campaign created successfully', data };
  }

  @Get('campaigns/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async getCampaign(@Param('id') id: string) {
    const data = await this.campaignsService.findOneCampaign(id);
    return { success: true, data };
  }

  @Post('campaigns/:id/pause')
  @Roles('super_admin', 'superadmin', 'admin')
  async pauseCampaign(@Param('id') id: string) {
    return await this.campaignsService.pauseCampaign(id);
  }

  @Post('campaigns/:id/resume')
  @Roles('super_admin', 'superadmin', 'admin')
  async resumeCampaign(@Param('id') id: string) {
    return await this.campaignsService.resumeCampaign(id);
  }

  @Post('campaigns/:id/stop')
  @Roles('super_admin', 'superadmin', 'admin')
  async stopCampaign(@Param('id') id: string) {
    return await this.campaignsService.stopCampaign(id);
  }

  @Delete('campaigns/:id')
  @Roles('super_admin', 'superadmin', 'admin')
  async deleteCampaign(@Param('id') id: string) {
    return await this.campaignsService.deleteCampaign(id);
  }

  @Get('campaigns/:id/live')
  @Roles('super_admin', 'superadmin', 'admin')
  async getCampaignLiveProgress(@Param('id') id: string) {
    const data = await this.campaignsService.getLiveProgress(id);
    return { success: true, data };
  }

  @Get('campaigns/:id/reports')
  @Roles('super_admin', 'superadmin', 'admin')
  async getCampaignReport(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query() query?: any,
  ) {
    const data = await this.campaignsService.getReportRecipients(id, status, query);
    return { success: true, data };
  }

  @Get('campaigns/:id/reports/export')
  @Roles('super_admin', 'superadmin', 'admin')
  async exportCampaignReport(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('status') status?: string,
  ) {
    const csvData = await this.campaignsService.exportReportCsv(id, status);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=campaign_report_${id}_${Date.now()}.csv`);
    return res.send(csvData);
  }

  // ==========================================
  // SETTINGS
  // ==========================================
  @Get('settings')
  @Roles('super_admin', 'superadmin', 'admin')
  async getSettings() {
    const data = await this.settingsService.getSettings();
    return { success: true, data };
  }

  @Put('settings')
  @Roles('super_admin', 'superadmin', 'admin')
  async updateSettings(@Body() body: any, @CurrentUser() user: any) {
    const data = await this.settingsService.updateSettings(body, user?._id?.toString());
    return { success: true, message: 'WhatsApp settings updated', data };
  }

  @Post('settings/test')
  @Roles('super_admin', 'superadmin', 'admin')
  async testConnection() {
    const data = await this.settingsService.testConnection();
    return data;
  }

  // ==========================================
  // WEBHOOK (PUBLIC - META CLOUD API CALLBACKS)
  // ==========================================
  @Get('webhook')
  @Public()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const configuredToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'hivecrm_webhook_2026_secure';
    if (mode === 'subscribe' && token === configuredToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification token mismatch');
  }

  @Post('webhook')
  @Public()
  async handleWebhook(@Body() payload: any, @Res() res: Response) {
    res.status(200).send('EVENT_RECEIVED'); // Immediate 200 ack to Meta

    try {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages' && change.value) {
            const statuses = change.value.statuses || [];
            for (const st of statuses) {
              const wamid = st.id;
              const status = st.status; // sent, delivered, read, failed
              const timestamp = st.timestamp;
              const errors = st.errors;
              if (wamid && status) {
                await this.campaignsService.handleWebhookStatus(wamid, status, timestamp, errors);
              }
            }
          }
        }
      }
    } catch (e: any) {
      // Background error handled silently
    }
  }
}
