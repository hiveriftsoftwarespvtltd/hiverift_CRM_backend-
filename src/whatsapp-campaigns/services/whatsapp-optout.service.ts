import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WhatsappOptout, WhatsappOptoutDocument } from '../schemas/whatsapp-optout.schema';
import { WhatsappImportedLead, WhatsappImportedLeadDocument } from '../schemas/whatsapp-imported-lead.schema';
import { AuditService } from '../../audit/audit.service';
import { getUserAccessScope } from '../whatsapp-permissions.util';

function normalizePhone(phoneStr?: string): string {
  if (!phoneStr) return '';
  const digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

@Injectable()
export class WhatsappOptoutService {
  private readonly logger = new Logger(WhatsappOptoutService.name);

  constructor(
    @InjectModel(WhatsappOptout.name)
    private readonly optoutModel: Model<WhatsappOptoutDocument>,
    @InjectModel(WhatsappImportedLead.name)
    private readonly importedLeadModel: Model<WhatsappImportedLeadDocument>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Detect explicit STOP / UNSUBSCRIBE / NOT INTERESTED phrases in incoming customer text
   */
  detectOptOutKeyword(text?: string): { matched: boolean; reason: string } | null {
    if (!text) return null;
    const clean = String(text)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return null;

    const exactStopWords = ['stop', 'stop all', 'stop promotions', 'stop messages'];
    const unsubscribeWords = ['unsubscribe', 'opt out', 'optout', 'remove me', 'unsubscribe me'];
    const notInterestedWords = ['not interested', 'no interest', 'dont message', 'do not message', 'don t message'];

    if (exactStopWords.includes(clean) || /^stop\b/.test(clean)) {
      return { matched: true, reason: 'stop' };
    }
    if (unsubscribeWords.some((w) => clean === w || clean.includes(w))) {
      return { matched: true, reason: 'unsubscribe' };
    }
    if (notInterestedWords.some((w) => clean === w || clean.includes(w))) {
      return { matched: true, reason: 'not_interested' };
    }

    return null;
  }

  /**
   * Record or activate suppression for a phone number and mark imported leads as unsubscribed
   */
  async recordOptOut(params: {
    phoneNumber: string;
    contactName?: string;
    source?: 'whatsapp_reply' | 'manual_admin' | 'campaign_bounce';
    reason?: string;
    triggerMessage?: string;
    userId?: string;
  }) {
    const cleanPhone = normalizePhone(params.phoneNumber);
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new BadRequestException('Valid phone number is required');
    }

    const now = new Date();
    const doc = await this.optoutModel.findOneAndUpdate(
      { phoneNumber: cleanPhone },
      {
        $set: {
          phoneNumber: cleanPhone,
          ...(params.contactName ? { contactName: params.contactName } : {}),
          source: params.source || 'whatsapp_reply',
          reason: params.reason || 'stop',
          triggerMessage: params.triggerMessage || '',
          isActive: true,
          optedOutAt: now,
          ...(params.userId && Types.ObjectId.isValid(params.userId)
            ? { createdBy: new Types.ObjectId(params.userId) }
            : {}),
        },
      },
      { upsert: true, new: true },
    );

    // Sync suppression into whatsapp_imported_leads collection
    await this.importedLeadModel.updateMany(
      { phoneNumber: cleanPhone },
      {
        $set: {
          status: 'unsubscribed',
          whatsappOptIn: false,
          unsubscribedAt: now,
        },
      },
    );

    this.logger.log(`Opt-out recorded for ${cleanPhone} (reason=${params.reason || 'stop'}, source=${params.source || 'whatsapp_reply'})`);
    return doc;
  }

  /**
   * Admin-only auditable re-subscription when valid explicit consent is obtained
   */
  async resubscribe(idOrPhone: string, reason: string, user: any) {
    const scope = getUserAccessScope(user);
    if (!scope.isSuperAdmin && !scope.isSalesHead) {
      throw new ForbiddenException('Only Admins or Sales Managers can re-subscribe opted-out contacts');
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException('A consent reason is required to re-subscribe a contact');
    }

    const query = Types.ObjectId.isValid(idOrPhone)
      ? { _id: new Types.ObjectId(idOrPhone) }
      : { phoneNumber: normalizePhone(idOrPhone) };

    const record = await this.optoutModel.findOne(query);
    if (!record) {
      throw new NotFoundException('Opt-out record not found');
    }

    const now = new Date();
    record.isActive = false;
    record.reSubscribedAt = now;
    record.reSubscribedBy = scope.userObjId;
    record.reSubscribedByName = scope.userName;
    record.reSubscribedReason = reason.trim();
    await record.save();

    await this.importedLeadModel.updateMany(
      { phoneNumber: record.phoneNumber },
      {
        $set: {
          status: 'active',
          whatsappOptIn: true,
          whatsappOptInAt: now,
        },
      },
    );

    await this.auditService.log({
      userId: scope.userId,
      action: 'resubscribe_whatsapp_contact',
      module: 'whatsapp_campaigns',
      recordId: record.phoneNumber,
      description: `Admin ${scope.userName} re-subscribed ${record.phoneNumber} with consent note: ${reason.trim()}`,
    });

    return record;
  }

  /**
   * List opt-outs with search, active filter & pagination
   */
  async listOptOuts(query: { search?: string; status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.status === 'active' || !query.status) {
      filter.isActive = true;
    } else if (query.status === 'resubscribed') {
      filter.isActive = false;
    }

    if (query.search && query.search.trim()) {
      const rx = new RegExp(query.search.trim().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      filter.$or = [{ phoneNumber: rx }, { contactName: rx }, { reason: rx }, { triggerMessage: rx }];
    }

    const [items, total, activeCount, resubscribedCount] = await Promise.all([
      this.optoutModel.find(filter).sort({ optedOutAt: -1 }).skip(skip).limit(limit).lean(),
      this.optoutModel.countDocuments(filter),
      this.optoutModel.countDocuments({ isActive: true }),
      this.optoutModel.countDocuments({ isActive: false }),
    ]);

    return {
      optOuts: items,
      total,
      activeCount,
      resubscribedCount,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Fast check helper returning normalized opted-out phones Set
   */
  async getOptedOutPhoneSet(phones?: string[]): Promise<Set<string>> {
    const filter: any = { isActive: true };
    if (phones && phones.length > 0) {
      const normalized = phones.map((p) => normalizePhone(p)).filter(Boolean);
      filter.phoneNumber = { $in: normalized };
    }
    const docs = await this.optoutModel.find(filter, { phoneNumber: 1 }).lean();
    return new Set(docs.map((d) => d.phoneNumber));
  }
}
