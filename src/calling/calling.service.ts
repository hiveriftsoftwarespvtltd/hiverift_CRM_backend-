import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CallingBatch, CallingBatchDocument, CallingContact, CallingContactDocument } from './schemas/calling.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UploadBatchDto, AssignContactsDto, LogCallDto } from './dto/calling.dto';

@Injectable()
export class CallingService {
  constructor(
    @InjectModel(CallingBatch.name) private batchModel: Model<CallingBatchDocument>,
    @InjectModel(CallingContact.name) private contactModel: Model<CallingContactDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private async generateBatchNo(): Promise<string> {
    const year = new Date().getFullYear();
    const batches = await this.batchModel.find({}, { batchNo: 1 }).lean();
    let maxNum = 0;
    for (const b of batches) {
      if (b.batchNo) {
        const match = b.batchNo.match(new RegExp(`BATCH-${year}-(\\d+)`, 'i'));
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.batchModel.findOne({ batchNo: `BATCH-${year}-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `BATCH-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  private async generateLeadId(): Promise<string> {
    const leads = await this.leadModel.find({}, { leadId: 1 }).lean();
    let maxNum = 0;
    for (const l of leads) {
      if (l.leadId) {
        const match = l.leadId.match(/LEAD-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
    }
    let nextNum = maxNum + 1;
    while (await this.leadModel.findOne({ leadId: `LEAD-${String(nextNum).padStart(4, '0')}` })) {
      nextNum++;
    }
    return `LEAD-${String(nextNum).padStart(4, '0')}`;
  }

  async uploadBatch(dto: UploadBatchDto, userId: string): Promise<any> {
    if (!dto.contacts || dto.contacts.length === 0) {
      throw new BadRequestException('Contacts list cannot be empty');
    }

    const batchNo = await this.generateBatchNo();
    const totalNumbers = dto.contacts.length;

    // Determine initial assignment targets
    const targetUsers: string[] = [];
    if (dto.splitAmongUsers && dto.splitAmongUsers.length > 0) {
      targetUsers.push(...dto.splitAmongUsers.filter((u) => !!u));
    } else if (dto.assignedTo) {
      targetUsers.push(dto.assignedTo);
    }

    const assignedCount = targetUsers.length > 0 ? totalNumbers : 0;

    const batch = new this.batchModel({
      batchNo,
      title: dto.title || `Calling Batch ${batchNo}`,
      source: dto.source || 'CSV Upload',
      totalNumbers,
      assignedCount,
      calledCount: 0,
      pendingCount: totalNumbers,
      interestedCount: 0,
      status: 'active',
      createdBy: new Types.ObjectId(userId),
      assignedTo: targetUsers.map((u) => new Types.ObjectId(u)),
    });

    const savedBatch = await batch.save();

    // Prepare contacts with auto-splitting round-robin logic
    const contactDocs: any[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < dto.contacts.length; i++) {
      const item = dto.contacts[i];
      let assignedUser: string | null = null;

      if (targetUsers.length > 0) {
        // Equal round-robin split
        assignedUser = targetUsers[i % targetUsers.length];
      }

      const contactNo = `CALL-${timestamp}-${i + 1}`;

      contactDocs.push({
        contactNo,
        batchId: savedBatch._id,
        name: item.name || 'Prospect',
        phone: String(item.phone).trim(),
        city: item.city || '',
        company: item.company || '',
        requirement: item.requirement || '',
        notes: item.notes || '',
        assignedTo: assignedUser ? new Types.ObjectId(assignedUser) : null,
        assignedBy: assignedUser ? new Types.ObjectId(userId) : null,
        assignedAt: assignedUser ? new Date() : null,
        callStatus: 'pending',
        callHistory: [],
        isConvertedToLead: false,
      });
    }

    await this.contactModel.insertMany(contactDocs);

    return {
      batch: savedBatch,
      totalInserted: contactDocs.length,
      assignedToUsersCount: targetUsers.length,
    };
  }

  async assignOrSplit(dto: AssignContactsDto, userId: string): Promise<any> {
    const { contactIds, batchId, assignToUsers, mode = 'equal_split' } = dto;
    if (!assignToUsers || assignToUsers.length === 0) {
      throw new BadRequestException('At least one user must be selected for assignment');
    }

    let contactsToAssign: CallingContactDocument[] = [];

    if (contactIds && contactIds.length > 0) {
      contactsToAssign = await this.contactModel.find({ _id: { $in: contactIds } });
    } else if (batchId) {
      contactsToAssign = await this.contactModel.find({ batchId: new Types.ObjectId(batchId) });
    }

    if (contactsToAssign.length === 0) {
      throw new NotFoundException('No contacts found to assign');
    }

    // Split contacts across users
    for (let i = 0; i < contactsToAssign.length; i++) {
      const c = contactsToAssign[i];
      const targetUser = assignToUsers[i % assignToUsers.length];
      c.assignedTo = new Types.ObjectId(targetUser);
      c.assignedBy = new Types.ObjectId(userId);
      c.assignedAt = new Date();
      await c.save();
    }

    // If batchId is present, update batch assignedTo list and counts
    if (batchId) {
      const totalInBatch = contactsToAssign.length;
      const uniqueUsers = Array.from(new Set(assignToUsers)).map((u) => new Types.ObjectId(u));
      await this.batchModel.findByIdAndUpdate(batchId, {
        assignedCount: totalInBatch,
        $addToSet: { assignedTo: { $each: uniqueUsers } },
      });
    }

    return {
      message: `Successfully distributed ${contactsToAssign.length} numbers across ${assignToUsers.length} sales executive(s)`,
      totalAssigned: contactsToAssign.length,
    };
  }

  async getMyQueue(userId: string, query: any): Promise<any> {
    const { status, search, page = 1, limit = 50 } = query;
    const filter: any = { assignedTo: new Types.ObjectId(userId) };

    if (status && status !== 'all') {
      if (status === 'completed') {
        filter.callStatus = { $in: ['interested', 'not_interested', 'invalid_wrong_number'] };
      } else {
        filter.callStatus = status;
      }
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [contacts, total, counts] = await Promise.all([
      this.contactModel
        .find(filter)
        .populate('batchId', 'batchNo title source')
        .populate('convertedLeadId', 'leadId status')
        .sort({ callbackTime: 1, updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      this.contactModel.countDocuments(filter),
      this.contactModel.aggregate([
        { $match: { assignedTo: new Types.ObjectId(userId) } },
        { $group: { _id: '$callStatus', count: { $sum: 1 } } },
      ]),
    ]);

    const stats = {
      pending: 0,
      callback: 0,
      interested: 0,
      not_interested: 0,
      ringing_no_answer: 0,
      busy: 0,
      switched_off: 0,
      invalid_wrong_number: 0,
      total: 0,
    };

    counts.forEach((c) => {
      if (stats.hasOwnProperty(c._id)) {
        stats[c._id] = c.count;
      }
      stats.total += c.count;
    });

    return { contacts, total, stats };
  }

  async getAllContacts(query: any): Promise<any> {
    const { batchId, assignedTo, status, search, page = 1, limit = 50 } = query;
    const filter: any = {};

    if (batchId) filter.batchId = new Types.ObjectId(batchId);
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        filter.assignedTo = { $in: [null, undefined] };
      } else {
        filter.assignedTo = new Types.ObjectId(assignedTo);
      }
    }
    if (status && status !== 'all') filter.callStatus = status;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [contacts, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .populate('batchId', 'batchNo title source')
        .populate('assignedTo', 'name email role')
        .populate('assignedBy', 'name email')
        .populate('convertedLeadId', 'leadId status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      this.contactModel.countDocuments(filter),
    ]);

    return { contacts, total };
  }

  async getBatches(query: any): Promise<any> {
    const batches = await this.batchModel
      .find({})
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 });

    return { batches };
  }

  async logCall(id: string, userId: string, dto: LogCallDto): Promise<CallingContactDocument> {
    const contact = await this.contactModel.findById(id);
    if (!contact) throw new NotFoundException('Calling contact not found');

    const previousStatus = contact.callStatus;
    contact.callStatus = dto.status;

    if (dto.callbackTime) {
      contact.callbackTime = new Date(dto.callbackTime);
    }

    const historyItem: any = {
      calledAt: new Date(),
      status: dto.status,
      remark: dto.remark || '',
      calledBy: new Types.ObjectId(userId),
    };
    if (dto.callbackTime) historyItem.callbackTime = new Date(dto.callbackTime);

    contact.callHistory.push(historyItem);
    await contact.save();

    // Recalculate and update batch stats
    if (contact.batchId) {
      const [calledCount, interestedCount, pendingCount] = await Promise.all([
        this.contactModel.countDocuments({
          batchId: contact.batchId,
          callStatus: { $ne: 'pending' },
        }),
        this.contactModel.countDocuments({
          batchId: contact.batchId,
          callStatus: 'interested',
        }),
        this.contactModel.countDocuments({
          batchId: contact.batchId,
          callStatus: 'pending',
        }),
      ]);

      await this.batchModel.findByIdAndUpdate(contact.batchId, {
        calledCount,
        interestedCount,
        pendingCount,
      });
    }

    return contact;
  }

  async convertToLead(contactId: string, userId: string): Promise<any> {
    const contact = await this.contactModel.findById(contactId);
    if (!contact) throw new NotFoundException('Calling contact not found');

    if (contact.isConvertedToLead && contact.convertedLeadId) {
      return { message: 'Contact already converted to Lead', leadId: contact.convertedLeadId };
    }

    const cleanPhone = String(contact.phone || '').replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
      const phoneDigits = cleanPhone.slice(-10);
      const phoneRegex = new RegExp(phoneDigits);
      const existingLead = await this.leadModel.findOne({
        $or: [{ phone: { $regex: phoneRegex } }, { whatsapp: { $regex: phoneRegex } }],
      });

      if (existingLead) {
        contact.isConvertedToLead = true;
        contact.convertedLeadId = existingLead._id as any;
        contact.callStatus = 'interested';
        await contact.save();

        return {
          message: `Lead already exists in CRM (ID: ${existingLead.leadId}, Name: ${existingLead.name}). Contact linked to existing Lead!`,
          lead: existingLead,
        };
      }
    }

    const leadId = await this.generateLeadId();
    const assignedUser = contact.assignedTo || new Types.ObjectId(userId);

    const lead = new this.leadModel({
      leadId,
      name: contact.name && contact.name !== 'Prospect' ? contact.name : `Lead from ${contact.phone}`,
      phone: contact.phone,
      city: contact.city || '',
      company: contact.company || '',
      source: 'calling',
      requirement: contact.requirement || contact.notes || 'Interested via Telecalling batch',
      status: 'interested',
      assignedTo: assignedUser,
      createdBy: new Types.ObjectId(userId),
      notes: [
        {
          text: `Converted from Telecalling contact (${contact.phone}). Initial remark: ${
            contact.callHistory[contact.callHistory.length - 1]?.remark || 'Interested in services'
          }`,
          createdBy: new Types.ObjectId(userId),
          createdAt: new Date(),
        },
      ],
    });

    const savedLead = await lead.save();

    contact.isConvertedToLead = true;
    contact.convertedLeadId = savedLead._id as any;
    contact.callStatus = 'interested';
    await contact.save();

    return {
      message: 'Successfully converted to CRM Sales Lead! 🎯',
      lead: savedLead,
    };
  }

  async getStats(): Promise<any> {
    const [totalContacts, totalCalled, totalPending, totalInterested, totalBatches] = await Promise.all([
      this.contactModel.countDocuments({}),
      this.contactModel.countDocuments({ callStatus: { $ne: 'pending' } }),
      this.contactModel.countDocuments({ callStatus: 'pending' }),
      this.contactModel.countDocuments({ callStatus: 'interested' }),
      this.batchModel.countDocuments({}),
    ]);

    // Agent-wise aggregation
    const salesUsers = await this.userModel
      .find({ role: { $in: ['sales', 'management', 'admin'] } }, { name: 1, email: 1, role: 1 })
      .lean();

    const agentBreakdown = await Promise.all(
      salesUsers.map(async (u) => {
        const [assigned, called, pending, interested, callbacks] = await Promise.all([
          this.contactModel.countDocuments({ assignedTo: u._id }),
          this.contactModel.countDocuments({ assignedTo: u._id, callStatus: { $ne: 'pending' } }),
          this.contactModel.countDocuments({ assignedTo: u._id, callStatus: 'pending' }),
          this.contactModel.countDocuments({ assignedTo: u._id, callStatus: 'interested' }),
          this.contactModel.countDocuments({ assignedTo: u._id, callStatus: 'callback' }),
        ]);

        const conversionRate = called > 0 ? ((interested / called) * 100).toFixed(1) : '0.0';

        return {
          user: u,
          assigned,
          called,
          pending,
          interested,
          callbacks,
          conversionRate,
        };
      }),
    );

    return {
      overview: {
        totalContacts,
        totalCalled,
        totalPending,
        totalInterested,
        totalBatches,
        conversionRate: totalCalled > 0 ? ((totalInterested / totalCalled) * 100).toFixed(1) : '0.0',
      },
      agentBreakdown: agentBreakdown.filter((a) => a.assigned > 0),
    };
  }

  async deleteBatch(id: string): Promise<void> {
    await this.contactModel.deleteMany({ batchId: new Types.ObjectId(id) });
    await this.batchModel.findByIdAndDelete(id);
  }

  async deleteContact(id: string): Promise<void> {
    await this.contactModel.findByIdAndDelete(id);
  }
}
