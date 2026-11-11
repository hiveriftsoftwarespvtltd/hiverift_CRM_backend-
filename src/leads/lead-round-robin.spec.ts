import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { LeadRoundRobinService } from './lead-round-robin.service';
import { LeadRoundRobin } from './schemas/lead-round-robin.schema';
import { LeadsService } from './leads.service';
import { Lead, LeadSource, LeadStatus } from './schemas/lead.schema';
import { Client } from '../clients/schemas/client.schema';
import { Quotation } from '../quotations/schemas/quotation.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

describe('LeadRoundRobinService & LeadsService Integration', () => {
  describe('LeadRoundRobinService', () => {
    let service: LeadRoundRobinService;
    let counterValue = 0;

    const salesEmpA = { _id: new Types.ObjectId(), name: 'Sales Emp A', email: 'a@hiverift.com' };
    const salesEmpB = { _id: new Types.ObjectId(), name: 'Sales Emp B', email: 'b@hiverift.com' };
    const salesEmpC = { _id: new Types.ObjectId(), name: 'Sales Emp C', email: 'c@hiverift.com' };

    let mockSalesUsers = [salesEmpA, salesEmpB];

    const mockUserModel: any = {
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockSalesUsers),
      })),
    };

    const mockRoundRobinModel: any = {
      findOneAndUpdate: jest.fn(() => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(async () => {
          counterValue += 1;
          return { key: 'default', assignmentCount: counterValue };
        }),
      })),
      updateOne: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ acknowledged: true }),
      })),
    };

    beforeEach(async () => {
      counterValue = 0;
      mockSalesUsers = [salesEmpA, salesEmpB];
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LeadRoundRobinService,
          { provide: getModelToken(User.name), useValue: mockUserModel },
          { provide: getModelToken(LeadRoundRobin.name), useValue: mockRoundRobinModel },
        ],
      }).compile();

      service = module.get<LeadRoundRobinService>(LeadRoundRobinService);
    });

    it('should alternate strictly between 2 sales employees (A -> B -> A -> B)', async () => {
      const first = await service.getNextAssignee();
      const second = await service.getNextAssignee();
      const third = await service.getNextAssignee();
      const fourth = await service.getNextAssignee();

      expect(first?._id).toEqual(salesEmpA._id);
      expect(second?._id).toEqual(salesEmpB._id);
      expect(third?._id).toEqual(salesEmpA._id);
      expect(fourth?._id).toEqual(salesEmpB._id);
    });

    it('should rotate across 3 sales employees (A -> B -> C -> A)', async () => {
      mockSalesUsers = [salesEmpA, salesEmpB, salesEmpC];

      const r1 = await service.getNextAssignee();
      const r2 = await service.getNextAssignee();
      const r3 = await service.getNextAssignee();
      const r4 = await service.getNextAssignee();

      expect(r1?._id).toEqual(salesEmpA._id);
      expect(r2?._id).toEqual(salesEmpB._id);
      expect(r3?._id).toEqual(salesEmpC._id);
      expect(r4?._id).toEqual(salesEmpA._id);
    });

    it('should return null when there are no active sales employees', async () => {
      mockSalesUsers = [];
      const res = await service.getNextAssignee();
      expect(res).toBeNull();
    });
  });

  describe('LeadsService manual vs incoming assignment rules', () => {
    let leadsService: LeadsService;
    const empAId = new Types.ObjectId();
    const empBId = new Types.ObjectId();

    const mockLeadModel: any = jest.fn().mockImplementation((dto) => ({
      ...dto,
      notes: dto.notes || [],
      save: jest.fn().mockResolvedValue({ ...dto, _id: new Types.ObjectId() }),
    }));
    mockLeadModel.find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockLeadModel.findOne = jest.fn().mockResolvedValue(null);
    mockLeadModel.findById = jest.fn();

    const mockUserModel: any = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      findById: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: empBId, name: 'Emp B' }) }),
    };

    const mockRoundRobinService = {
      getNextAssignee: jest.fn(),
    };

    const mockNotificationsService = {
      create: jest.fn().mockResolvedValue(true),
    };

    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LeadsService,
          { provide: getModelToken(Lead.name), useValue: mockLeadModel },
          { provide: getModelToken(Client.name), useValue: {} },
          { provide: getModelToken(Quotation.name), useValue: {} },
          { provide: getModelToken(Payment.name), useValue: {} },
          { provide: getModelToken(User.name), useValue: mockUserModel },
          { provide: NotificationsService, useValue: mockNotificationsService },
          { provide: LeadRoundRobinService, useValue: mockRoundRobinService },
        ],
      }).compile();

      leadsService = module.get<LeadsService>(LeadsService);
    });

    it('should auto-assign public/website incoming leads via Round Robin', async () => {
      mockRoundRobinService.getNextAssignee.mockResolvedValueOnce({ _id: empAId, name: 'Sales Emp A' });

      const lead = await leadsService.createPublicLead({
        name: 'Website Lead 1',
        phone: '9876543210',
        source: 'website',
      });

      expect(mockRoundRobinService.getNextAssignee).toHaveBeenCalledTimes(1);
      expect(lead.assignedTo).toEqual(empAId);
      expect(lead.status).toBe(LeadStatus.ASSIGNED);
      expect(lead.source).toBe(LeadSource.WEBSITE);
    });

    it('should NOT use Round Robin when admin manually creates a lead', async () => {
      const adminId = new Types.ObjectId().toString();
      const manualLead = await leadsService.create(
        { name: 'Manual Lead', phone: '9876543211', source: LeadSource.OTHER } as any,
        adminId,
        { role: 'admin' },
      );

      expect(mockRoundRobinService.getNextAssignee).not.toHaveBeenCalled();
      expect(manualLead.assignedTo).toBeUndefined();
      expect(manualLead.status).toBe(LeadStatus.NEW);
    });
  });
});

