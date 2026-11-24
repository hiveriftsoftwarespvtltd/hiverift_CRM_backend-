import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WhatsappConversation,
  WhatsappConversationDocument,
  ConversationSourceType,
  ConversationStatus,
} from '../schemas/whatsapp-conversation.schema';
import {
  WhatsappInboxMessage,
  WhatsappInboxMessageDocument,
  InboxMessageDirection,
  InboxMessageType,
  InboxMessageStatus,
} from '../schemas/whatsapp-inbox-message.schema';
import {
  WhatsappWebhookEvent,
  WhatsappWebhookEventDocument,
} from '../schemas/whatsapp-webhook-event.schema';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import {
  WhatsappImportedLead,
  WhatsappImportedLeadDocument,
} from '../schemas/whatsapp-imported-lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { MetaService } from '../../meta/meta.service';
import { getUserAccessScope, UserAccessScope } from '../whatsapp-permissions.util';

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
export class WhatsappInboxService {
  private readonly logger = new Logger(WhatsappInboxService.name);

  constructor(
    @InjectModel(WhatsappConversation.name)
    private readonly conversationModel: Model<WhatsappConversationDocument>,
    @InjectModel(WhatsappInboxMessage.name)
    private readonly messageModel: Model<WhatsappInboxMessageDocument>,
    @InjectModel(WhatsappWebhookEvent.name)
    private readonly webhookEventModel: Model<WhatsappWebhookEventDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(WhatsappImportedLead.name)
    private readonly importedLeadModel: Model<WhatsappImportedLeadDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => MetaService))
    private readonly metaService: MetaService,
  ) {}

  /**
   * Helper to normalize a phone number into clean 10-digit format
   */
  normalizePhoneNumber(phone?: string): string {
    const clean = sanitizePhone(phone);
    return clean && clean.length === 10 ? clean : (phone ? String(phone).replace(/\D/g, '').slice(-10) : '');
  }

  /**
   * 1. AUTOMATICALLY RECEIVE & PROCESS INCOMING CUSTOMER MESSAGES
   * Strictly matches customer against:
   * 1. CRM Leads
   * 2. WhatsApp Imported Leads
   * 3. Existing WhatsApp Conversations
   * Never creates duplicate CRM leads!
   */
  async handleIncomingMessage(contact: any, message: any, rawPayload?: any): Promise<WhatsappInboxMessageDocument | null> {
    const wamid = message?.id;
    if (!wamid) {
      this.logger.warn('Incoming WhatsApp message without ID, skipping.');
      return null;
    }

    // 1. Idempotency Check: prevent duplicate webhook processing
    const existingEvent = await this.webhookEventModel.findOne({
      whatsappMessageId: wamid,
      eventType: 'message',
    });
    if (existingEvent && existingEvent.processed) {
      this.logger.log(`Idempotent skip: WhatsApp message ${wamid} already processed.`);
      const existingMsg = await this.messageModel.findOne({ whatsappMessageId: wamid });
      return existingMsg;
    }

    // Register webhook event record
    await this.webhookEventModel.findOneAndUpdate(
      { eventId: wamid },
      {
        $setOnInsert: {
          eventId: wamid,
          whatsappMessageId: wamid,
          eventType: 'message',
          receivedAt: new Date(),
          payload: message,
        },
      },
      { upsert: true, new: true },
    );

    const rawFrom = message?.from || contact?.wa_id || '';
    const cleanPhone = this.normalizePhoneNumber(rawFrom);

    if (!cleanPhone || cleanPhone === '0000000000') {
      this.logger.warn(`Incoming message with invalid phone: raw=${rawFrom}`);
      return null;
    }

    const rawProfileName = contact?.profile?.name || '';
    const cleanProfileName = rawProfileName.replace(/^[~\s\-_]+/, '').trim();

    // 2. SEARCH IN ORDER:
    // Search 1: Existing CRM Leads
    const phoneRegex = new RegExp(cleanPhone);
    const matchedCrmLead = await this.leadModel.findOne({
      $or: [{ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } }],
    });

    // Search 2: Existing Imported WhatsApp Leads (if not found in CRM leads)
    let matchedImportedLead: WhatsappImportedLeadDocument | null = null;
    if (!matchedCrmLead) {
      matchedImportedLead = await this.importedLeadModel.findOne({
        $or: [
          { phoneNumber: { $regex: phoneRegex } },
          { phone: { $regex: phoneRegex } },
          { whatsapp: { $regex: phoneRegex } },
        ],
      });
    }

    // Determine Source & Ownership
    let sourceType = ConversationSourceType.DIRECT_WHATSAPP;
    let crmLeadId: Types.ObjectId | undefined = undefined;
    let importedLeadId: Types.ObjectId | undefined = undefined;
    let ownerId: Types.ObjectId | undefined = undefined;
    let assignedEmployeeId: Types.ObjectId | undefined = undefined;
    let contactName = cleanProfileName || `WhatsApp User (${cleanPhone})`;

    if (matchedCrmLead) {
      sourceType = ConversationSourceType.CRM_LEAD;
      crmLeadId = matchedCrmLead._id as Types.ObjectId;
      contactName = matchedCrmLead.name || cleanProfileName || `Lead (${cleanPhone})`;
      ownerId = matchedCrmLead.assignedTo || matchedCrmLead.createdBy || undefined;
      assignedEmployeeId = matchedCrmLead.assignedTo || matchedCrmLead.createdBy || undefined;
    } else if (matchedImportedLead) {
      sourceType = ConversationSourceType.IMPORTED_LEAD;
      importedLeadId = matchedImportedLead._id as Types.ObjectId;
      contactName = matchedImportedLead.name || cleanProfileName || `Imported Lead (${cleanPhone})`;
      ownerId = matchedImportedLead.ownerId || matchedImportedLead.createdBy || undefined;
      assignedEmployeeId = matchedImportedLead.ownerId || matchedImportedLead.createdBy || undefined;
    }

    // 3. Extract Message Content & Media Type
    const msgTypeRaw = (message?.type || '').toLowerCase();
    let messageType = InboxMessageType.TEXT;
    let messageContent = '';
    let mediaId = '';
    let fileName = '';
    let mimeType = '';

    const mediaObj =
      message?.image ||
      message?.document ||
      message?.video ||
      message?.audio ||
      message?.voice ||
      message?.sticker ||
      (msgTypeRaw ? message?.[msgTypeRaw] : null);

    if (typeof mediaObj === 'object' && mediaObj) {
      mediaId = mediaObj.id || mediaObj.media_id || '';
      fileName = mediaObj.filename || '';
      mimeType = mediaObj.mime_type || '';
      messageContent = mediaObj.caption || '';
    }

    if (msgTypeRaw === 'image' || !!message?.image) {
      messageType = InboxMessageType.IMAGE;
      if (!messageContent) messageContent = '[📷 Image]';
    } else if (msgTypeRaw === 'document' || !!message?.document) {
      messageType = InboxMessageType.DOCUMENT;
      if (!messageContent) messageContent = `[📄 ${fileName || 'Document.pdf'}]`;
    } else if (msgTypeRaw === 'audio' || msgTypeRaw === 'voice' || !!message?.audio) {
      messageType = InboxMessageType.AUDIO;
      if (!messageContent) messageContent = '[🎵 Audio Note]';
    } else if (msgTypeRaw === 'video' || !!message?.video) {
      messageType = InboxMessageType.VIDEO;
      if (!messageContent) messageContent = '[🎬 Video]';
    } else if (msgTypeRaw === 'location' || !!message?.location) {
      messageType = InboxMessageType.LOCATION;
      const loc = message.location || {};
      messageContent = `[📍 Location: ${loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`}]`;
    } else if (msgTypeRaw === 'contacts' || !!message?.contacts) {
      messageType = InboxMessageType.CONTACTS;
      messageContent = '[👤 Contact Card]';
    } else if (msgTypeRaw === 'button' || !!message?.button) {
      messageType = InboxMessageType.BUTTON;
      messageContent = message.button?.text || '[Quick Button Reply]';
    } else if (msgTypeRaw === 'interactive' || !!message?.interactive) {
      messageType = InboxMessageType.INTERACTIVE;
      messageContent =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        '[Interactive Reply]';
    } else {
      messageType = InboxMessageType.TEXT;
      messageContent = message?.text?.body || messageContent || 'New Message';
    }

    const mediaUrl = mediaId ? `/api/v1/meta/whatsapp/media/${mediaId}` : undefined;

    // Asynchronously pre-fetch media from Meta Graph API so disk cache is warmed up
    if (mediaId) {
      this.metaService.getWhatsAppMedia(mediaId).catch((err) => {
        this.logger.warn(`Media prefetch warning for ${mediaId}: ${err?.message}`);
      });
    }

    // 4. Find or Create/Update WhatsApp Conversation
    let conversation = await this.conversationModel.findOne({ phoneNumber: cleanPhone });

    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hr customer service window

    if (!conversation) {
      conversation = new this.conversationModel({
        phoneNumber: cleanPhone,
        contactName,
        crmLeadId,
        importedLeadId,
        ownerId,
        assignedEmployeeId,
        sourceType,
        lastMessage: messageContent,
        lastMessageAt: now,
        lastMessageDirection: 'incoming',
        unreadCount: 1,
        status: ConversationStatus.ACTIVE,
        lastCustomerMessageAt: now,
        windowExpiresAt,
      });
      await conversation.save();
    } else {
      // Keep existing lead linkage or attach if newly matched
      if (!conversation.crmLeadId && crmLeadId) {
        conversation.crmLeadId = crmLeadId;
        conversation.sourceType = ConversationSourceType.CRM_LEAD;
      }
      if (!conversation.importedLeadId && importedLeadId && !conversation.crmLeadId) {
        conversation.importedLeadId = importedLeadId;
        conversation.sourceType = ConversationSourceType.IMPORTED_LEAD;
      }
      if (contactName && conversation.contactName === 'WhatsApp Contact') {
        conversation.contactName = contactName;
      }
      if (!conversation.assignedEmployeeId && assignedEmployeeId) {
        conversation.assignedEmployeeId = assignedEmployeeId;
      }

      conversation.lastMessage = messageContent;
      conversation.lastMessageAt = now;
      conversation.lastMessageDirection = 'incoming';
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      conversation.status = ConversationStatus.ACTIVE;
      conversation.lastCustomerMessageAt = now;
      conversation.windowExpiresAt = windowExpiresAt;

      await conversation.save();
    }

    // 5. Store Incoming Message Record
    const inboxMessage = new this.messageModel({
      conversationId: conversation._id,
      whatsappMessageId: wamid,
      direction: InboxMessageDirection.INCOMING,
      messageType,
      messageContent,
      mediaId: mediaId || undefined,
      mediaUrl,
      fileName: fileName || undefined,
      mimeType: mimeType || undefined,
      senderPhone: cleanPhone,
      recipientPhone: 'HiveRift',
      status: InboxMessageStatus.INCOMING,
      timestamp: message?.timestamp ? new Date(parseInt(message.timestamp, 10) * 1000) : now,
      isRead: false,
      webhookMetadata: {
        rawType: msgTypeRaw,
        referral: message?.referral,
      },
    });

    const savedMessage = await inboxMessage.save();

    // Mark event processed
    await this.webhookEventModel.updateOne(
      { eventId: wamid },
      { $set: { processed: true, processedAt: new Date() } },
    );

    // Also sync to CRM Lead messages array if lead exists (for legacy lead detail compatibility)
    if (matchedCrmLead) {
      try {
        const legacyChatMsg = {
          whatsappMessageId: wamid,
          direction: 'incoming',
          senderType: 'customer',
          message: messageContent,
          mediaUrl,
          mediaType: msgTypeRaw || 'text',
          mediaId: mediaId || undefined,
          fileName: fileName || undefined,
          phone: cleanPhone,
          status: 'sent',
          createdAt: now,
        };
        if (!matchedCrmLead.messages) matchedCrmLead.messages = [];
        matchedCrmLead.messages.push(legacyChatMsg as any);
        await matchedCrmLead.save();
      } catch (err: any) {
        this.logger.warn(`Legacy lead message sync warning: ${err?.message}`);
      }
    }

    this.logger.log(`✅ Stored incoming WhatsApp reply from ${contactName} (${cleanPhone}) in Inbox`);
    return savedMessage;
  }

  /**
   * 2. STATUS TRACKING WEBHOOK (Delivered, Read, Failed)
   */
  async handleStatusUpdate(st: any): Promise<void> {
    const wamid = st?.id;
    const statusName = String(st?.status || '').toLowerCase().trim();
    if (!wamid || !statusName) return;

    const ts = st.timestamp ? new Date(parseInt(st.timestamp, 10) * 1000) : new Date();

    const updateFields: any = {};
    if (statusName === 'delivered') {
      updateFields.status = InboxMessageStatus.DELIVERED;
      updateFields.deliveredAt = ts;
    } else if (statusName === 'read') {
      updateFields.status = InboxMessageStatus.READ;
      updateFields.readAt = ts;
    } else if (statusName === 'failed') {
      updateFields.status = InboxMessageStatus.FAILED;
      updateFields.failedAt = ts;
      if (st.errors && st.errors.length > 0) {
        updateFields.errorMessage = st.errors[0]?.message || st.errors[0]?.title || 'Meta delivery error';
      }
    }

    if (Object.keys(updateFields).length > 0) {
      await this.messageModel.updateOne(
        { whatsappMessageId: wamid },
        { $set: updateFields },
      );
    }
  }

  /**
   * 3. RECORD CAMPAIGN MESSAGES TO INBOX
   * Called when a campaign recipient message is dispatched so it appears in the conversation history!
   */
  async recordCampaignMessage(opts: {
    recipientPhone: string;
    recipientName?: string;
    whatsappMessageId: string;
    renderedMessage: string;
    campaignId: Types.ObjectId;
    campaignName: string;
    templateName: string;
    templateParameters?: string[];
    sentBy?: Types.ObjectId;
    crmLeadId?: Types.ObjectId;
    importedLeadId?: Types.ObjectId;
  }): Promise<void> {
    try {
      const cleanPhone = this.normalizePhoneNumber(opts.recipientPhone);
      if (!cleanPhone) return;

      const now = new Date();

      // Find or create conversation
      let conversation = await this.conversationModel.findOne({ phoneNumber: cleanPhone });

      if (!conversation) {
        let sourceType = ConversationSourceType.DIRECT_WHATSAPP;
        if (opts.crmLeadId) sourceType = ConversationSourceType.CRM_LEAD;
        else if (opts.importedLeadId) sourceType = ConversationSourceType.IMPORTED_LEAD;

        conversation = new this.conversationModel({
          phoneNumber: cleanPhone,
          contactName: opts.recipientName || `Contact (${cleanPhone})`,
          crmLeadId: opts.crmLeadId || null,
          importedLeadId: opts.importedLeadId || null,
          ownerId: opts.sentBy || null,
          assignedEmployeeId: opts.sentBy || null,
          sourceType,
          lastMessage: opts.renderedMessage,
          lastMessageAt: now,
          lastMessageDirection: 'outgoing',
          unreadCount: 0,
          status: ConversationStatus.ACTIVE,
          lastCampaignId: opts.campaignId,
          lastCampaignName: opts.campaignName,
          lastTemplateName: opts.templateName,
        });
        await conversation.save();
      } else {
        if (!conversation.crmLeadId && opts.crmLeadId) {
          conversation.crmLeadId = opts.crmLeadId;
          conversation.sourceType = ConversationSourceType.CRM_LEAD;
        }
        if (!conversation.importedLeadId && opts.importedLeadId && !conversation.crmLeadId) {
          conversation.importedLeadId = opts.importedLeadId;
          conversation.sourceType = ConversationSourceType.IMPORTED_LEAD;
        }

        conversation.lastMessage = opts.renderedMessage;
        conversation.lastMessageAt = now;
        conversation.lastMessageDirection = 'outgoing';
        conversation.lastCampaignId = opts.campaignId;
        conversation.lastCampaignName = opts.campaignName;
        conversation.lastTemplateName = opts.templateName;
        await conversation.save();
      }

      // Check if message already exists
      const existing = await this.messageModel.findOne({ whatsappMessageId: opts.whatsappMessageId });
      if (!existing) {
        await this.messageModel.create({
          conversationId: conversation._id,
          whatsappMessageId: opts.whatsappMessageId,
          direction: InboxMessageDirection.OUTGOING,
          messageType: InboxMessageType.TEMPLATE,
          messageContent: opts.renderedMessage,
          senderPhone: 'HiveRift',
          recipientPhone: cleanPhone,
          sentBy: opts.sentBy,
          campaignId: opts.campaignId,
          campaignName: opts.campaignName,
          templateName: opts.templateName,
          templateParameters: opts.templateParameters || [],
          status: InboxMessageStatus.SENT,
          timestamp: now,
          isRead: true,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to record campaign message to inbox: ${err?.message}`);
    }
  }

  /**
   * 4. GET CONVERSATIONS LIST (WITH FILTERS, SEARCH, EMPLOYEE PERMISSIONS)
   */
  async getConversations(
    user: any,
    query: {
      filter?: string;
      search?: string;
      sort?: string;
      page?: number;
      limit?: number;
      employeeId?: string;
    },
  ) {
    const scope = getUserAccessScope(user);
    const filter = (query.filter || 'all').toLowerCase().trim();
    const search = (query.search || '').trim();
    const sort = (query.sort || 'latest').toLowerCase().trim();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const skip = (page - 1) * limit;

    const conditions: any[] = [];

    // Base permission security:
    // Sales Employee: can ONLY view conversations assigned to them or their leads
    if (scope.isSalesEmployee) {
      conditions.push({
        $or: [
          { assignedEmployeeId: scope.userObjId },
          { ownerId: scope.userObjId },
        ],
      });
    } else if (scope.isSalesHead && query.employeeId && Types.ObjectId.isValid(query.employeeId)) {
      // Sales Head filtering by a specific team member
      conditions.push({ assignedEmployeeId: new Types.ObjectId(query.employeeId) });
    }

    // Filter Tabs
    if (filter === 'unread') {
      conditions.push({ unreadCount: { $gt: 0 } });
    } else if (filter === 'read') {
      conditions.push({ unreadCount: 0 });
    } else if (filter === 'assigned_me') {
      conditions.push({ assignedEmployeeId: scope.userObjId });
    } else if (filter === 'unassigned') {
      conditions.push({ assignedEmployeeId: { $in: [null, undefined] } });
    } else if (filter === 'crm_lead') {
      conditions.push({ sourceType: ConversationSourceType.CRM_LEAD });
    } else if (filter === 'imported_lead') {
      conditions.push({ sourceType: ConversationSourceType.IMPORTED_LEAD });
    } else if (filter === 'direct_whatsapp') {
      conditions.push({ sourceType: ConversationSourceType.DIRECT_WHATSAPP });
    } else if (filter === 'campaign_replies') {
      conditions.push({ lastCampaignId: { $ne: null } });
    }

    // Search query
    if (search) {
      const searchRegex = new RegExp(search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { contactName: searchRegex },
          { phoneNumber: searchRegex },
          { lastMessage: searchRegex },
          { lastCampaignName: searchRegex },
        ],
      });
    }

    const finalQuery = conditions.length > 0 ? { $and: conditions } : {};

    // Sort order
    let sortOptions: any = { lastMessageAt: -1 };
    if (sort === 'oldest') {
      sortOptions = { lastMessageAt: 1 };
    } else if (sort === 'unread') {
      sortOptions = { unreadCount: -1, lastMessageAt: -1 };
    }

    const [conversations, total] = await Promise.all([
      this.conversationModel
        .find(finalQuery)
        .populate('assignedEmployeeId', 'name email role')
        .populate('crmLeadId', 'leadId name phone requirement status assignedTo')
        .populate('importedLeadId', 'name phone batchName assignedTo')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.conversationModel.countDocuments(finalQuery),
    ]);

    // Compute live 24-hr customer service window status for each conversation
    const now = new Date();
    const enriched = conversations.map((conv: any) => {
      const expiresAt = conv.windowExpiresAt ? new Date(conv.windowExpiresAt) : null;
      const isWindowOpen = expiresAt ? expiresAt > now : false;
      const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : 0;
      const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
      const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

      return {
        ...conv,
        isWindowOpen,
        windowRemainingFormatted: isWindowOpen ? `${remainingHours}h ${remainingMinutes}m` : 'Expired',
      };
    });

    return {
      conversations: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 5. GET CONVERSATION DETAILS & MESSAGE HISTORY (WITH PERMISSION CHECK & AUTO READ)
   */
  async getConversationMessages(conversationId: string, user: any, query: { limit?: number; before?: string }) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversation ID');
    }

    const scope = getUserAccessScope(user);
    const conversation = await this.conversationModel
      .findById(conversationId)
      .populate('assignedEmployeeId', 'name email role')
      .populate('crmLeadId', 'leadId name phone requirement status assignedTo')
      .populate('importedLeadId', 'name phone batchName assignedTo')
      .lean();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Permission Verification:
    // Sales employees can only access conversations assigned to them or created by them
    if (scope.isSalesEmployee) {
      const assignedId = conversation.assignedEmployeeId?._id?.toString() || conversation.assignedEmployeeId?.toString();
      const ownerId = conversation.ownerId?.toString();
      const isAllowed = assignedId === scope.userId || ownerId === scope.userId;
      if (!isAllowed) {
        throw new ForbiddenException('You do not have permission to access this conversation');
      }
    }

    const limit = Math.min(100, Math.max(1, Number(query.limit) || 60));
    const messageQuery: any = { conversationId: new Types.ObjectId(conversationId) };

    if (query.before && !isNaN(new Date(query.before).getTime())) {
      messageQuery.timestamp = { $lt: new Date(query.before) };
    }

    const messages = await this.messageModel
      .find(messageQuery)
      .populate('sentBy', 'name email role')
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();

    // Automatically mark incoming messages as read in this conversation
    await Promise.all([
      this.messageModel.updateMany(
        { conversationId: new Types.ObjectId(conversationId), direction: InboxMessageDirection.INCOMING, isRead: false },
        { $set: { isRead: true } },
      ),
      this.conversationModel.findByIdAndUpdate(conversationId, { $set: { unreadCount: 0 } }),
    ]);

    const now = new Date();
    const expiresAt = conversation.windowExpiresAt ? new Date(conversation.windowExpiresAt) : null;
    const isWindowOpen = expiresAt ? expiresAt > now : false;
    const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : 0;
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      conversation: {
        ...conversation,
        isWindowOpen,
        windowRemainingFormatted: isWindowOpen ? `${remainingHours}h ${remainingMinutes}m` : 'Expired',
      },
      messages,
      totalCount: messages.length,
    };
  }

  /**
   * 6. SEND REPLIES DIRECTLY FROM CRM (ENFORCING 24-HR WINDOW & APPROVED TEMPLATES)
   */
  async sendMessage(
    conversationId: string,
    user: any,
    dto: {
      text?: string;
      mediaUrl?: string;
      mediaType?: string;
      fileName?: string;
      templateName?: string;
      parameters?: string[];
      renderedMessage?: string;
    },
  ) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversation ID');
    }

    const scope = getUserAccessScope(user);
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Permission Verification:
    if (scope.isSalesEmployee) {
      const assignedId = conversation.assignedEmployeeId?.toString();
      const ownerId = conversation.ownerId?.toString();
      const isAllowed = assignedId === scope.userId || ownerId === scope.userId;
      if (!isAllowed) {
        throw new ForbiddenException('You do not have permission to reply to this conversation');
      }
    }

    // Check 24-Hour Customer Service Window
    const now = new Date();
    const expiresAt = conversation.windowExpiresAt ? new Date(conversation.windowExpiresAt) : null;
    const isWindowOpen = expiresAt ? expiresAt > now : false;

    // If outside 24-hour window, WhatsApp Business API forbids free-form session messages.
    // An approved template MUST be used!
    if (!isWindowOpen && !dto.templateName) {
      throw new BadRequestException(
        'The 24-hour customer service window has expired. WhatsApp policy requires sending an approved template to re-engage with this customer.',
      );
    }

    const phone = conversation.phoneNumber;
    let sendResult: { success: boolean; whatsappMessageId?: string; mediaId?: string; error?: string };
    let msgType = InboxMessageType.TEXT;
    let finalContent = dto.text || '';

    // A. Sending an Approved Template
    if (dto.templateName) {
      msgType = InboxMessageType.TEMPLATE;
      finalContent = dto.renderedMessage || `[WhatsApp Template: ${dto.templateName}]`;

      sendResult = await this.metaService.sendWhatsAppTemplateMessage(
        phone,
        dto.templateName,
        dto.parameters || [],
        'en',
      );
    }
    // B. Sending Media (within 24-hr window)
    else if (dto.mediaUrl) {
      const isDoc =
        dto.mediaType === 'document' ||
        dto.mediaUrl.toLowerCase().includes('.pdf') ||
        (dto.fileName && dto.fileName.toLowerCase().endsWith('.pdf'));

      msgType = isDoc ? InboxMessageType.DOCUMENT : InboxMessageType.IMAGE;
      finalContent = dto.text || (isDoc ? `[📄 ${dto.fileName || 'Document.pdf'}]` : '[📷 Image]');

      sendResult = await this.metaService.sendWhatsAppMediaMessage(
        phone,
        dto.mediaUrl,
        dto.text || '',
        isDoc ? 'document' : 'image',
        dto.fileName,
      );
    }
    // C. Sending Free-Form Text (within 24-hr window)
    else {
      if (!dto.text || !dto.text.trim()) {
        throw new BadRequestException('Message text cannot be empty');
      }
      msgType = InboxMessageType.TEXT;
      finalContent = dto.text.trim();
      sendResult = await this.metaService.sendWhatsAppTextMessage(phone, finalContent);
    }

    if (!sendResult.success) {
      throw new BadRequestException(sendResult.error || 'Failed to send WhatsApp message via Meta Cloud API');
    }

    // Save Outgoing Message
    const inboxMessage = new this.messageModel({
      conversationId: conversation._id,
      whatsappMessageId: sendResult.whatsappMessageId,
      direction: InboxMessageDirection.OUTGOING,
      messageType: msgType,
      messageContent: finalContent,
      mediaId: sendResult.mediaId || undefined,
      mediaUrl: dto.mediaUrl || undefined,
      fileName: dto.fileName || undefined,
      senderPhone: 'HiveRift',
      recipientPhone: phone,
      sentBy: scope.userObjId,
      sentByName: scope.userName,
      templateName: dto.templateName || undefined,
      templateParameters: dto.parameters || [],
      status: InboxMessageStatus.SENT,
      timestamp: now,
      isRead: true,
    });

    const savedMessage = await inboxMessage.save();

    // Update Conversation summary
    conversation.lastMessage = finalContent;
    conversation.lastMessageAt = now;
    conversation.lastMessageDirection = 'outgoing';
    if (dto.templateName) {
      conversation.lastTemplateName = dto.templateName;
    }
    await conversation.save();

    // If attached to a CRM lead, also sync to lead messages array for backwards compatibility
    if (conversation.crmLeadId) {
      try {
        await this.leadModel.findByIdAndUpdate(conversation.crmLeadId, {
          $push: {
            messages: {
              whatsappMessageId: sendResult.whatsappMessageId,
              direction: 'outgoing',
              senderType: 'agent',
              message: finalContent,
              mediaUrl: dto.mediaUrl,
              mediaType: msgType,
              phone,
              status: 'sent',
              createdAt: now,
            },
          },
        });
      } catch (err: any) {
        this.logger.warn(`Legacy lead message sync warning: ${err?.message}`);
      }
    }

    return savedMessage;
  }

  /**
   * 7. ASSIGN CONVERSATION TO EMPLOYEE (SALES HEAD & SUPER ADMIN ONLY)
   */
  async assignConversation(conversationId: string, user: any, targetEmployeeId: string) {
    const scope = getUserAccessScope(user);
    if (!scope.isSalesHead && !scope.isSuperAdmin) {
      throw new ForbiddenException('Only Sales Heads and Admins can assign conversations');
    }

    if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(targetEmployeeId)) {
      throw new BadRequestException('Invalid conversation or employee ID');
    }

    const [conversation, targetUser] = await Promise.all([
      this.conversationModel.findById(conversationId),
      this.userModel.findById(targetEmployeeId),
    ]);

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!targetUser) throw new NotFoundException('Target employee not found');

    conversation.assignedEmployeeId = targetUser._id as Types.ObjectId;
    conversation.notes.push({
      _id: new Types.ObjectId(),
      authorName: scope.userName,
      text: `Reassigned conversation to ${targetUser.name}`,
      createdAt: new Date(),
    });

    await conversation.save();

    return {
      success: true,
      message: `Conversation reassigned to ${targetUser.name}`,
      conversation,
    };
  }

  /**
   * 8. INBOX STATS & COUNTERS (BADGES & REPORTING)
   */
  async getInboxStats(user: any) {
    const scope = getUserAccessScope(user);
    const conditions: any[] = [];

    if (scope.isSalesEmployee) {
      conditions.push({
        $or: [
          { assignedEmployeeId: scope.userObjId },
          { ownerId: scope.userObjId },
        ],
      });
    }

    const baseQuery = conditions.length > 0 ? { $and: conditions } : {};
    const now = new Date();

    const [totalConversations, unreadConversations, activeWindowConversations] = await Promise.all([
      this.conversationModel.countDocuments(baseQuery),
      this.conversationModel.countDocuments({ ...baseQuery, unreadCount: { $gt: 0 } }),
      this.conversationModel.countDocuments({ ...baseQuery, windowExpiresAt: { $gt: now } }),
    ]);

    return {
      totalConversations,
      unreadConversations,
      activeWindowConversations,
    };
  }

  /**
   * 9. MARK CONVERSATION AS READ
   */
  async markAsRead(conversationId: string, user: any) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversation ID');
    }

    await Promise.all([
      this.conversationModel.findByIdAndUpdate(conversationId, { $set: { unreadCount: 0 } }),
      this.messageModel.updateMany(
        { conversationId: new Types.ObjectId(conversationId), direction: InboxMessageDirection.INCOMING, isRead: false },
        { $set: { isRead: true } },
      ),
    ]);

    return { success: true };
  }
}
