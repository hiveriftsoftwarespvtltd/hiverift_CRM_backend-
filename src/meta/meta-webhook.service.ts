import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Lead, LeadDocument, LeadStatus, LeadSource } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MetaService } from './meta.service';
import { MetaWebhookPayload, MappedMetaLeadData, MetaLeadGraphResponse } from './interfaces/meta.interface';

function sanitizePhone(phoneStr?: string): string {
  if (!phoneStr) return '';
  const digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly metaService: MetaService,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Meta Webhook Verification for GET /api/v1/meta/webhook
   */
  verifyWebhook(mode?: string, verifyToken?: string, challenge?: string): string {
    const configuredToken = this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN');

    if (!mode || !verifyToken) {
      this.logger.warn('Webhook verification failed: Missing mode or verify_token query parameters');
      throw new BadRequestException('Missing hub.mode or hub.verify_token parameters');
    }

    if (mode === 'subscribe' && configuredToken && verifyToken === configuredToken) {
      this.logger.log('✅ Meta Webhook Verification Successful');
      return challenge || '';
    }

    this.logger.warn('Webhook verification failed: Invalid verify token');
    throw new ForbiddenException('Invalid verification token');
  }

  /**
   * Verifies X-Hub-Signature-256 header using HMAC SHA-256 with META_APP_SECRET
   */
  verifySignature(rawBody: Buffer | string | undefined, signatureHeader?: string): boolean {
    const appSecret = this.configService.get<string>('META_APP_SECRET');

    // If app secret is not configured or left as default placeholder, allow in non-production with warning
    if (!appSecret || appSecret.includes('your_meta_app_secret')) {
      this.logger.warn('META_APP_SECRET is not configured. Skipping HMAC signature validation in dev mode.');
      return true;
    }

    if (!signatureHeader) {
      this.logger.error('Signature verification failed: Missing X-Hub-Signature-256 header');
      return false;
    }

    if (!rawBody) {
      this.logger.error('Signature verification failed: Raw request body not available');
      return false;
    }

    try {
      const parts = signatureHeader.split('=');
      if (parts.length !== 2 || parts[0] !== 'sha256') {
        this.logger.error('Signature verification failed: Invalid header format');
        return false;
      }

      const signatureHash = parts[1];
      const hmac = crypto.createHmac('sha256', appSecret);
      const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
      const computedHash = hmac.update(payloadBuffer).digest('hex');

      const isMatch = crypto.timingSafeEqual(
        Buffer.from(signatureHash, 'hex'),
        Buffer.from(computedHash, 'hex'),
      );

      if (!isMatch) {
        this.logger.error('Signature verification failed: HMAC mismatch');
      }

      return isMatch;
    } catch (err: any) {
      this.logger.error(`Signature verification error: ${err.message}`);
      return false;
    }
  }

  /**
   * Processes incoming Meta Webhook Payload
   */
  async handleWebhookPayload(payload: MetaWebhookPayload): Promise<{ success: boolean; processedCount: number }> {
    if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) {
      this.logger.log(`Received non-leadgen or unhandled Meta event object: ${payload?.object || 'unknown'}`);
      return { success: true, processedCount: 0 };
    }

    let processedCount = 0;

    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (change.field !== 'leadgen' || !change.value) continue;

        const { leadgen_id, page_id, form_id, ad_id, adgroup_id, adset_id, campaign_id } = change.value;

        if (!leadgen_id) {
          this.logger.warn('Received leadgen change event without leadgen_id');
          continue;
        }

        this.logger.log(`Processing Meta Lead Event: leadgen_id=${leadgen_id}, page_id=${page_id || 'N/A'}, form_id=${form_id || 'N/A'}`);

        // Async lead processing
        this.processLeadgenId(leadgen_id, {
          page_id,
          form_id,
          ad_id,
          adset_id: adset_id || adgroup_id,
          campaign_id,
        }).catch((err) => {
          this.logger.error(`Error in async lead processing for leadgen_id=${leadgen_id}: ${err.message}`);
        });

        processedCount++;
      }
    }

    return { success: true, processedCount };
  }

  /**
   * Core Idempotency & Lead Processing Pipeline
   */
  async processLeadgenId(leadgenId: string, metaEventData?: Record<string, any>): Promise<LeadDocument | null> {
    // 1. PRIMARY IDEMPOTENCY CHECK: metaLeadId === leadgenId
    const existingMetaLead = await this.leadModel.findOne({ metaLeadId: leadgenId });
    if (existingMetaLead) {
      this.logger.log(`Idempotency Check: Lead already exists for metaLeadId=${leadgenId} (Lead ID: ${existingMetaLead.leadId}). Skipping creation.`);
      return existingMetaLead;
    }

    // 2. Fetch Lead Details from Meta Graph API
    const graphData = await this.metaService.getLeadDetails(leadgenId);

    // 3. Map Fields
    const mapped = this.mapMetaLeadData(leadgenId, graphData, metaEventData);

    const cleanPhone = sanitizePhone(mapped.phone);
    const finalPhone = cleanPhone && cleanPhone.length === 10 ? cleanPhone : (mapped.phone ? String(mapped.phone).slice(-10) : '0000000000');
    const cleanEmail = mapped.email ? String(mapped.email).toLowerCase().trim() : undefined;

    // 4. SECONDARY DUP CHECK by Phone & Email
    const phoneRegex = new RegExp(finalPhone);
    const dupConditions: any[] = [
      { phone: { $regex: phoneRegex } },
      { whatsapp: { $regex: phoneRegex } },
    ];
    if (cleanEmail) {
      dupConditions.push({ email: new RegExp(`^${cleanEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') });
    }

    const existingLeadByContact = await this.leadModel.findOne({ $or: dupConditions });

    if (existingLeadByContact) {
      this.logger.log(`Duplicate Contact Detected: Lead ${existingLeadByContact.leadId} matches phone/email. Enriching with Meta attribution (metaLeadId=${leadgenId}).`);
      
      // Update missing attribution without creating duplicate lead
      existingLeadByContact.metaLeadId = leadgenId;
      if (!existingLeadByContact.platform && mapped.platform) existingLeadByContact.platform = mapped.platform;
      if (!existingLeadByContact.campaignId && mapped.campaignId) existingLeadByContact.campaignId = mapped.campaignId;
      if (!existingLeadByContact.campaignName && mapped.campaignName) existingLeadByContact.campaignName = mapped.campaignName;
      if (!existingLeadByContact.adSetId && mapped.adSetId) existingLeadByContact.adSetId = mapped.adSetId;
      if (!existingLeadByContact.adSetName && mapped.adSetName) existingLeadByContact.adSetName = mapped.adSetName;
      if (!existingLeadByContact.adId && mapped.adId) existingLeadByContact.adId = mapped.adId;
      if (!existingLeadByContact.adName && mapped.adName) existingLeadByContact.adName = mapped.adName;
      if (!existingLeadByContact.formId && mapped.formId) existingLeadByContact.formId = mapped.formId;
      if (!existingLeadByContact.formName && mapped.formName) existingLeadByContact.formName = mapped.formName;
      if (mapped.metaRawData) existingLeadByContact.metaRawData = mapped.metaRawData;

      return await existingLeadByContact.save();
    }

    // 5. CREATE NEW CRM LEAD (Case C)
    const leadId = await this.generateLeadId();

    const newLead = new this.leadModel({
      leadId,
      name: mapped.name || 'Meta Lead',
      phone: finalPhone,
      whatsapp: finalPhone,
      email: cleanEmail,
      company: mapped.company || '',
      city: mapped.city || '',
      requirement: mapped.requirement || `Submitted Meta Lead Form (${mapped.formName || mapped.formId || 'Instant Form'})`,
      source: LeadSource.META,
      status: LeadStatus.NEW,
      metaLeadId: leadgenId,
      platform: mapped.platform || 'META_LEAD_AD',
      campaignId: mapped.campaignId,
      campaignName: mapped.campaignName,
      adSetId: mapped.adSetId,
      adSetName: mapped.adSetName,
      adId: mapped.adId,
      adName: mapped.adName,
      formId: mapped.formId,
      formName: mapped.formName,
      metaRawData: mapped.metaRawData,
      assignedTo: undefined,
      createdBy: undefined,
    });

    const savedLead = await newLead.save();
    this.logger.log(`Created new CRM Lead from Meta Lead Ad: ${savedLead.leadId} (${savedLead.name})`);

    // 6. Notify Admins
    try {
      const admins = await this.userModel.find({ role: { $in: ['admin', 'management', 'superadmin', 'super_admin'] } }, { _id: 1 }).lean();
      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin._id.toString(),
          title: `📣 New Meta Lead: ${savedLead.name}`,
          message: `A new lead came from Meta Ad (${savedLead.campaignName || 'Meta Campaign'}) - Phone: ${finalPhone}`,
          type: 'lead_assigned',
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to send Meta lead notification: ${err.message}`);
    }

    return savedLead;
  }

  /**
   * Helper to parse field_data array from Meta Graph API
   */
  private mapMetaLeadData(
    leadgenId: string,
    graphData: MetaLeadGraphResponse | null,
    metaEventData?: Record<string, any>,
  ): MappedMetaLeadData {
    const result: MappedMetaLeadData = {
      metaLeadId: leadgenId,
      name: 'Meta Lead',
      phone: '0000000000',
      platform: graphData?.platform || 'META_LEAD_AD',
      campaignId: graphData?.campaign_id || metaEventData?.campaign_id || '',
      campaignName: graphData?.campaign_name || '',
      adSetId: graphData?.adset_id || metaEventData?.adset_id || metaEventData?.adgroup_id || '',
      adSetName: graphData?.adset_name || '',
      adId: graphData?.ad_id || metaEventData?.ad_id || '',
      adName: graphData?.ad_name || '',
      formId: graphData?.form_id || metaEventData?.form_id || '',
      formName: graphData?.form_name || '',
      metaRawData: graphData || metaEventData || {},
    };

    if (!graphData || !Array.isArray(graphData.field_data)) {
      return result;
    }

    let fullName = '';
    let firstName = '';
    let lastName = '';
    let requirementNotes: string[] = [];

    for (const field of graphData.field_data) {
      const fieldKey = (field.name || '').toLowerCase();
      const val = field.values && field.values.length > 0 ? field.values[0] : '';

      if (!val) continue;

      if (fieldKey === 'full_name' || fieldKey === 'name') {
        fullName = val;
      } else if (fieldKey === 'first_name') {
        firstName = val;
      } else if (fieldKey === 'last_name') {
        lastName = val;
      } else if (fieldKey === 'phone_number' || fieldKey === 'phone' || fieldKey === 'contact_number' || fieldKey === 'mobile') {
        result.phone = val;
      } else if (fieldKey === 'email' || fieldKey === 'email_address') {
        result.email = val;
      } else if (fieldKey === 'company_name' || fieldKey === 'organization' || fieldKey === 'company') {
        result.company = val;
      } else if (fieldKey === 'city' || fieldKey === 'location') {
        result.city = val;
      } else {
        requirementNotes.push(`${field.name}: ${val}`);
      }
    }

    if (fullName) {
      result.name = fullName;
    } else if (firstName || lastName) {
      result.name = `${firstName} ${lastName}`.trim();
    }

    if (requirementNotes.length > 0) {
      result.requirement = requirementNotes.join(' | ');
    }

    return result;
  }

  /**
   * Helper to generate unique sequential Lead ID (LEAD-XXXX)
   */
  private async generateLeadId(): Promise<string> {
    const leads = await this.leadModel.find({}, { leadId: 1 }).lean();
    let maxNum = 0;
    for (const l of leads) {
      if (l.leadId) {
        const match = l.leadId.match(/LEAD-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.leadModel.findOne({ leadId: `LEAD-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `LEAD-${String(nextNum).padStart(4, '0')}`;
  }
}
