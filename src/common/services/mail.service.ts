import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('EMAIL_HOST') || 'smtp.gmail.com';
    const port = Number(this.configService.get<number>('EMAIL_PORT')) || 587;
    const secure = this.configService.get<string>('EMAIL_SECURE') === 'true';
    const user = this.configService.get<string>('EMAIL_USER');
    const pass = this.configService.get<string>('EMAIL_PASS');

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
    } else {
      this.logger.warn('Email credentials not configured. Emails will be logged only.');
    }
  }

  async sendMail(to: string, subject: string, html: string, attachments?: any[]): Promise<boolean> {
    try {
      const from = this.configService.get<string>('MAIL_FROM') || this.configService.get<string>('EMAIL_USER') || 'no-reply@hiverift.com';
      if (!this.transporter) {
        this.logger.log(`[SIMULATED EMAIL] To: ${to}, Subject: ${subject}`);
        return true;
      }

      await this.transporter.sendMail({
        from,
        to,
        subject,
        html,
        attachments,
      });
      this.logger.log(`✅ Email successfully sent to ${to} (${subject})`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}: ${error.message}`, error.stack);
      return false;
    }
  }

  async sendQuotationEmail(to: string, recipientName: string, quotation: any): Promise<boolean> {
    const itemsHtml = (quotation.services || [])
      .map(
        (item: any, idx: number) => `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; text-align: left;">${idx + 1}. <strong>${item.name}</strong><br><small style="color: #6b7280;">${item.description || ''}</small></td>
            <td style="padding: 10px; text-align: center;">${item.quantity || 1}</td>
            <td style="padding: 10px; text-align: right;">₹${(item.rate || 0).toLocaleString('en-IN')}</td>
            <td style="padding: 10px; text-align: right; font-weight: bold;">₹${(item.amount || 0).toLocaleString('en-IN')}</td>
          </tr>
        `
      )
      .join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #4f46e5; color: #ffffff; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">HiveRift CRM</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Quotation: ${quotation.quotationNo}</p>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 16px; color: #1f2937;">Dear <strong>${recipientName}</strong>,</p>
          <p style="color: #4b5563; line-height: 1.5;">
            Thank you for your interest in our services. Please find below the breakdown for quotation <strong>${quotation.quotationNo}</strong>.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
            <thead>
              <tr style="background-color: #f3f4f6; border-bottom: 2px solid #d1d5db;">
                <th style="padding: 10px; text-align: left;">Service / Item</th>
                <th style="padding: 10px; text-align: center;">Qty</th>
                <th style="padding: 10px; text-align: right;">Rate</th>
                <th style="padding: 10px; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div style="margin-top: 20px; padding: 15px; background-color: #f9fafb; border-radius: 6px; text-align: right; font-size: 14px;">
            <p style="margin: 4px 0; color: #4b5563;">Subtotal: <strong>₹${(quotation.subtotal || 0).toLocaleString('en-IN')}</strong></p>
            ${quotation.discount ? `<p style="margin: 4px 0; color: #16a34a;">Discount: -₹${quotation.discount.toLocaleString('en-IN')}</p>` : ''}
            <p style="margin: 4px 0; color: #4b5563;">GST/Tax (${quotation.taxPercent || 18}%): <strong>₹${(quotation.taxAmount || 0).toLocaleString('en-IN')}</strong></p>
            <h3 style="margin: 8px 0 0 0; color: #1e1b4b; font-size: 18px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
              Grand Total: ₹${(quotation.totalAmount || 0).toLocaleString('en-IN')}
            </h3>
          </div>

          ${quotation.validUntil ? `<p style="font-size: 13px; color: #6b7280; margin-top: 15px;">Valid until: ${new Date(quotation.validUntil).toLocaleDateString()}</p>` : ''}
          ${quotation.notes ? `<p style="font-size: 13px; color: #4b5563; background: #fffbeb; border: 1px solid #fef3c7; padding: 10px; border-radius: 4px;"><strong>Notes:</strong> ${quotation.notes}</p>` : ''}

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 13px; color: #6b7280; text-align: center;">
            If you have any questions, feel free to reply to this email.<br />
            Best regards,<br />
            <strong>HiveRift Team</strong>
          </p>
        </div>
      </div>
    `;

    return this.sendMail(to, `Quotation ${quotation.quotationNo} from HiveRift`, html);
  }
}
