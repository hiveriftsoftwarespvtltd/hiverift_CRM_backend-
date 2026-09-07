import { Controller, Get, Post, Query, Body, Req, Headers, UnauthorizedException, HttpCode, HttpStatus, UseGuards, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaVerificationDto, TestMetaIngestDto } from './dto/meta-webhook.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('meta')
export class MetaController {
  constructor(private readonly metaWebhookService: MetaWebhookService) {}

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
   * Meta Webhook Ingestion Endpoint for Lead Ads Events
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
