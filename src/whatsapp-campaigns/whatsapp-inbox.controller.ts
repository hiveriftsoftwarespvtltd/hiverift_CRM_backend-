import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WhatsappInboxService } from './services/whatsapp-inbox.service';

@Controller('whatsapp-campaigns/inbox')
@UseGuards(JwtAuthGuard)
export class WhatsappInboxController {
  constructor(private readonly whatsappInboxService: WhatsappInboxService) {}

  /**
   * GET /api/v1/whatsapp-campaigns/inbox/conversations
   * Fetch conversation list with filters, search, sorting & role-based scoping
   */
  @Get('conversations')
  async getConversations(
    @Req() req: any,
    @Query('filter') filter?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const user = req.user;
    const res = await this.whatsappInboxService.getConversations(user, {
      filter,
      search,
      sort,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
      employeeId,
    });
    return {
      success: true,
      data: res,
    };
  }

  /**
   * GET /api/v1/whatsapp-campaigns/inbox/conversations/:id/messages
   * Fetch conversation messages, auto-mark as read, compute 24h window
   */
  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Param('id') conversationId: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const user = req.user;
    const res = await this.whatsappInboxService.getConversationMessages(conversationId, user, {
      limit: limit ? parseInt(limit, 10) : 60,
      before,
    });
    return {
      success: true,
      data: res,
    };
  }

  /**
   * POST /api/v1/whatsapp-campaigns/inbox/conversations/:id/messages
   * Send a reply message (text, media, or approved template)
   * Strictly enforces WhatsApp 24-hour customer window!
   */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('id') conversationId: string,
    @Req() req: any,
    @Body()
    body: {
      text?: string;
      mediaUrl?: string;
      mediaType?: string;
      fileName?: string;
      templateName?: string;
      parameters?: string[];
      renderedMessage?: string;
    },
  ) {
    const user = req.user;
    const message = await this.whatsappInboxService.sendMessage(conversationId, user, body);
    return {
      success: true,
      message: 'WhatsApp reply dispatched successfully',
      data: message,
    };
  }

  /**
   * POST /api/v1/whatsapp-campaigns/inbox/conversations/:id/assign
   * Reassign conversation to an employee (Sales Head / Admin only)
   */
  @Post('conversations/:id/assign')
  @HttpCode(HttpStatus.OK)
  async assignConversation(
    @Param('id') conversationId: string,
    @Req() req: any,
    @Body('employeeId') employeeId: string,
  ) {
    const user = req.user;
    if (!employeeId) {
      throw new BadRequestException('employeeId is required');
    }
    const res = await this.whatsappInboxService.assignConversation(conversationId, user, employeeId);
    return res;
  }

  /**
   * GET /api/v1/whatsapp-campaigns/inbox/stats
   * Fetch summary stats (total, unread, active 24h window)
   */
  @Get('stats')
  async getInboxStats(@Req() req: any) {
    const user = req.user;
    const stats = await this.whatsappInboxService.getInboxStats(user);
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * POST /api/v1/whatsapp-campaigns/inbox/conversations/:id/mark-read
   */
  @Post('conversations/:id/mark-read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Param('id') conversationId: string, @Req() req: any) {
    const user = req.user;
    await this.whatsappInboxService.markAsRead(conversationId, user);
    return {
      success: true,
      message: 'Marked as read',
    };
  }

  /**
   * POST /api/v1/whatsapp-campaigns/inbox/init-conversation
   * Initialize or fetch existing WhatsApp conversation for a CRM Lead or Imported Lead
   */
  @Post('init-conversation')
  @HttpCode(HttpStatus.OK)
  async initConversation(
    @Req() req: any,
    @Body()
    dto: {
      leadId?: string;
      crmLeadId?: string;
      importedLeadId?: string;
      phone?: string;
      name?: string;
    },
  ) {
    const user = req.user;
    const conversation = await this.whatsappInboxService.initConversation(user, dto);
    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * GET /api/v1/whatsapp-campaigns/inbox/search-leads
   * Search CRM Leads & Imported Leads to initiate new chats
   */
  @Get('search-leads')
  async searchLeads(@Req() req: any, @Query('q') q: string) {
    const user = req.user;
    const res = await this.whatsappInboxService.searchLeads(user, q);
    return {
      success: true,
      data: res,
    };
  }

  /**
   * POST /api/v1/whatsapp-campaigns/inbox/conversations/:id/notes
   * Add an internal CRM note to a WhatsApp conversation
   */
  @Post('conversations/:id/notes')
  @HttpCode(HttpStatus.OK)
  async addInternalNote(
    @Param('id') conversationId: string,
    @Req() req: any,
    @Body('text') text: string,
  ) {
    const data = await this.whatsappInboxService.addInternalNote(conversationId, req.user, text);
    return {
      success: true,
      data,
    };
  }
}
