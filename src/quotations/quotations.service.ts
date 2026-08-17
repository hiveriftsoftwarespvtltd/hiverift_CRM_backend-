import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Quotation, QuotationDocument } from './schemas/quotation.schema';
import { MailService } from '../common/services/mail.service';

@Injectable()
export class QuotationsService {
  constructor(
    @InjectModel(Quotation.name) private quotationModel: Model<QuotationDocument>,
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
    return quotation.save();
  }

  async findAll(query: any): Promise<{ quotations: QuotationDocument[]; total: number }> {
    const { status, lead, client, page = 1, limit = 20 } = query;
    const filter: any = {};
    if (status) filter.status = status;
    if (lead) filter.lead = new Types.ObjectId(lead);
    if (client) filter.client = new Types.ObjectId(client);

    const skip = (Number(page) - 1) * Number(limit);
    const [quotations, total] = await Promise.all([
      this.quotationModel
        .find(filter)
        .populate('lead', 'name company email phone')
        .populate('client', 'name company email phone')
        .populate('createdBy', 'name')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      this.quotationModel.countDocuments(filter),
    ]);
    return { quotations, total };
  }

  async findOne(id: string): Promise<QuotationDocument> {
    const q = await this.quotationModel
      .findById(id)
      .populate('lead', 'name company email phone address city')
      .populate('client', 'name company email phone address city gstin')
      .populate('createdBy', 'name email phone');
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async update(id: string, dto: any): Promise<QuotationDocument> {
    const q = await this.quotationModel.findByIdAndUpdate(id, dto, { new: true });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async updateStatus(id: string, status: string): Promise<QuotationDocument> {
    const q = await this.quotationModel.findByIdAndUpdate(id, { status }, { new: true });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async sendEmail(id: string): Promise<{ success: boolean; message: string }> {
    const quotation = await this.findOne(id);
    const recipient = (quotation.lead as any)?.email || (quotation.client as any)?.email;
    const recipientName = (quotation.lead as any)?.name || (quotation.client as any)?.name || 'Valued Client';

    if (!recipient) {
      throw new NotFoundException('No email address registered for this Lead or Client profile');
    }

    const sent = await this.mailService.sendQuotationEmail(recipient, recipientName, quotation);
    if (sent) {
      await this.quotationModel.findByIdAndUpdate(id, { status: 'sent', sentAt: new Date() });
      return { success: true, message: `Quotation ${quotation.quotationNo} successfully sent to ${recipient}` };
    } else {
      throw new BadRequestException(`Failed to dispatch email to ${recipient}. Please check SMTP/Email configuration.`);
    }
  }

  async remove(id: string): Promise<void> {
    const q = await this.quotationModel.findByIdAndDelete(id);
    if (!q) throw new NotFoundException('Quotation not found');
  }

  async delete(id: string): Promise<void> {
    return this.remove(id);
  }
}
