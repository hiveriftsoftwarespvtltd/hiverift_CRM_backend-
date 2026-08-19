import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Quotation, QuotationDocument } from './schemas/quotation.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { MailService } from '../common/services/mail.service';

@Injectable()
export class QuotationsService {
  constructor(
    @InjectModel(Quotation.name) private quotationModel: Model<QuotationDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    private mailService: MailService,
  ) {}

  private async generateQuotationNo(): Promise<string> {
    const year = new Date().getFullYear();
    const quotations = await this.quotationModel.find({}, { quotationNo: 1 }).lean();
    let maxNum = 0;
    for (const q of quotations) {
      if (q.quotationNo) {
        const match = q.quotationNo.match(/QUO-\d+-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.quotationModel.findOne({ quotationNo: `QUO-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `QUO-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  private async syncQuotationPayment(quotation: QuotationDocument, userId?: string) {
    if (!quotation || !quotation.totalAmount) return;

    try {
      // Find if payment ledger already exists for this quotation or client
      let payment = await this.paymentModel.findOne({ quotation: quotation._id });
      if (!payment && quotation.client) {
        payment = await this.paymentModel.findOne({ client: quotation.client, quotation: { $exists: false } });
      }

      if (payment) {
        // Update invoice amount & recalculate pending
        payment.invoiceAmount = quotation.totalAmount;
        payment.pendingAmount = Math.max(0, quotation.totalAmount - (payment.receivedAmount || 0));
        if (payment.receivedAmount >= quotation.totalAmount && quotation.totalAmount > 0) {
          payment.status = 'paid';
        } else if (payment.receivedAmount > 0) {
          payment.status = 'partial';
        } else {
          payment.status = 'pending';
        }
        payment.quotation = quotation._id as any;
        if (quotation.client) payment.client = quotation.client;
        if (quotation.lead) (payment as any).lead = quotation.lead;
        await payment.save();
      } else {
        // Create new auto-linked Payment receipt ledger
        const year = new Date().getFullYear();
        const lastDoc = await this.paymentModel
          .findOne({ paymentNo: { $regex: new RegExp(`^PAY-${year}-\\d+$`) } })
          .sort({ paymentNo: -1, createdAt: -1 });

        let nextNum = 1;
        if (lastDoc && lastDoc.paymentNo) {
          const match = lastDoc.paymentNo.match(/PAY-\d+-(\d+)/);
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        while (await this.paymentModel.findOne({ paymentNo: `PAY-${year}-${String(nextNum).padStart(4, '0')}` })) {
          nextNum++;
        }
        const paymentNo = `PAY-${year}-${String(nextNum).padStart(4, '0')}`;

        const newPayment = new this.paymentModel({
          paymentNo,
          client: quotation.client || undefined,
          lead: quotation.lead || undefined,
          quotation: quotation._id,
          invoiceAmount: quotation.totalAmount,
          receivedAmount: 0,
          pendingAmount: quotation.totalAmount,
          status: 'pending',
          paymentMethod: 'bank_transfer',
          notes: `Automated payment invoice created from Quotation ${quotation.quotationNo}`,
          createdBy: userId ? new Types.ObjectId(userId) : quotation.createdBy,
        });

        await newPayment.save();
      }
    } catch (err) {
      console.error('Error syncing quotation payment:', err);
    }
  }

  async create(dto: any, userId: string): Promise<QuotationDocument> {
    const quotationNo = await this.generateQuotationNo();
    const payload: any = {
      ...dto,
      quotationNo,
      createdBy: new Types.ObjectId(userId),
    };
    if (dto.lead) payload.lead = new Types.ObjectId(dto.lead);
    if (dto.client) payload.client = new Types.ObjectId(dto.client);

    const quotation = new this.quotationModel(payload);
    const saved = await quotation.save();

    // Auto-sync into Payments collection
    await this.syncQuotationPayment(saved, userId);

    return saved;
  }

  async findAll(query: any, user?: any): Promise<{ quotations: QuotationDocument[]; total: number }> {
    const { status, lead, client, page = 1, limit = 20, search } = query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (lead) filter.lead = new Types.ObjectId(lead);
    if (client) filter.client = new Types.ObjectId(client);

    // Sales role isolation:
    // Sales users see ONLY their own created quotations.
    // Admin & Management see ALL quotations created by anyone (Admin, Sales A, Sales B, etc.).
    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      filter.createdBy = new Types.ObjectId(uId);
    }

    if (search) {
      filter.$or = [
        { quotationNo: { $regex: search, $options: 'i' } },
        { 'services.name': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [quotations, total] = await Promise.all([
      this.quotationModel
        .find(filter)
        .populate('lead', 'name company email phone')
        .populate('client', 'name company email phone')
        .populate('createdBy', 'name email role')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.quotationModel.countDocuments(filter),
    ]);
    return { quotations, total };
  }

  async findOne(id: string, user?: any): Promise<QuotationDocument> {
    const q = await this.quotationModel
      .findById(id)
      .populate('lead', 'name company email phone address city')
      .populate('client', 'name company email phone address city gstin')
      .populate('createdBy', 'name email phone role');
    if (!q) throw new NotFoundException('Quotation not found');

    if (user && user.role === 'sales') {
      const uId = user._id ? user._id.toString() : user.id;
      const creatorId = (q.createdBy as any)?._id ? (q.createdBy as any)._id.toString() : (q.createdBy as any)?.toString();
      if (creatorId && creatorId !== uId) {
        throw new ForbiddenException('You do not have permission to view this quotation');
      }
    }
    return q;
  }

  async update(id: string, dto: any, user?: any): Promise<QuotationDocument> {
    const q = await this.findOne(id, user);

    if (dto.services) q.services = dto.services;
    if (dto.discount !== undefined) q.discount = Number(dto.discount) || 0;
    if (dto.taxPercent !== undefined) q.taxPercent = Number(dto.taxPercent) || 0;
    if (dto.validUntil) q.validUntil = new Date(dto.validUntil);
    if (dto.notes !== undefined) q.notes = dto.notes;
    if (dto.status) q.status = dto.status;
    if (dto.templateType) q.templateType = dto.templateType;
    if (dto.headerTitle !== undefined) (q as any).headerTitle = dto.headerTitle;
    if (dto.subTitle !== undefined) (q as any).subTitle = dto.subTitle;
    if (dto.customClientHeading !== undefined) (q as any).customClientHeading = dto.customClientHeading;
    if (dto.section1Title !== undefined) (q as any).section1Title = dto.section1Title;
    if (dto.section2Title !== undefined) (q as any).section2Title = dto.section2Title;
    if (dto.section3Title !== undefined) (q as any).section3Title = dto.section3Title;
    if (dto.section4Title !== undefined) (q as any).section4Title = dto.section4Title;
    if (dto.section5Title !== undefined) (q as any).section5Title = dto.section5Title;
    if (dto.executiveSummary !== undefined) (q as any).executiveSummary = dto.executiveSummary;
    if (dto.termsAndConditions !== undefined) (q as any).termsAndConditions = dto.termsAndConditions;
    if (dto.footerQuote !== undefined) (q as any).footerQuote = dto.footerQuote;
    if (dto.lead) q.lead = new Types.ObjectId(dto.lead);
    if (dto.client) q.client = new Types.ObjectId(dto.client);

    // Calculate totals
    if (q.services?.length) {
      q.subtotal = q.services.reduce((s, svc) => s + (Number(svc.amount) || ((Number(svc.quantity) || 1) * (Number(svc.rate) || 0))), 0);
      q.taxAmount = Math.max(0, ((q.subtotal - q.discount) * q.taxPercent) / 100);
      q.totalAmount = Math.max(0, q.subtotal - q.discount + q.taxAmount);
    }

    const updated = await q.save();

    // Auto-update price in Payments collection
    await this.syncQuotationPayment(updated);

    return updated;
  }

  async updateStatus(id: string, status: string, user?: any): Promise<QuotationDocument> {
    await this.findOne(id, user);
    const q = await this.quotationModel.findByIdAndUpdate(id, { status }, { new: true });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async sendEmail(id: string, user?: any): Promise<{ success: boolean; message: string }> {
    const quotation = await this.findOne(id, user);
    const recipient = (quotation.lead as any)?.email || (quotation.client as any)?.email;
    const recipientName = (quotation.lead as any)?.name || (quotation.client as any)?.name || 'Valued Client';

    if (!recipient) {
      throw new NotFoundException('No email address registered for this Lead or Client profile');
    }

    const sent = await this.mailService.sendQuotationEmail(recipient, recipientName, quotation);
    if (sent) {
      await this.quotationModel.findByIdAndUpdate(id, { status: 'sent', sentAt: new Date() });
      // Ensure payment is synced
      await this.syncQuotationPayment(quotation);
      return { success: true, message: `Quotation ${quotation.quotationNo} successfully sent to ${recipient}` };
    } else {
      throw new BadRequestException(`Failed to dispatch email to ${recipient}. Please check SMTP/Email configuration.`);
    }
  }

  async remove(id: string, user?: any): Promise<void> {
    await this.findOne(id, user);
    const q = await this.quotationModel.findByIdAndDelete(id);
    if (!q) throw new NotFoundException('Quotation not found');
  }

  async delete(id: string, user?: any): Promise<void> {
    return this.remove(id, user);
  }
}

