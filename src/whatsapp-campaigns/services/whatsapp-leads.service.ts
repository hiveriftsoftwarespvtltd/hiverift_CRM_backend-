import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as xlsx from 'xlsx';
import * as mammoth from 'mammoth';
const pdfParse = require('pdf-parse');

import { Lead, LeadDocument, LeadSource } from '../../leads/schemas/lead.schema';
import { LeadsService } from '../../leads/leads.service';
import {
  WhatsappImportedLead,
  WhatsappImportedLeadDocument,
} from '../schemas/whatsapp-imported-lead.schema';
import {
  WhatsappImportBatch,
  WhatsappImportBatchDocument,
} from '../schemas/whatsapp-import-batch.schema';
import { CreateImportedLeadDto, UpdateImportedLeadDto } from '../dto/imported-lead.dto';

export function sanitizePhoneNumber(phoneStr?: any): string {
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
export class WhatsappLeadsService {
  private readonly logger = new Logger(WhatsappLeadsService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(WhatsappImportedLead.name)
    private readonly importedLeadModel: Model<WhatsappImportedLeadDocument>,
    @InjectModel(WhatsappImportBatch.name)
    private readonly batchModel: Model<WhatsappImportBatchDocument>,
    private readonly leadsService: LeadsService,
  ) {}

  // ==========================================
  // 1. CRM LEADS (READ-ONLY FOR CAMPAIGNS)
  // ==========================================
  async getCrmLeads(query: any, user: any) {
    const { search, status, source, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (source && source !== 'all') {
      filter.source = source;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      this.leadModel
        .find(filter, {
          name: 1,
          phone: 1,
          email: 1,
          company: 1,
          source: 1,
          status: 1,
          assignedTo: 1,
          createdAt: 1,
          leadId: 1,
        })
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      this.leadModel.countDocuments(filter),
    ]);

    return {
      leads,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  // ==========================================
  // 2. IMPORTED LEADS (SEPARATE DATABASE CRUD)
  // ==========================================
  async getImportedLeads(query: any) {
    const { search, batchId, status, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }

    if (batchId) {
      filter.importBatchId = batchId;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      this.importedLeadModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      this.importedLeadModel.countDocuments(filter),
    ]);

    return {
      leads,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async createImportedLead(dto: CreateImportedLeadDto, userId?: string) {
    const cleanPhone = sanitizePhoneNumber(dto.phoneNumber);
    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new BadRequestException('Phone number must be a valid 10-digit number');
    }

    const existing = await this.importedLeadModel.findOne({ phoneNumber: cleanPhone });
    if (existing) {
      throw new BadRequestException(`An imported lead with phone ${cleanPhone} already exists`);
    }

    const lead = new this.importedLeadModel({
      ...dto,
      phoneNumber: cleanPhone,
      countryCode: dto.countryCode || '91',
      createdBy: userId ? new Types.ObjectId(userId) : undefined,
    });

    return await lead.save();
  }

  async updateImportedLead(id: string, dto: UpdateImportedLeadDto) {
    if (dto.phoneNumber) {
      const cleanPhone = sanitizePhoneNumber(dto.phoneNumber);
      if (!cleanPhone || cleanPhone.length !== 10) {
        throw new BadRequestException('Phone number must be a valid 10-digit number');
      }
      dto.phoneNumber = cleanPhone;
    }

    const updated = await this.importedLeadModel.findByIdAndUpdate(id, { $set: dto }, { new: true });
    if (!updated) {
      throw new NotFoundException('Imported lead not found');
    }
    return updated;
  }

  async deleteImportedLead(id: string) {
    const res = await this.importedLeadModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Imported lead not found');
    return { success: true, message: 'Imported lead deleted successfully' };
  }

  async bulkDeleteImportedLeads(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('No lead IDs provided for deletion');
    }
    const res = await this.importedLeadModel.deleteMany({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } });
    return { success: true, deletedCount: res.deletedCount };
  }

  // ==========================================
  // 3. FILE PARSING & PREVIEW (CSV, XLSX, PDF, TXT, DOCX)
  // ==========================================
  async parseFileForPreview(file: Express.Multer.File): Promise<any> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    let rawRecords: Array<Record<string, any>> = [];
    let detectedHeaders: string[] = [];

    if (ext === 'csv') {
      const content = file.buffer.toString('utf-8');
      const parsed = this.parseCsvString(content);
      rawRecords = parsed.records;
      detectedHeaders = parsed.headers;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const workbook = xlsx.read(file.buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
      rawRecords = json;
      if (json.length > 0) {
        detectedHeaders = Object.keys(json[0]);
      }
    } else if (ext === 'txt') {
      const text = file.buffer.toString('utf-8');
      rawRecords = this.extractEntitiesFromUnstructuredText(text);
      detectedHeaders = ['name', 'phone', 'email', 'company'];
    } else if (ext === 'pdf') {
      const pdfData = await pdfParse(file.buffer);
      const text = pdfData.text || '';
      rawRecords = this.extractEntitiesFromUnstructuredText(text);
      detectedHeaders = ['name', 'phone', 'email', 'company'];
    } else if (ext === 'docx' || ext === 'doc') {
      const docData = await mammoth.extractRawText({ buffer: file.buffer });
      const text = docData.value || '';
      rawRecords = this.extractEntitiesFromUnstructuredText(text);
      detectedHeaders = ['name', 'phone', 'email', 'company'];
    } else {
      throw new BadRequestException(`Unsupported file type (.${ext}). Supported formats: CSV, XLSX, XLS, PDF, TXT, DOCX`);
    }

    // Auto-detect mapped column keys
    const suggestedMapping: Record<string, string> = {};
    for (const header of detectedHeaders) {
      const lower = header.toLowerCase().trim();
      if (!suggestedMapping.phone && (lower.includes('phone') || lower.includes('mobile') || lower.includes('contact') || lower.includes('whatsapp') || lower.includes('cell') || lower.includes('number'))) {
        suggestedMapping.phone = header;
      } else if (!suggestedMapping.name && (lower.includes('name') || lower.includes('customer') || lower.includes('lead') || lower.includes('client'))) {
        suggestedMapping.name = header;
      } else if (!suggestedMapping.email && (lower.includes('email') || lower.includes('mail'))) {
        suggestedMapping.email = header;
      } else if (!suggestedMapping.company && (lower.includes('company') || lower.includes('organization') || lower.includes('business') || lower.includes('firm'))) {
        suggestedMapping.company = header;
      }
    }

    // Identify valid vs invalid sample records
    const phoneKey = suggestedMapping.phone || detectedHeaders.find(h => /phone|mobile/i.test(h)) || 'phone';
    const samplePreview = rawRecords.slice(0, 10);

    let validCount = 0;
    let invalidCount = 0;
    for (const rec of rawRecords) {
      const rawPhone = rec[phoneKey] || rec.phone || rec.mobile || rec.phoneNumber;
      const clean = sanitizePhoneNumber(rawPhone);
      if (clean && clean.length === 10) {
        validCount++;
      } else {
        invalidCount++;
      }
    }

    return {
      fileName: file.originalname,
      fileType: ext,
      totalRowsDetected: rawRecords.length,
      validCount,
      invalidCount,
      headers: detectedHeaders,
      suggestedMapping,
      sampleRecords: samplePreview,
      allRecords: rawRecords.slice(0, 5000), // Safety cap 5000 in memory
    };
  }

  // ==========================================
  // 4. EXECUTE BATCH IMPORT & AUDIT REPORT
  // ==========================================
  async executeImport(
    options: {
      fileName: string;
      fileType: string;
      records: any[];
      fieldMapping: { name?: string; phone?: string; email?: string; company?: string };
      saveToCrm?: boolean;
    },
    user: any,
  ) {
    const { fileName, fileType, records, fieldMapping, saveToCrm = false } = options;

    if (!Array.isArray(records) || records.length === 0) {
      throw new BadRequestException('No records provided for import');
    }

    // STRICT SECURITY CHECK: Super Admin only for saveToCrm
    const userRole = (user?.role || '').toLowerCase().trim();
    const isSuperAdmin = ['super_admin', 'superadmin', 'admin'].includes(userRole);
    const allowSaveToCrm = isSuperAdmin && saveToCrm === true;

    if (saveToCrm && !isSuperAdmin) {
      throw new ForbiddenException('Only Super Admin can save imported leads directly to main CRM Leads.');
    }

    const batchId = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const nameKey = fieldMapping.name || 'name';
    const phoneKey = fieldMapping.phone || 'phone';
    const emailKey = fieldMapping.email || 'email';
    const companyKey = fieldMapping.company || 'company';

    const seenPhonesInBatch = new Set<string>();
    const leadsToInsert: any[] = [];
    const validCrmLeadsToCreate: any[] = [];

    let totalRecords = records.length;
    let duplicateCount = 0;
    let invalidCount = 0;
    let skippedCount = 0;

    // Check existing phone numbers in DB to avoid duplicates
    const allPhones = records
      .map((r) => sanitizePhoneNumber(r[phoneKey] || r.phone || r.phoneNumber))
      .filter((p) => p && p.length === 10);

    const existingImported = await this.importedLeadModel
      .find({ phoneNumber: { $in: allPhones } }, { phoneNumber: 1 })
      .lean();
    const existingPhonesSet = new Set(existingImported.map((e) => e.phoneNumber));

    for (const row of records) {
      const rawPhone = row[phoneKey] || row.phone || row.phoneNumber;
      const cleanPhone = sanitizePhoneNumber(rawPhone);

      if (!cleanPhone || cleanPhone.length !== 10) {
        invalidCount++;
        continue;
      }

      if (seenPhonesInBatch.has(cleanPhone) || existingPhonesSet.has(cleanPhone)) {
        duplicateCount++;
        continue;
      }

      seenPhonesInBatch.add(cleanPhone);

      const rawName = row[nameKey] || row.name || `Lead ${cleanPhone.slice(-4)}`;
      const rawEmail = row[emailKey] || row.email || '';
      const rawCompany = row[companyKey] || row.company || '';

      const importedDoc: any = {
        name: String(rawName).trim(),
        phoneNumber: cleanPhone,
        countryCode: '91',
        email: rawEmail ? String(rawEmail).toLowerCase().trim() : undefined,
        company: rawCompany ? String(rawCompany).trim() : undefined,
        source: `import_${fileType || 'file'}`,
        importBatchId: batchId,
        whatsappOptIn: true,
        whatsappOptInAt: new Date(),
        status: 'active',
        createdBy: user?._id ? new Types.ObjectId(user._id) : undefined,
      };

      leadsToInsert.push(importedDoc);

      if (allowSaveToCrm) {
        validCrmLeadsToCreate.push({
          name: importedDoc.name,
          phone: cleanPhone,
          whatsapp: cleanPhone,
          email: importedDoc.email,
          company: importedDoc.company,
          source: LeadSource.WHATSAPP,
          meetingMode: 'online',
        });
      }
    }

    // 1. Bulk insert to whatsapp_imported_leads
    let savedImportedLeads: any[] = [];
    if (leadsToInsert.length > 0) {
      savedImportedLeads = await this.importedLeadModel.insertMany(leadsToInsert, { ordered: false });
    }

    // 2. If Super Admin opted to save to CRM:
    let crmCreatedCount = 0;
    if (allowSaveToCrm && validCrmLeadsToCreate.length > 0) {
      try {
        const crmResult = await this.leadsService.importLeads(
          validCrmLeadsToCreate,
          user?._id?.toString() || '',
          user,
        );
        crmCreatedCount = crmResult.importedCount;

        // Link CRM Lead IDs back to imported leads where possible
        if (crmResult.data && crmResult.data.length > 0) {
          const updates = crmResult.data.map((crmLead) => {
            return this.importedLeadModel.updateOne(
              { phoneNumber: crmLead.phone, importBatchId: batchId },
              { $set: { crmLeadId: crmLead._id } },
            );
          });
          await Promise.all(updates);
        }
      } catch (crmErr: any) {
        this.logger.error(`CRM sync error during WhatsApp import: ${crmErr.message}`);
      }
    }

    // 3. Save Batch Audit Record
    const batchRecord = new this.batchModel({
      batchId,
      fileName,
      fileType,
      totalRecords,
      importedCount: savedImportedLeads.length,
      duplicateCount,
      invalidCount,
      skippedCount: duplicateCount + invalidCount,
      savedToCrm: allowSaveToCrm,
      crmCreatedCount,
      importedBy: user?._id ? new Types.ObjectId(user._id) : undefined,
      importedByName: user?.name || 'Super Admin',
    });
    await batchRecord.save();

    return {
      success: true,
      batchId,
      report: {
        totalRecords,
        successfullyImported: savedImportedLeads.length,
        duplicateRecords: duplicateCount,
        invalidRecords: invalidCount,
        skippedRecords: duplicateCount + invalidCount,
        savedToCrm: allowSaveToCrm,
        crmCreatedCount,
      },
    };
  }

  // ==========================================
  // 5. BATCH HISTORY & EXPORT
  // ==========================================
  async getImportBatches(query: any) {
    return await this.batchModel.find().sort({ createdAt: -1 }).limit(100).lean();
  }

  async exportImportedLeadsCsv(ids?: string[]) {
    const filter: any = {};
    if (ids && ids.length > 0) {
      filter._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    const leads = await this.importedLeadModel.find(filter).sort({ createdAt: -1 }).lean();
    const rows = leads.map((l) => ({
      Name: l.name,
      Phone: l.phoneNumber,
      Email: l.email || '',
      Company: l.company || '',
      Source: l.source,
      BatchId: l.importBatchId || '',
      Status: l.status,
      CreatedDate: (l as any).createdAt ? new Date((l as any).createdAt).toLocaleDateString() : '',
    }));

    const worksheet = xlsx.utils.json_to_sheet(rows);
    return xlsx.utils.sheet_to_csv(worksheet);
  }

  // --- Helper Methods ---
  private parseCsvString(csvText: string): { headers: string[]; records: any[] } {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], records: [] };

    const splitLine = (line: string): string[] => {
      const res: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          res.push(current.trim());
          current = '';
        } else {
          current += c;
        }
      }
      res.push(current.trim());
      return res;
    };

    const headers = splitLine(lines[0]).map((h) => h.replace(/^["']|["']$/g, '').trim());
    const records: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]);
      const obj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx] !== undefined ? parts[idx].replace(/^["']|["']$/g, '').trim() : '';
      });
      records.push(obj);
    }

    return { headers, records };
  }

  private extractEntitiesFromUnstructuredText(text: string): Array<Record<string, any>> {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const records: Array<Record<string, any>> = [];

    const phoneRegex = /(?:\+?91[\s-]?)?[6-9]\d{9}/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const line of lines) {
      const phones = line.match(phoneRegex);
      const emails = line.match(emailRegex);

      if (phones && phones.length > 0) {
        const phone = sanitizePhoneNumber(phones[0]);
        const email = emails && emails.length > 0 ? emails[0] : '';

        // Extract possible name: take string before phone number or first words
        let remaining = line.replace(phones[0], '').replace(email, '').replace(/[,:;|]/g, ' ').trim();
        const words = remaining.split(/\s+/).filter(w => w.length > 1);
        const name = words.slice(0, 3).join(' ') || `Contact ${phone.slice(-4)}`;
        const company = words.slice(3).join(' ') || '';

        records.push({
          name,
          phone,
          email,
          company,
        });
      }
    }

    return records;
  }
}
