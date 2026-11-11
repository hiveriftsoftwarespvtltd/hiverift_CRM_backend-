import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaService } from './meta.service';
import { Lead, LeadSource, LeadStatus } from '../leads/schemas/lead.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadRoundRobinService } from '../leads/lead-round-robin.service';

describe('Meta Webhook Integration Tests', () => {
  let webhookService: MetaWebhookService;
  let metaService: MetaService;
  let configService: ConfigService;

  const mockVerifyToken = 'hivecrm_webhook_2026_secure';
  const mockAppSecret = '02dc7cef4043989bb5d52c5a5b7fbd66';

  const mockLeadModel: any = jest.fn().mockImplementation((dto) => ({
    ...dto,
    save: jest.fn().mockResolvedValue({ ...dto, _id: 'mock_lead_obj_id' }),
  }));
  mockLeadModel.findOne = jest.fn();
  mockLeadModel.find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

  const mockUserModel: any = {
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'admin_1' }]) }),
  };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue(true),
  };

  const mockMetaService = {
    getLeadDetails: jest.fn(),
    sendWhatsAppTextMessage: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'META_VERIFY_TOKEN') return mockVerifyToken;
      if (key === 'META_WEBHOOK_VERIFY_TOKEN') return mockVerifyToken;
      if (key === 'META_APP_SECRET') return mockAppSecret;
      if (key === 'META_PAGE_ACCESS_TOKEN') return 'mock_page_token';
      if (key === 'META_GRAPH_API_VERSION') return 'v20.0';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaWebhookService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MetaService, useValue: mockMetaService },
        { provide: getModelToken(Lead.name), useValue: mockLeadModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    webhookService = module.get<MetaWebhookService>(MetaWebhookService);
    metaService = module.get<MetaService>(MetaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('1. Webhook Verification (GET /api/v1/meta/webhook)', () => {
    it('should return hub.challenge on successful verification', () => {
      const challenge = '1158201444';
      const result = webhookService.verifyWebhook('subscribe', mockVerifyToken, challenge);
      expect(result).toBe(challenge);
    });

    it('should throw ForbiddenException if verify token is invalid', () => {
      expect(() => {
        webhookService.verifyWebhook('subscribe', 'wrong_token', '1158201444');
      }).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if hub.mode is not subscribe', () => {
      expect(() => {
        webhookService.verifyWebhook('unsubscribe', mockVerifyToken, '1158201444');
      }).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if parameters are missing', () => {
      expect(() => {
        webhookService.verifyWebhook(undefined, undefined, undefined);
      }).toThrow(ForbiddenException);
    });
  });

  describe('2. Webhook Signature Verification (X-Hub-Signature-256)', () => {
    const rawPayload = JSON.stringify({
      object: 'page',
      entry: [{ id: '1229106056948250', time: 1715420000 }],
    });

    it('should return true for valid HMAC SHA-256 signature', () => {
      const hmac = crypto.createHmac('sha256', mockAppSecret);
      const computedHash = hmac.update(rawPayload).digest('hex');
      const signatureHeader = `sha256=${computedHash}`;

      const isValid = webhookService.verifySignature(rawPayload, signatureHeader);
      expect(isValid).toBe(true);
    });

    it('should return false for invalid or tampered HMAC SHA-256 signature', () => {
      const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
      const isValid = webhookService.verifySignature(rawPayload, invalidSignature);
      expect(isValid).toBe(false);
    });

    it('should return false if X-Hub-Signature-256 header is missing when app secret is set', () => {
      const isValid = webhookService.verifySignature(rawPayload, undefined);
      expect(isValid).toBe(false);
    });

    it('should return false if header format is malformed', () => {
      const malformed = 'invalid_format_without_sha256';
      const isValid = webhookService.verifySignature(rawPayload, malformed);
      expect(isValid).toBe(false);
    });
  });

  describe('3. Facebook Lead Ad Event Ingestion (POST /api/v1/meta/webhook)', () => {
    it('should extract leadgen_id, fetch Graph API, map fields, and save lead with Facebook Ads source', async () => {
      const leadgenId = '9876543210123456';

      // Mock: Lead does not exist yet
      mockLeadModel.findOne.mockResolvedValue(null);

      // Mock: Graph API returns rich lead details
      mockMetaService.getLeadDetails.mockResolvedValue({
        id: leadgenId,
        created_time: '2026-11-11T04:30:00+0000',
        campaign_name: 'Summer Growth Campaign',
        campaign_id: 'camp_001',
        form_name: 'Contact Us Form',
        form_id: 'form_001',
        ad_name: 'Promo Ad #1',
        ad_id: 'ad_001',
        platform: 'fb',
        field_data: [
          { name: 'full_name', values: ['Aarav Patel'] },
          { name: 'phone_number', values: ['+919876543210'] },
          { name: 'email', values: ['aarav.patel@example.com'] },
          { name: 'company_name', values: ['Patel Tech Solutions'] },
          { name: 'city', values: ['Mumbai'] },
          { name: 'service_required', values: ['Custom ERP Software'] },
        ],
      });

      const savedResult = await webhookService.processLeadgenId(leadgenId, {
        page_id: 'page_123',
        form_id: 'form_001',
        campaign_id: 'camp_001',
      });

      expect(savedResult).toBeDefined();
      expect(mockMetaService.getLeadDetails).toHaveBeenCalledWith(leadgenId);
      expect(savedResult?.name).toBe('Aarav Patel');
      expect(savedResult?.phone).toBe('9876543210');
      expect(savedResult?.email).toBe('aarav.patel@example.com');
      expect(savedResult?.company).toBe('Patel Tech Solutions');
      expect(savedResult?.city).toBe('Mumbai');
      expect(savedResult?.source).toBe(LeadSource.FACEBOOK_ADS);
      expect(savedResult?.status).toBe(LeadStatus.NEW);
      expect(savedResult?.metaLeadId).toBe(leadgenId);
      expect(savedResult?.requirement).toContain('service_required: Custom ERP Software');
    });
  });

  describe('4. Duplicate Lead Prevention (Idempotency)', () => {
    it('should return existing lead and skip Graph API / creation when same leadgen_id arrives again', async () => {
      const leadgenId = 'dup_leadgen_12345';
      const existingLeadDoc = {
        _id: 'existing_lead_id',
        leadId: 'LEAD-0015',
        name: 'Existing Customer',
        phone: '9876543210',
        metaLeadId: leadgenId,
        source: LeadSource.FACEBOOK_ADS,
        status: LeadStatus.NEW,
      };

      // Primary check finds lead already exists
      mockLeadModel.findOne.mockResolvedValueOnce(existingLeadDoc);

      const result = await webhookService.processLeadgenId(leadgenId);

      expect(result).toBe(existingLeadDoc);
      // Graph API should NOT be called when lead already exists
      expect(mockMetaService.getLeadDetails).not.toHaveBeenCalled();
    });
  });

  describe('5. Meta Graph API Failure Handling', () => {
    it('should gracefully handle Graph API failure without throwing unhandled exceptions', async () => {
      const leadgenId = 'fail_leadgen_99999';

      mockLeadModel.findOne.mockResolvedValue(null);
      // Graph API returns null (e.g. invalid permissions or 5xx)
      mockMetaService.getLeadDetails.mockResolvedValue(null);

      const result = await webhookService.processLeadgenId(leadgenId, {
        page_id: 'page_999',
        form_id: 'form_999',
        campaign_id: 'camp_999',
      });

      expect(result).toBeDefined();
      expect(result?.metaLeadId).toBe(leadgenId);
      expect(result?.source).toBe(LeadSource.FACEBOOK_ADS);
      expect(result?.status).toBe(LeadStatus.NEW);
    });
  });

  describe('6. Round Robin Auto-Assignment on Facebook Ads & WhatsApp Leads', () => {
    it('should alternate Facebook Ads and WhatsApp leads across sales employees via LeadRoundRobinService', async () => {
      const empA = { _id: 'sales_emp_a' as any, name: 'Sales A' };
      const empB = { _id: 'sales_emp_b' as any, name: 'Sales B' };
      const mockRoundRobinService = {
        getNextAssignee: jest
          .fn()
          .mockResolvedValueOnce(empA)
          .mockResolvedValueOnce(empB),
      };

      const moduleWithRR: TestingModule = await Test.createTestingModule({
        providers: [
          MetaWebhookService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: MetaService, useValue: mockMetaService },
          { provide: getModelToken(Lead.name), useValue: mockLeadModel },
          { provide: getModelToken(User.name), useValue: mockUserModel },
          { provide: NotificationsService, useValue: mockNotificationsService },
          { provide: LeadRoundRobinService, useValue: mockRoundRobinService },
        ],
      }).compile();

      const svcWithRR = moduleWithRR.get<MetaWebhookService>(MetaWebhookService);
      mockLeadModel.findOne.mockResolvedValue(null);
      mockMetaService.getLeadDetails.mockResolvedValueOnce({
        id: 'fb_rr_1',
        field_data: [
          { name: 'full_name', values: ['FB Lead 1'] },
          { name: 'phone_number', values: ['+919999900001'] },
        ],
      });

      const fbLead = await svcWithRR.processLeadgenId('fb_rr_1');
      expect(fbLead?.assignedTo).toBe(empA._id);
      expect(fbLead?.status).toBe(LeadStatus.ASSIGNED);

      const waLead = await svcWithRR.processWhatsAppMessage(
        { wa_id: '919999900002', profile: { name: 'WA Lead 2' } },
        { id: 'wamid.2', from: '919999900002', type: 'text', text: { body: 'Hi' } },
      );
      expect(waLead?.assignedTo).toBe(empB._id);
      expect(waLead?.status).toBe(LeadStatus.ASSIGNED);
      expect(mockRoundRobinService.getNextAssignee).toHaveBeenCalledTimes(2);
    });
  });
});

