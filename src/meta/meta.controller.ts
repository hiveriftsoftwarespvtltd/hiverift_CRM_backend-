import { Controller, Get, Post, Query, Body, Req, Headers, UnauthorizedException, HttpCode, HttpStatus, UseGuards, Res, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaService } from './meta.service';
import { MetaVerificationDto, TestMetaIngestDto, SendWhatsAppMessageDto } from './dto/meta-webhook.dto';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('meta')
export class MetaController {
  constructor(
    private readonly metaWebhookService: MetaWebhookService,
    private readonly metaService: MetaService,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  /**
   * GET /api/v1/meta/webhook
   * Meta Webhook Verification Endpoint used during Meta App Setup.
   * Uses Express @Res() to bypass global TransformInterceptor and return raw text/plain challenge.
   */
  @Get('webhook')
  @Public()
  verifyWebhook(@Query() query: MetaVerificationDto, @Res() res: Response): void {
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    try {
      const challengeStr = this.metaWebhookService.verifyWebhook(mode, verifyToken, challenge);
      res.setHeader('Content-Type', 'text/plain');
      res.status(HttpStatus.OK).send(challengeStr);
    } catch (err: any) {
      const status = err.getStatus ? err.getStatus() : HttpStatus.FORBIDDEN;
      res.setHeader('Content-Type', 'text/plain');
      res.status(status).send(err.message || 'Forbidden');
    }
  }

  /**
   * POST /api/v1/meta/webhook
   * Meta Webhook Ingestion Endpoint for Lead Ads & WhatsApp Events
   */
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    // 1. Verify HMAC Signature
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const isValidSignature = this.metaWebhookService.verifySignature(rawBody, signature);

    if (!isValidSignature) {
      throw new UnauthorizedException('Invalid Meta Webhook Signature (X-Hub-Signature-256 mismatch)');
    }

    // 2. Process Webhook Payload (fast response to Meta)
    await this.metaWebhookService.handleWebhookPayload(body);

    // 3. Return HTTP 200 { success: true } quickly
    return { success: true };
  }

  /**
   * POST /api/v1/meta/whatsapp/send-message
   * CRM Agent Reply Endpoint sending message via Meta WhatsApp Cloud API
   */
  @Post('whatsapp/send-message')
  @UseGuards(JwtAuthGuard)
  async sendWhatsAppMessage(@Body() dto: SendWhatsAppMessageDto) {
    if (!dto.phone || !dto.message) {
      throw new BadRequestException('Phone number and message text are required');
    }

    // 1. Call Meta WhatsApp Cloud API via MetaService
    const sendResult = await this.metaService.sendWhatsAppTextMessage(dto.phone, dto.message);

    const targetLeadId = dto.leadId || dto.conversation_id;
    let targetLead: LeadDocument | null = null;

    if (targetLeadId) {
      const searchConds: any[] = [{ leadId: targetLeadId }];
      if (Types.ObjectId.isValid(targetLeadId)) {
        searchConds.push({ _id: targetLeadId });
      }
      targetLead = await this.leadModel.findOne({ $or: searchConds });
    }

    if (!targetLead && dto.phone) {
      const cleanPhone = dto.phone.replace(/\D/g, '').slice(-10);
      targetLead = await this.leadModel.findOne({
        $or: [
          { phone: new RegExp(cleanPhone) },
          { whatsapp: new RegExp(cleanPhone) },
        ],
      });
    }

    const chatMsgObj = {
      whatsappMessageId: sendResult.whatsappMessageId,
      direction: 'outgoing',
      senderType: 'agent',
      message: dto.message,
      phone: dto.phone,
      status: sendResult.success ? 'sent' : 'failed',
      createdAt: new Date(),
    };

    if (targetLead) {
      if (!targetLead.messages) targetLead.messages = [];
      targetLead.messages.push(chatMsgObj as any);
      await targetLead.save();
    }

    if (!sendResult.success) {
      return {
        success: false,
        message: sendResult.error || 'Failed to send WhatsApp message',
        data: chatMsgObj,
      };
    }

    return {
      success: true,
      message: 'WhatsApp message sent successfully',
      data: chatMsgObj,
    };
  }

  /**
   * GET /api/v1/meta/whatsapp/conversations
   * Fetch all WhatsApp leads & conversation threads for the CRM WhatsApp Inbox
   */
  @Get('whatsapp/conversations')
  @UseGuards(JwtAuthGuard)
  async getWhatsAppConversations() {
    const leads = await this.leadModel
      .find({
        name: { $nin: ['-', '--', '', 'null', 'undefined'], $exists: true },
        $or: [
          { phone: { $exists: true, $ne: '', $nin: ['0000000000', '0'] } },
          { whatsapp: { $exists: true, $ne: '', $nin: ['0000000000', '0'] } },
        ],
      })
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean()
      .exec();

    // Sanitize lead names (remove leading ~ or - or special symbols from WhatsApp profile names)
    const sanitizedLeads = leads.map((lead: any) => {
      let cleanName = (lead.name || '').replace(/^[~\s\-_]+/, '').trim();
      if (!cleanName || cleanName === '-' || cleanName === '--' || cleanName === 'null') {
        const ph = lead.whatsapp || lead.phone;
        cleanName = ph ? `Lead (${ph})` : lead.leadId || 'Lead';
      }
      return {
        ...lead,
        name: cleanName,
        rawName: lead.name,
      };
    });

    return {
      success: true,
      data: sanitizedLeads,
    };
  }

  /**
   * POST /api/v1/meta/test-ingest
   * Admin-protected endpoint for testing leadgen_id processing manually
   */
  @Post('test-ingest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'management', 'superadmin')
  async testIngest(@Body() dto: TestMetaIngestDto) {
    const lead = await this.metaWebhookService.processLeadgenId(dto.leadgen_id, {
      page_id: dto.page_id,
      form_id: dto.form_id,
      ad_id: dto.ad_id,
      campaign_id: dto.campaign_id,
    });

    return {
      success: true,
      message: lead ? `Lead processed successfully (Lead ID: ${lead.leadId})` : 'Lead processing completed with null output',
      data: lead,
    };
  }
}
