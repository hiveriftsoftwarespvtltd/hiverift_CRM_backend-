import { Injectable, Logger, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Lead, LeadDocument, LeadStatus, LeadSource } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadRoundRobinService, RoundRobinAssignee } from '../leads/lead-round-robin.service';
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
    @Optional() private readonly leadRoundRobinService?: LeadRoundRobinService,
  ) {}

  private async resolveAutoAssignee(): Promise<RoundRobinAssignee | null> {
    if (!this.leadRoundRobinService) return null;
    return this.leadRoundRobinService.getNextAssignee();
  }

  private async notifyLeadCreation(
    savedLead: LeadDocument,
    assignee: RoundRobinAssignee | null,
    title: string,
    adminMessage: string,
    assigneeMessage: string,
  ): Promise<void> {
    try {
      if (assignee) {
        await this.notificationsService.create({
          userId: assignee._id.toString(),
          title,
          message: assigneeMessage,
          type: 'lead_assigned',
        });
      }

      const admins = await this.userModel
        .find({ role: { $in: ['admin', 'management', 'superadmin', 'super_admin'] } }, { _id: 1 })
        .lean();
      const assigneeIdStr = assignee ? assignee._id.toString() : '';

      for (const admin of admins) {
        if (admin._id.toString() === assigneeIdStr) continue;
        await this.notificationsService.create({
          userId: admin._id.toString(),
          title,
          message: adminMessage,
          type: 'lead_assigned',
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to send lead notification: ${err.message}`);
    }
  }

  /**
   * Meta Webhook Verification for GET /api/v1/meta/webhook
   */
  verifyWebhook(mode?: string, verifyToken?: string, challenge?: string): string {
    const configuredToken = this.configService.get<string>('META_VERIFY_TOKEN') || this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN');

    if (!mode || !verifyToken) {
      this.logger.warn('Webhook verification failed: Missing mode or verify_token query parameters');
      throw new ForbiddenException('Missing hub.mode or hub.verify_token parameters');
    }

    if (mode === 'subscribe' && configuredToken && verifyToken === configuredToken) {
      this.logger.log('✅ Meta Webhook Verification Successful');
      return challenge || '';
    }

    this.logger.warn(`Webhook verification failed: Invalid verify token or mode (received mode=${mode})`);
    throw new ForbiddenException('Invalid verification token');
  }

  /**
   * Verifies X-Hub-Signature-256 header using HMAC SHA-256 with META_APP_SECRET
   */
  verifySignature(rawBody: Buffer | string | undefined, signatureHeader?: string): boolean {
    const appSecret = this.configService.get<string>('META_APP_SECRET');

    // If app secret is not configured or left as default placeholder, allow with warning (e.g. dev mode)
    if (!appSecret || appSecret.includes('your_meta_app_secret')) {
      this.logger.warn('META_APP_SECRET is not configured. Skipping HMAC signature validation.');
      return true;
    }

    if (!signatureHeader) {
      this.logger.warn('Signature verification failed: Missing X-Hub-Signature-256 header.');
      return false;
    }

    if (!rawBody) {
      this.logger.warn('Signature verification failed: Raw request body not available.');
      return false;
    }

    try {
      const parts = signatureHeader.split('=');
      if (parts.length !== 2 || parts[0] !== 'sha256') {
        this.logger.warn('Signature verification failed: Invalid header format, expected sha256=<hash>.');
        return false;
      }

      const signatureHash = parts[1];
      const hmac = crypto.createHmac('sha256', appSecret);
      const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
      const computedHash = hmac.update(payloadBuffer).digest('hex');

      if (signatureHash.length !== computedHash.length) {
        this.logger.warn('Signature verification failed: Hash length mismatch.');
        return false;
      }

      const isMatch = crypto.timingSafeEqual(
        Buffer.from(signatureHash, 'hex'),
        Buffer.from(computedHash, 'hex'),
      );

      if (!isMatch) {
        this.logger.warn('Signature verification failed: HMAC SHA-256 mismatch.');
        return false;
      }

      this.logger.log('✅ Meta Webhook HMAC Signature Verified successfully');
      return true;
    } catch (err: any) {
      this.logger.error(`Signature verification error: ${err.message}`);
      return false;
    }
  }

  /**
  /**
   * Processes incoming Meta Webhook Payload (Supports both Instant Form Ads & Click-to-WhatsApp Ads)
   */
  async handleWebhookPayload(payload: MetaWebhookPayload): Promise<{ success: boolean; processedCount: number }> {
    // 0. Support Direct Test Sample Payload (from Meta Developer Test Modal)
    if (payload && ((payload as any).sample?.field === 'leadgen' || (payload as any).field === 'leadgen')) {
      const val = (payload as any).sample?.value || (payload as any).value || {};
      const leadgenId = val.leadgen_id || val.lead_id;
      if (leadgenId) {
        this.logger.log(`Processing Meta Test Lead Sample: leadgen_id=${leadgenId}`);
        await this.processLeadgenId(leadgenId, val).catch(err => {
          this.logger.warn(`Test lead sample warning: ${err.message}`);
        });
        return { success: true, processedCount: 1 };
      }
    }

    if (!payload || !Array.isArray(payload.entry)) {
      this.logger.log(`Received empty or unhandled Meta event object: ${payload?.object || 'unknown'}`);
      return { success: true, processedCount: 0 };
    }

    let processedCount = 0;

    // 1. Handle Meta Instant Form Lead Ads (object === 'page')
    if (payload.object === 'page') {
      for (const entry of payload.entry) {
        if (!Array.isArray(entry.changes)) continue;

        for (const change of entry.changes) {
          if (change.field !== 'leadgen' || !change.value) continue;

          const { leadgen_id, page_id, form_id, ad_id, adgroup_id, adset_id, campaign_id } = change.value;

          if (!leadgen_id) {
            this.logger.warn('Received leadgen change event without leadgen_id');
            continue;
          }

          this.logger.log(`Processing Meta Instant Form Lead Event: leadgen_id=${leadgen_id}, page_id=${page_id || 'N/A'}, form_id=${form_id || 'N/A'}`);

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
    }

    // 2. Handle Click-to-WhatsApp Ads & WhatsApp Business Account Messages (object === 'whatsapp_business_account')
    // 2. Handle Click-to-WhatsApp Ads & WhatsApp Business Account Messages
    for (const entry of payload.entry || []) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (change.field === 'messages' && change.value) {
          const val = change.value;
          const contacts = Array.isArray(val.contacts) ? val.contacts : [];
          const messages = Array.isArray(val.messages) ? val.messages : [];
          const statuses = Array.isArray(val.statuses) ? val.statuses : [];

          // Process Status Callbacks (delivered, read, failed)
          for (const st of statuses) {
            const wamid = st.id;
            const statusName = st.status;
            if (wamid && statusName) {
              await this.leadModel.updateOne(
                { 'messages.whatsappMessageId': wamid },
                { $set: { 'messages.$.status': statusName } },
              );
            }
          }

          // Process Incoming Messages
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const contact = contacts.find((ct: any) => ct.wa_id === msg.from) || contacts[i] || contacts[0] || {};

            this.processWhatsAppMessage(contact, msg).catch((err) => {
              this.logger.error(`Error processing WhatsApp Lead message: ${err.message}`);
            });

            processedCount++;
          }
        }
      }
    }

    return { success: true, processedCount };
  }

  /**
   * Processes incoming WhatsApp Business / Click-to-WhatsApp Ad Message Event
   */
  async processWhatsAppMessage(contact: any, message: any): Promise<LeadDocument | null> {
    const rawFrom = message?.from || contact?.wa_id || '';
    const cleanPhone = sanitizePhone(rawFrom);
    const finalPhone = cleanPhone && cleanPhone.length === 10 ? cleanPhone : (rawFrom ? String(rawFrom).slice(-10) : '');

    if (!finalPhone || finalPhone === '0000000000') {
      this.logger.warn('WhatsApp lead event received without valid phone number');
      return null;
    }

    const rawProfileName = contact?.profile?.name || '';
    const cleanProfileName = rawProfileName.replace(/^[~\s\-_]+/, '').trim();
    const customerName = cleanProfileName || 'WhatsApp Lead';

    const msgType = (message?.type || '').toLowerCase();
    const isImage = msgType === 'image' || !!message?.image;
    const isDoc = msgType === 'document' || !!message?.document;
    const isVideo = msgType === 'video' || !!message?.video;
    const isAudio = msgType === 'audio' || !!message?.audio;
    const isSticker = msgType === 'sticker' || !!message?.sticker;

    const mediaObj = message?.image || message?.document || message?.video || message?.audio || message?.sticker || (msgType ? message?.[msgType] : null);
    const wamid = message?.id;

    let mediaId = '';
    if (typeof mediaObj === 'string') {
      mediaId = mediaObj;
    } else if (mediaObj && typeof mediaObj === 'object') {
      mediaId = mediaObj.id || mediaObj.media_id || mediaObj.file_id || '';
    }
    if (!mediaId && (isImage || isDoc || isVideo || isAudio || isSticker)) {
      mediaId = wamid || `media_${Date.now()}`;
    }

    const mediaType = msgType || (isImage ? 'image' : isDoc ? 'document' : 'text');
    const fileName = (typeof mediaObj === 'object' ? mediaObj?.filename : undefined) || (isDoc ? 'Document.pdf' : undefined);
    const caption = (typeof mediaObj === 'object' ? mediaObj?.caption : undefined) || message?.caption || message?.text?.body || '';

    let msgText =
      message?.text?.body ||
      caption ||
      message?.button?.text ||
      message?.interactive?.button_reply?.title ||
      message?.interactive?.list_reply?.title ||
      '';

    if (!msgText || msgText === 'New Message' || msgText === '[IMAGE]') {
      if (isImage) msgText = '[📷 Image]';
      else if (isDoc) msgText = `[📄 ${fileName || 'Document'}]`;
      else if (msgType) msgText = `[${msgType.toUpperCase()}]`;
      else msgText = 'New Message';
    }

    const mediaUrl = mediaId ? `/api/v1/meta/whatsapp/media/${mediaId}` : undefined;

    // Async pre-fetch incoming media in background so disk cache is populated immediately
    if (mediaId && !mediaId.startsWith('wamid.')) {
      this.metaService.getWhatsAppMedia(mediaId).catch((err) => {
        this.logger.warn(`Background media pre-fetch warning for mediaId ${mediaId}: ${err?.message}`);
      });
    }

    const referral = message?.referral || {};
    const adHeadline = referral.headline || referral.body || '';

    const requirementText = `WhatsApp Inquiry: "${msgText}"${adHeadline ? ` | Ad: ${adHeadline}` : ''}`;

    const chatMsgObj = {
      whatsappMessageId: wamid,
      direction: 'incoming',
      senderType: 'customer',
      message: msgText,
      mediaUrl,
      mediaType,
      mediaId: mediaId || undefined,
      fileName: fileName || undefined,
      phone: finalPhone,
      status: 'sent',
      createdAt: new Date(),
    };

    // Check existing lead by phone/whatsapp
    const phoneRegex = new RegExp(finalPhone);
    const existing = await this.leadModel.findOne({
      $or: [{ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } }]
    });

    if (existing) {
      this.logger.log(`Existing lead ${existing.leadId} sent a new WhatsApp message.`);
      existing.requirement = `${existing.requirement ? existing.requirement + ' | ' : ''}${requirementText}`;
      if (!existing.messages) existing.messages = [];
      existing.messages.push(chatMsgObj as any);
      return await existing.save();
    }

    const leadId = await this.generateLeadId();
    const assignee = await this.resolveAutoAssignee();

    const newLead = new this.leadModel({
      leadId,
      name: customerName,
      phone: finalPhone,
      whatsapp: finalPhone,
      requirement: requirementText,
      source: LeadSource.WHATSAPP,
      status: assignee ? LeadStatus.ASSIGNED : LeadStatus.NEW,
      assignedTo: assignee ? assignee._id : undefined,
      platform: 'WHATSAPP_AD',
      adId: referral.source_id || '',
      messages: [chatMsgObj],
      notes: assignee
        ? [
            {
              _id: new Types.ObjectId(),
              text: `Auto-assigned to ${assignee.name} via Round Robin`,
              createdAt: new Date(),
            },
          ]
        : [],
    });

    const saved = await newLead.save();
    this.logger.log(
      `Created new CRM Lead from WhatsApp Ad Message: ${saved.leadId} (${saved.name} - ${finalPhone})${assignee ? ` -> Assigned to ${assignee.name}` : ''}`,
    );

    await this.notifyLeadCreation(
      saved,
      assignee,
      `💬 New WhatsApp Lead: ${saved.name}`,
      `A new lead messaged via WhatsApp Ad (${finalPhone}): "${msgText}"${assignee ? ` — Auto-assigned to ${assignee.name}` : ''}`,
      `A new WhatsApp lead (${finalPhone}) was auto-assigned to you: "${msgText}"`,
    );

    return saved;
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

    // 4. SECONDARY DUP CHECK by Phone & Email (Only for valid real contact info)
    let existingLeadByContact: LeadDocument | null = null;
    if (finalPhone !== '0000000000' || cleanEmail) {
      const dupConditions: any[] = [];
      if (finalPhone !== '0000000000') {
        const phoneRegex = new RegExp(finalPhone);
        dupConditions.push({ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } });
      }
      if (cleanEmail) {
        dupConditions.push({ email: new RegExp(`^${cleanEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') });
      }
      if (dupConditions.length > 0) {
        existingLeadByContact = await this.leadModel.findOne({ $or: dupConditions });
      }
    }

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
    const assignee = await this.resolveAutoAssignee();

    const newLead = new this.leadModel({
      leadId,
      name: mapped.name || 'Facebook Lead',
      phone: finalPhone,
      whatsapp: finalPhone,
      email: cleanEmail,
      company: mapped.company || '',
      city: mapped.city || '',
      requirement: mapped.requirement || `Submitted Facebook Lead Form (${mapped.formName || mapped.formId || 'Instant Form'})`,
      source: LeadSource.FACEBOOK_ADS,
      status: assignee ? LeadStatus.ASSIGNED : LeadStatus.NEW,
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
      assignedTo: assignee ? assignee._id : undefined,
      createdBy: undefined,
      notes: assignee
        ? [
            {
              _id: new Types.ObjectId(),
              text: `Auto-assigned to ${assignee.name} via Round Robin`,
              createdAt: new Date(),
            },
          ]
        : [],
    });

    let savedLead: LeadDocument;
    try {
      savedLead = await newLead.save();
      this.logger.log(
        `Created new CRM Lead from Facebook Lead Ad: ${savedLead.leadId} (${savedLead.name})${assignee ? ` -> Assigned to ${assignee.name}` : ''}`,
      );
    } catch (saveErr: any) {
      if (saveErr.code === 11000 && (saveErr.keyPattern?.metaLeadId || saveErr.message?.includes('metaLeadId'))) {
        this.logger.warn(`Duplicate key detected on metaLeadId=${leadgenId}. Safely returning existing lead.`);
        const dup = await this.leadModel.findOne({ metaLeadId: leadgenId });
        if (dup) return dup;
      }
      throw saveErr;
    }

    // 6. Notify Assigned Rep & Admins
    await this.notifyLeadCreation(
      savedLead,
      assignee,
      `📣 New Facebook Lead: ${savedLead.name}`,
      `A new lead came from Facebook Lead Ads (${savedLead.campaignName || 'Campaign'}) - Phone: ${finalPhone}${assignee ? ` — Auto-assigned to ${assignee.name}` : ''}`,
      `A new Facebook Lead Ad (${savedLead.campaignName || 'Campaign'}) - Phone: ${finalPhone} was auto-assigned to you.`,
    );

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
