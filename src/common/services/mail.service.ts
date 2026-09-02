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
    const secure = this.configService.get<string>('EMAIL_SECURE') === 'true' || port === 465;
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

  async sendPasswordResetEmail(to: string, name: string, newPass: string, loginUrl: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          @media only screen and (max-width: 600px) {
            .email-wrap { width: 100% !important; padding: 12px !important; }
            .email-content { padding: 16px !important; }
          }
        </style>
      </head>
      <body style="margin: 0; padding: 15px 0; background-color: #f3f4f6; font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center">
              <div class="email-wrap" style="max-width: 600px; width: 100%; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: left;">
                <div style="background-color: #016139; color: #ffffff; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 22px; font-weight: 800;">HiveRift CRM Portal</h1>
                  <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Employee Account Password Reset</p>
                </div>
                <div class="email-content" style="padding: 24px;">
                  <p style="font-size: 15px; color: #1f2937; margin: 0 0 12px 0;">Hello <strong>${name}</strong>,</p>
                  <p style="color: #4b5563; line-height: 1.5; font-size: 14px; margin: 0 0 16px 0;">
                    Your account password for the HiveRift CRM Employee Portal has been updated by the Administrator / HR team.
                  </p>
                  <div style="margin: 16px 0; padding: 14px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #166534; font-weight: bold; text-transform: uppercase;">YOUR LOGIN CREDENTIALS:</p>
                    <p style="margin: 4px 0; font-size: 14px; color: #374151;">Email ID: <strong>${to}</strong></p>
                    <p style="margin: 4px 0; font-size: 14px; color: #374151;">New Password: <strong style="font-size: 15px; color: #016139; background: #ffffff; padding: 3px 8px; border-radius: 4px; border: 1px dashed #10b981;">${newPass}</strong></p>
                  </div>
                  <div style="text-align: center; margin: 22px 0;">
                    <a href="${loginUrl || process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : 'https://crm.hiverift.com/login'}" style="background-color: #016139; color: #ffffff; padding: 11px 22px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">
                      Login to HiveRift Portal →
                    </a>
                  </div>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                  <p style="font-size: 11.5px; color: #9ca3af; text-align: center; margin: 0;">
                    This is an automated notification from HiveRift CRM.
                  </p>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    return this.sendMail(to, 'Your HiveRift CRM Password Has Been Updated', html);
  }

  async sendQuotationEmail(to: string, recipientName: string, quotation: any): Promise<boolean> {
    const targetObj = quotation.client || quotation.lead || {};
    const clientCompany = targetObj.company || '';
    const clientPhone = targetObj.phone || '';
    const issueDate = new Date(quotation.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const validUntil = quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '15 Days';

    // Auto-detect template type
    const isSocialMedia = quotation.templateType === 'social_media' ||
      (quotation.services || []).some((s: any) => /social|meta|reel|instagram|post|marketing/i.test((s.name || '') + ' ' + (s.description || '')));

    const title = isSocialMedia
      ? 'SOCIAL MEDIA MANAGEMENT + META ADS PROPOSAL'
      : 'CUSTOM SOFTWARE DEVELOPMENT & IT SOLUTIONS PROPOSAL';
    const subtitle = isSocialMedia
      ? 'Social Media Management + Meta Ads Campaign'
      : 'Enterprise Web, Mobile & Software Engineering Solutions';
    const subjectPrefix = isSocialMedia ? 'Social Media & Meta Ads Proposal' : 'Custom Software & IT Solutions Proposal';

    const servicesRows = (quotation.services || [])
      .map(
        (item: any, idx: number) => `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 8px; text-align: left; vertical-align: top;">
              <strong style="color: #0f172a; font-size: 13.5px;">${idx + 1}. ${item.name}</strong>
              ${item.description ? `<div style="font-size: 11.5px; color: #64748b; margin-top: 2px; line-height: 1.4;">${item.description}</div>` : ''}
            </td>
            <td style="padding: 10px 6px; text-align: center; font-size: 13px; color: #334155; vertical-align: top; white-space: nowrap;">${item.quantity || 1}</td>
            <td style="padding: 10px 8px; text-align: right; font-weight: bold; color: #198754; font-size: 13.5px; vertical-align: top; white-space: nowrap;">₹${(item.amount || 0).toLocaleString('en-IN')}</td>
          </tr>
        `
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <meta name="x-apple-disable-message-reformatting">
        <style>
          body { margin: 0; padding: 0; background: #f2f4f7; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
          table { border-collapse: collapse; }
          img { border: 0; line-height: 100%; outline: none; text-decoration: none; max-width: 100%; height: auto; }
          @media only screen and (max-width: 620px) {
            .mobile-wrap { width: 100% !important; padding: 8px !important; }
            .mobile-content { padding: 18px 14px !important; }
            .mobile-title { font-size: 18px !important; }
            .mobile-subtitle { font-size: 15px !important; }
            .mobile-key-table td, .mobile-key-table th { padding: 8px 10px !important; font-size: 12.5px !important; display: block !important; width: 100% !important; box-sizing: border-box !important; }
            .mobile-key-table tr { display: block !important; margin-bottom: 8px !important; border: 1px solid #198754 !important; border-radius: 4px !important; }
            .mobile-key-table th { background: #e9f7ef !important; border-bottom: 1px solid #198754 !important; }
            .mobile-key-table td { border: none !important; }
            .mobile-table th, .mobile-table td { padding: 8px 6px !important; font-size: 12px !important; }
            .mobile-bank-card { padding: 14px !important; }
            .mobile-bank-card td { display: block !important; width: 100% !important; padding: 4px 0 !important; }
          }
        </style>
      </head>
      <body style="margin: 0; padding: 12px 0; background: #f2f4f7; font-family: 'Segoe UI', Arial, sans-serif; color: #212121;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="padding: 0;">
              <div class="mobile-wrap" style="max-width: 620px; width: 100%; margin: 0 auto; box-sizing: border-box;">
                <div style="background: #ffffff; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 18px rgba(0,0,0,0.08); text-align: left;">
                  
                  <!-- Top Accent Bar -->
                  <div style="height: 8px; background: #198754; width: 100%;"></div>
                  
                  <!-- Header Banner Image -->
                  <div style="width: 100%; background: #ffffff;">
                    <img src="https://nexifyevents.com/wp-content/uploads/2026/02/Header-1.png" alt="Proposal Header" style="width: 100%; display: block; max-width: 100%;" />
                  </div>

                  <div class="mobile-content" style="padding: 26px 30px;">
                    <div class="mobile-title" style="text-align: center; font-size: 19px; font-weight: 800; color: #111; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">
                      ${title}
                    </div>
                    <div class="mobile-subtitle" style="text-align: center; font-size: 16px; font-weight: 700; color: #198754; margin-bottom: 4px;">
                      ${clientCompany || recipientName}
                    </div>
                    <div style="text-align: center; font-size: 13px; font-weight: 600; color: #64748b; margin-bottom: 20px;">
                      Ref: ${quotation.quotationNo}
                    </div>

                    <!-- Key Info Card Table -->
                    <table class="mobile-key-table" style="width: 100%; border-collapse: collapse; margin-bottom: 22px; font-size: 13px; border: 1px solid #198754; border-radius: 6px; overflow: hidden;">
                      <tr>
                        <th style="width: 28%; border: 1px solid #198754; padding: 9px 12px; background: #e9f7ef; font-weight: 700; text-align: left; color: #166534;">Submitted To</th>
                        <td style="border: 1px solid #198754; padding: 9px 12px; line-height: 1.5; color: #1f2937;">
                          <strong>${clientCompany || recipientName}</strong><br>
                          Client Contact: <strong>${recipientName}</strong><br>
                          ${clientPhone ? `Mobile: ${clientPhone}<br>` : ''}
                          Email: ${to}
                        </td>
                      </tr>
                      <tr>
                        <th style="border: 1px solid #198754; padding: 9px 12px; background: #e9f7ef; font-weight: 700; text-align: left; color: #166534;">Submitted By</th>
                        <td style="border: 1px solid #198754; padding: 9px 12px; line-height: 1.5; color: #1f2937;">
                          <strong>HiveRift Softwares Pvt. Ltd.</strong><br>
                          Website Development | Digital Marketing | SEO | Social Media | Automation<br>
                          Contact: +91 88149 30229 • Email: info@hiverift.com<br>
                          Web: <a href="https://www.hiverift.com" target="_blank" style="color: #198754; font-weight: bold; text-decoration: none;">www.hiverift.com</a>
                        </td>
                      </tr>
                      <tr>
                        <th style="border: 1px solid #198754; padding: 9px 12px; background: #e9f7ef; font-weight: 700; text-align: left; color: #166534;">Date & Validity</th>
                        <td style="border: 1px solid #198754; padding: 9px 12px; color: #1f2937;">
                          Date: <strong>${issueDate}</strong> • Valid Until: <strong style="color: #dc2626;">${validUntil}</strong>
                        </td>
                      </tr>
                    </table>

                    <!-- 1. Introduction -->
                    <div style="font-size: 15px; font-weight: bold; margin-top: 18px; margin-bottom: 8px; padding-left: 8px; border-left: 4px solid #198754; color: #111;">
                      1. INTRODUCTION & PROJECT OBJECTIVES
                    </div>
                    <p style="line-height: 1.6; font-size: 13px; color: #374151; margin: 0 0 10px 0;">
                      We are pleased to present this comprehensive <strong>${title}</strong> for <strong>${clientCompany || recipientName}</strong>.
                    </p>
                    <ul style="padding-left: 18px; font-size: 12.5px; color: #374151; line-height: 1.6; margin: 0 0 18px 0;">
                      ${isSocialMedia ? `
                        <li><strong>Brand Authority:</strong> Professional graphic posts & high-engagement video reels</li>
                        <li><strong>Meta Ads Funnels:</strong> Lead generation & hyper-targeted audience campaigns</li>
                        <li><strong>Active Management:</strong> Captions, hashtags, community engagement & monthly reports</li>
                      ` : `
                        <li><strong>Modern Architecture:</strong> High-performance frontend & scalable backend engineered for enterprise speed</li>
                        <li><strong>Intuitive UX/UI:</strong> Clean, responsive, and cross-platform designs optimized for user conversions</li>
                        <li><strong>Enterprise Security:</strong> Role-based access control, encrypted storage, and automated backups</li>
                        <li><strong>Maintenance Warranty:</strong> 30 days complimentary bug fixing support and cloud deployment</li>
                      `}
                    </ul>

                    <!-- 2. Deliverables & Commercials -->
                    <div style="font-size: 15px; font-weight: bold; margin-top: 18px; margin-bottom: 8px; padding-left: 8px; border-left: 4px solid #198754; color: #111;">
                      2. SCOPE OF WORK & COMMERCIAL DELIVERABLES
                    </div>
                    
                    <table class="mobile-table" style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; border: 1px solid #198754; border-radius: 6px; overflow: hidden;">
                      <thead>
                        <tr style="background: #e9f7ef; color: #166534;">
                          <th style="padding: 9px 8px; text-align: left;">Deliverable Particulars</th>
                          <th style="width: 45px; padding: 9px 6px; text-align: center;">Qty</th>
                          <th style="width: 85px; padding: 9px 8px; text-align: right;">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${servicesRows}
                      </tbody>
                    </table>

                    <!-- Calculation Summary Ledger -->
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; margin-bottom: 18px; font-size: 13px;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="color: #64748b; padding: 3px 0;">Subtotal Base Fee:</td>
                          <td align="right" style="font-weight: bold; color: #1e293b;">₹${(quotation.subtotal || 0).toLocaleString('en-IN')}</td>
                        </tr>
                        ${quotation.discount ? `
                        <tr>
                          <td style="color: #16a34a; padding: 3px 0;">Special Discount:</td>
                          <td align="right" style="font-weight: bold; color: #16a34a;">-₹${quotation.discount.toLocaleString('en-IN')}</td>
                        </tr>` : ''}
                        <tr>
                          <td style="color: #64748b; padding: 3px 0;">GST Tax (${quotation.taxPercent || 18}%):</td>
                          <td align="right" style="font-weight: bold; color: #1e293b;">+₹${(quotation.taxAmount || 0).toLocaleString('en-IN')}</td>
                        </tr>
                        <tr>
                          <td colspan="2" style="border-top: 2px solid #198754; padding-top: 8px; margin-top: 4px;"></td>
                        </tr>
                        <tr>
                          <td style="font-size: 14.5px; font-weight: 800; color: #0f5132;">Total Investment:</td>
                          <td align="right" style="font-size: 16px; font-weight: 900; color: #0f5132;">₹${(quotation.totalAmount || 0).toLocaleString('en-IN')}</td>
                        </tr>
                      </table>
                    </div>

                    <!-- Commercial Notes -->
                    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 14px; border-radius: 4px; color: #66512c; font-size: 12px; margin-bottom: 18px; line-height: 1.5;">
                      📌 <strong>Commercial Terms & Milestones:</strong><br>
                      ${quotation.notes ? quotation.notes : (isSocialMedia ? '• Monthly fee is payable 100% in advance upon kickoff.<br>• Meta Ads budget is managed directly on client\'s Ad Account.' : '• 50% Advance on project kickoff & architecture approval.<br>• 30% on staging testing milestone.<br>• 20% on final handover, production deployment & code transfer.')}
                    </div>

                    <!-- 3. Official Bank Details Card (Fluid for Mobile) -->
                    <div style="font-size: 15px; font-weight: bold; margin-top: 18px; margin-bottom: 8px; padding-left: 8px; border-left: 4px solid #198754; color: #111;">
                      3. OFFICIAL BANK DETAILS FOR PAYMENT
                    </div>
                    <div class="mobile-bank-card" style="background: #0f172a; color: #ffffff; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                      <div style="color: #38bdf8; font-size: 14px; font-weight: bold; border-bottom: 1px solid #334155; padding-bottom: 6px; margin-bottom: 10px;">
                        💳 HiveRift Softwares Pvt Ltd – Bank Details
                      </div>
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 12.5px; color: #f8fafc; line-height: 1.6;">
                        <tr>
                          <td style="color: #94a3b8; width: 40%; padding: 2px 0;">A/C Holder:</td>
                          <td style="font-weight: bold; padding: 2px 0;">HiveRift Software's Pvt Ltd</td>
                        </tr>
                        <tr>
                          <td style="color: #94a3b8; padding: 2px 0;">A/C Number:</td>
                          <td style="font-weight: bold; letter-spacing: 0.5px; color: #f8fafc; padding: 2px 0;">755605000722</td>
                        </tr>
                        <tr>
                          <td style="color: #94a3b8; padding: 2px 0;">IFSC Code:</td>
                          <td style="font-weight: bold; padding: 2px 0;">ICIC0007556</td>
                        </tr>
                        <tr>
                          <td style="color: #94a3b8; padding: 2px 0;">Bank:</td>
                          <td style="font-weight: bold; padding: 2px 0;">ICICI Bank</td>
                        </tr>
                        <tr>
                          <td style="color: #94a3b8; padding: 4px 0 0 0;">Corporate UPI:</td>
                          <td style="font-weight: bold; color: #38bdf8; word-break: break-all; padding: 4px 0 0 0;">MSHIVERIFTSOFTWARESPVTLTD.eazypay@icici</td>
                        </tr>
                      </table>
                    </div>

                    <!-- Footer Sign-off -->
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 20px; text-align: center;">
                      <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">
                        Thank you for your business! To accept this proposal, please reply to this email or make the advance transfer.
                      </p>
                      <p style="font-size: 11px; color: #94a3b8; margin: 0;">
                        HiveRift Softwares Pvt. Ltd. • www.hiverift.com • support@hiverift.com
                      </p>
                    </div>

                  </div>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    return this.sendMail(to, `${subjectPrefix} (${quotation.quotationNo}) – HiveRift`, html);
  }

  async sendInvoiceMail(to: string, invoice: any, customSubject?: string, customMessage?: string): Promise<boolean> {
    const currency = invoice.currency || '₹';
    const itemsHtml = (invoice.items || [])
      .map(
        (item: any, idx: number) => `
        <tr style="border-bottom: 1px solid #f1f5f9; background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 500;">${item.description}</td>
          <td style="padding: 10px 12px; font-size: 13px; color: #475569; text-align: center;">${item.quantity}</td>
          <td style="padding: 10px 12px; font-size: 13px; color: #475569; text-align: right;">${currency}${Number(item.rate || 0).toLocaleString()}</td>
          <td style="padding: 10px 12px; font-size: 13px; color: #0f172a; font-weight: 700; text-align: right;">${currency}${Number(item.amount || 0).toLocaleString()}</td>
        </tr>
      `,
      )
      .join('');

    const formattedDate = invoice.date ? new Date(invoice.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const formattedDueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Due on Receipt';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; }
          .invoice-card { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
          .header { background: #0f172a; padding: 24px 30px; color: #ffffff; display: flex; justify-content: space-between; align-items: center; }
          .content { padding: 30px; }
          .table-header { background: #0f172a; color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <div class="invoice-card">
          <div style="background: #ffffff; padding: 24px 30px; border-bottom: 2px solid #e2e8f0;">
            <table style="width: 100%;">
              <tr>
                <td style="vertical-align: middle;">
                  <img
                    src="${invoice.logo || 'https://hiverift.com/logo.png'}"
                    alt="HiveRift Logo"
                    style="max-height: 55px; max-width: 180px; object-fit: contain; display: block;"
                  />
                </td>
                <td style="text-align: right; vertical-align: middle;">
                  <h2 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; color: #0f172a;">HIVERIFT INVOICE</h2>
                  <p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 700; color: #016139;"># ${invoice.invoiceNo}</p>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding: 24px 30px;">
            ${customMessage ? `<div style="padding: 12px 16px; background: #f0fdf4; border-left: 4px solid #016139; border-radius: 4px; font-size: 13px; color: #166534; margin-bottom: 20px;">${customMessage}</div>` : ''}

            <!-- Sender & Client Info -->
            <table style="width: 100%; margin-bottom: 24px;">
              <tr>
                <td style="width: 50%; vertical-align: top; padding-right: 15px;">
                  <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">From:</div>
                  <div style="font-size: 13px; color: #1e293b; white-space: pre-line; line-height: 1.5; font-weight: 500;">${invoice.from || 'HiveRift Softwares Pvt Ltd'}</div>
                </td>
                <td style="width: 50%; vertical-align: top; padding-left: 15px;">
                  <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Bill To:</div>
                  <div style="font-size: 13px; color: #1e293b; white-space: pre-line; line-height: 1.5; font-weight: 600;">${invoice.billTo}</div>
                  ${invoice.shipTo ? `<div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 8px 0 2px 0;">Ship To:</div><div style="font-size: 12px; color: #475569; white-space: pre-line;">${invoice.shipTo}</div>` : ''}
                </td>
              </tr>
            </table>

            <!-- Meta Data Grid -->
            <table style="width: 100%; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 12px; margin-bottom: 24px; font-size: 12px;">
              <tr>
                <td style="padding: 4px 10px; color: #64748b;">Invoice Date: <strong style="color: #0f172a;">${formattedDate}</strong></td>
                <td style="padding: 4px 10px; color: #64748b;">Due Date: <strong style="color: #0f172a;">${formattedDueDate}</strong></td>
              </tr>
            </table>

            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <thead>
                <tr style="background: #0f172a; color: #ffffff; text-align: left;">
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700;">Item</th>
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: center;">Quantity</th>
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: right;">Rate</th>
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <!-- Summary & Totals -->
            <table style="width: 100%; margin-bottom: 20px;">
              <tr>
                <td style="width: 55%; vertical-align: top; padding-right: 20px;">
                  ${invoice.notes ? `<div style="margin-bottom: 12px;"><strong style="font-size: 12px; color: #334155;">Notes:</strong><p style="margin: 4px 0; font-size: 12px; color: #64748b; line-height: 1.4; white-space: pre-line;">${invoice.notes}</p></div>` : ''}
                  ${invoice.terms ? `<div><strong style="font-size: 12px; color: #334155;">Terms & Conditions:</strong><p style="margin: 4px 0; font-size: 11px; color: #64748b; line-height: 1.4; white-space: pre-line;">${invoice.terms}</p></div>` : ''}
                </td>
                <td style="width: 45%; vertical-align: top;">
                  <table style="width: 100%; font-size: 13px; color: #334155;">
                    <tr>
                      <td style="padding: 4px 0;">Subtotal:</td>
                      <td style="padding: 4px 0; text-align: right; font-weight: 600;">${currency}${Number(invoice.subtotal || 0).toLocaleString()}</td>
                    </tr>
                    ${invoice.taxAmount > 0 ? `
                    <tr>
                      <td style="padding: 4px 0; color: #64748b;">Tax (${invoice.taxRate}%):</td>
                      <td style="padding: 4px 0; text-align: right;">+${currency}${Number(invoice.taxAmount).toLocaleString()}</td>
                    </tr>` : ''}
                    ${invoice.discountAmount > 0 ? `
                    <tr>
                      <td style="padding: 4px 0; color: #dc2626;">Discount:</td>
                      <td style="padding: 4px 0; text-align: right; color: #dc2626;">-${currency}${Number(invoice.discountAmount).toLocaleString()}</td>
                    </tr>` : ''}
                    ${invoice.shipping > 0 ? `
                    <tr>
                      <td style="padding: 4px 0; color: #64748b;">Shipping:</td>
                      <td style="padding: 4px 0; text-align: right;">+${currency}${Number(invoice.shipping).toLocaleString()}</td>
                    </tr>` : ''}
                    <tr style="border-top: 1px solid #cbd5e1; font-weight: 700; font-size: 14px; color: #0f172a;">
                      <td style="padding: 8px 0;">Total:</td>
                      <td style="padding: 8px 0; text-align: right;">${currency}${Number(invoice.total || 0).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; color: #166534;">Amount Paid:</td>
                      <td style="padding: 4px 0; text-align: right; color: #166534; font-weight: 600;">${currency}${Number(invoice.amountPaid || 0).toLocaleString()}</td>
                    </tr>
                    <tr style="border-top: 2px solid #0f172a; font-weight: 800; font-size: 16px; color: #016139;">
                      <td style="padding: 10px 0;">Balance Due:</td>
                      <td style="padding: 10px 0; text-align: right;">${currency}${Number(invoice.balanceDue || 0).toLocaleString()}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Banking Info -->
            <div style="background: #0f172a; border-radius: 8px; padding: 14px 18px; color: #ffffff; font-size: 12px; margin-top: 20px;">
              <strong style="color: #38bdf8; font-size: 13px;">Official Bank Transfer Details:</strong>
              <table style="width: 100%; margin-top: 6px; font-size: 12px; color: #cbd5e1;">
                <tr><td>Account Name:</td><td style="color: #ffffff; font-weight: 600;">HiveRift Software's Pvt Ltd</td></tr>
                <tr><td>Account No:</td><td style="color: #ffffff; font-weight: 600;">755605000722</td></tr>
                <tr><td>IFSC Code:</td><td style="color: #ffffff; font-weight: 600;">ICIC0007556 (ICICI Bank)</td></tr>
                <tr><td>Corporate UPI:</td><td style="color: #38bdf8; font-weight: 600;">MSHIVERIFTSOFTWARESPVTLTD.eazypay@icici</td></tr>
              </table>
            </div>

            <div style="margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8;">
              HiveRift Softwares Pvt Ltd • info@hiverift.com • +91 9667106291
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const subject = customSubject || `Invoice #${invoice.invoiceNo} from HiveRift Softwares Pvt Ltd`;
    return this.sendMail(to, subject, html);
  }
}
