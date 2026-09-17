import { Controller, Get, Post, Delete, Query, Body, Req, Headers, UnauthorizedException, HttpCode, HttpStatus, UseGuards, Res, BadRequestException, Param } from '@nestjs/common';
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

function isImageLink(str?: string): boolean {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  return (
    s.startsWith('data:image/') ||
    /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i.test(s) ||
    (s.startsWith('http') && (s.includes('/images/') || s.includes('/img/') || s.includes('/uploads/')))
  );
}

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
   * GET /api/v1/meta/whatsapp/media/:mediaId
   * Streams WhatsApp media binary from Meta Graph API
   */
  @Get('whatsapp/media/:mediaId')
  @Public()
  async getWhatsAppMedia(@Param('mediaId') mediaId: string, @Res() res: Response) {
    if (!mediaId) {
      return res.status(HttpStatus.BAD_REQUEST).send('Media ID is required');
    }
    const result = await this.metaService.getWhatsAppMedia(mediaId);
    if (!result) {
      const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250">
        <rect width="100%" height="100%" fill="#0B4D3C"/>
        <circle cx="200" cy="100" r="36" fill="#10B981" opacity="0.2"/>
        <path d="M185 85h30v20h-30zM175 115l20-20 15 15 20-20 15 15v20h-70z" fill="#10B981"/>
        <text x="50%" y="165" font-family="sans-serif" font-size="15" font-weight="bold" fill="#FFFFFF" text-anchor="middle">WhatsApp Photo Attachment</text>
        <text x="50%" y="190" font-family="sans-serif" font-size="12" fill="#6EE7B7" text-anchor="middle">Click to View Attachment</text>
      </svg>`;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(HttpStatus.OK).send(placeholderSvg);
    }
    res.setHeader('Content-Type', result.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(HttpStatus.OK).send(result.buffer);
  }

  /**
   * POST /api/v1/meta/whatsapp/send-message
   * CRM Agent Reply Endpoint sending text/media message via Meta WhatsApp Cloud API
   */
  @Post('whatsapp/send-message')
  @UseGuards(JwtAuthGuard)
  async sendWhatsAppMessage(@Req() req: any, @Body() dto: SendWhatsAppMessageDto) {
    const rawMessage = (dto.message || '').trim();
    const mediaUrl = (dto.mediaUrl || '').trim() || (isImageLink(rawMessage) ? rawMessage : '');
    const isImage = !!mediaUrl || dto.mediaType === 'image';

    if (!dto.phone || (!rawMessage && !mediaUrl)) {
      throw new BadRequestException('Phone number and message text or image URL are required');
    }

    const user = req.user;
    const userRole = (user?.role || '').toLowerCase();
    const isAdminOrManagement =
      userRole === 'admin' ||
      userRole === 'management' ||
      userRole === 'superadmin' ||
      userRole === 'super_admin';

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

    // Security role check: Sales users can only send messages to leads assigned to them or created by them
    if (!isAdminOrManagement && targetLead && user) {
      const uId = user._id ? user._id.toString() : user.id;
      const assignedStr = targetLead.assignedTo ? targetLead.assignedTo.toString() : '';
      const createdStr = targetLead.createdBy ? targetLead.createdBy.toString() : '';
      const isOwnerOrAssigned = assignedStr === uId || createdStr === uId;

      if (!isOwnerOrAssigned) {
        throw new UnauthorizedException('You do not have permission to send messages to this lead.');
      }
    }

    // 1. Call Meta WhatsApp Cloud API via MetaService
    let sendResult: { success: boolean; whatsappMessageId?: string; mediaId?: string; error?: string };

    const mediaUrlLower = mediaUrl.toLowerCase();
    const isDoc = dto.mediaType === 'document' || mediaUrlLower.includes('application/pdf') || mediaUrlLower.includes('.pdf') || (dto.fileName && dto.fileName.toLowerCase().endsWith('.pdf'));
    const isMedia = !!mediaUrl || dto.mediaType === 'image' || isDoc;
    const computedMediaType = isDoc ? 'document' : (dto.mediaType || 'image');

    if (isMedia) {
      const captionText = rawMessage && rawMessage !== mediaUrl && !rawMessage.startsWith('[') ? rawMessage : '';
      sendResult = await this.metaService.sendWhatsAppMediaMessage(
        dto.phone,
        mediaUrl,
        captionText,
        computedMediaType,
        dto.fileName,
      );
    } else {
      sendResult = await this.metaService.sendWhatsAppTextMessage(dto.phone, rawMessage);
    }

    const finalMediaUrl = sendResult.mediaId
      ? `/api/v1/meta/whatsapp/media/${sendResult.mediaId}`
      : (mediaUrl && !mediaUrl.startsWith('data:') ? mediaUrl : undefined);

    const chatMsgObj = {
      whatsappMessageId: sendResult.whatsappMessageId,
      direction: 'outgoing',
      senderType: 'agent',
      message: (rawMessage && !rawMessage.startsWith('[')) ? rawMessage : (isDoc ? `[📄 ${dto.fileName || 'Document.pdf'}]` : '[📷 Image]'),
      mediaUrl: finalMediaUrl,
      mediaType: isMedia ? computedMediaType : undefined,
      mediaId: sendResult.mediaId || undefined,
      fileName: dto.fileName || undefined,
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
   * Fetch WhatsApp leads & conversation threads for the CRM WhatsApp Inbox.
   * - Super Admin / Admin / Management see ALL lead conversations.
   * - Sales Executives see ONLY their assigned or created leads.
   */
  @Get('whatsapp/conversations')
  @UseGuards(JwtAuthGuard)
  async getWhatsAppConversations(@Req() req: any) {
    const user = req.user;
    const userRole = (user?.role || '').toLowerCase().trim();
    const isAdminOrManagement =
      userRole === 'admin' ||
      userRole === 'management' ||
      userRole === 'superadmin' ||
      userRole === 'super_admin';

    const conditions: any[] = [
      { name: { $nin: ['-', '--', '', 'null', 'undefined'], $exists: true } },
      {
        $or: [
          { phone: { $exists: true, $ne: '', $nin: ['0000000000', '0'] } },
          { whatsapp: { $exists: true, $ne: '', $nin: ['0000000000', '0'] } },
        ],
      },
    ];

    // Role-based Access Control:
    // Admin, Super Admin, Management see ALL conversations.
    // Sales users / Executives see ONLY leads assigned to them or created by them.
    if (!isAdminOrManagement && user) {
      const uId = user._id ? user._id.toString() : (user.id ? user.id.toString() : '');
      const userObjId = Types.ObjectId.isValid(uId) ? new Types.ObjectId(uId) : null;

      const userOwnershipConds: any[] = [];
      if (userObjId) {
        userOwnershipConds.push({ assignedTo: userObjId });
        userOwnershipConds.push({ createdBy: userObjId });
      }
      if (uId) {
        userOwnershipConds.push({ assignedTo: uId });
        userOwnershipConds.push({ createdBy: uId });
      }

      if (userOwnershipConds.length > 0) {
        conditions.push({ $or: userOwnershipConds });
      }
    }

    const filter = { $and: conditions };

    const leads = await this.leadModel
      .find(filter)
      .populate('assignedTo', 'name email role phone')
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

  /**
   * DELETE /api/v1/meta/whatsapp/messages/:leadId/:messageId
   * Delete a single message from lead's conversation history
   */
  @Delete('whatsapp/messages/:leadId/:messageId')
  @UseGuards(JwtAuthGuard)
  async deleteWhatsAppMessage(
    @Param('leadId') leadId: string,
    @Param('messageId') messageId: string,
    @Req() req: any,
  ) {
    if (!leadId || !messageId) {
      throw new BadRequestException('Lead ID and Message ID are required');
    }

    const searchConds: any[] = [{ leadId }];
    if (Types.ObjectId.isValid(leadId)) {
      searchConds.push({ _id: leadId });
    }

    const lead = await this.leadModel.findOne({ $or: searchConds });
    if (!lead) {
      throw new BadRequestException('Lead not found');
    }

    if (!lead.messages || lead.messages.length === 0) {
      return { success: true, message: 'No messages to delete' };
    }

    const originalCount = lead.messages.length;
    lead.messages = lead.messages.filter((m: any) => {
      const mId = m._id ? m._id.toString() : '';
      const wamid = m.whatsappMessageId || '';
      return mId !== messageId && wamid !== messageId;
    });

    await lead.save();

    return {
      success: true,
      message: 'Message deleted successfully',
      deletedCount: originalCount - lead.messages.length,
    };
  }

  /**
   * DELETE /api/v1/meta/whatsapp/conversations/:leadId/clear
   * Clear all messages (bulk delete chat) for a lead
   */
  @Delete('whatsapp/conversations/:leadId/clear')
  @UseGuards(JwtAuthGuard)
  async clearWhatsAppConversation(
    @Param('leadId') leadId: string,
    @Req() req: any,
  ) {
    if (!leadId) {
      throw new BadRequestException('Lead ID is required');
    }

    const searchConds: any[] = [{ leadId }];
    if (Types.ObjectId.isValid(leadId)) {
      searchConds.push({ _id: leadId });
    }

    const lead = await this.leadModel.findOne({ $or: searchConds });
    if (!lead) {
      throw new BadRequestException('Lead not found');
    }

    const clearedCount = lead.messages ? lead.messages.length : 0;
    lead.messages = [];
    await lead.save();

    return {
      success: true,
      message: 'Conversation cleared successfully',
      clearedCount,
    };
  }
}
