import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
  PurchaseOrderStatus,
} from './schemas/purchase-order.schema';
import {
  SoftwareLicence,
  SoftwareLicenceDocument,
} from './schemas/software-licence.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
} from '../approvals/schemas/approval-record.schema';
import { GeneralLedgerService } from '../general-ledger/general-ledger.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import {
  AssignSeatDto,
  CreatePurchaseOrderDto,
  CreateSoftwareLicenceDto,
} from './dto/create-po.dto';

@Injectable()
export class ProcurementService {
  constructor(
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(PurchaseOrder.name)
    private poModel: Model<PurchaseOrderDocument>,
    @InjectModel(SoftwareLicence.name)
    private licenceModel: Model<SoftwareLicenceDocument>,
    private approvalsService: ApprovalsService,
    private glService: GeneralLedgerService,
  ) {}

  // ================= VENDORS =================

  async createVendor(userId: string, dto: CreateVendorDto): Promise<VendorDocument> {
    const vendor = new this.vendorModel({
      name: dto.name,
      contactPerson: dto.contactPerson,
      email: dto.email,
      phone: dto.phone,
      gstin: dto.gstin,
      pan: dto.pan,
      category: dto.category,
      paymentTermsDays: dto.paymentTermsDays || 30,
      bankDetails: dto.bankDetails,
      createdBy: new Types.ObjectId(userId),
    });
    return vendor.save();
  }

  async getAllVendors(query: any = {}): Promise<VendorDocument[]> {
    const filter: any = {};
    if (query.category) filter.category = query.category;
    if (query.status) filter.status = query.status;
    return this.vendorModel.find(filter).sort({ name: 1 }).exec();
  }

  async getVendorById(id: string): Promise<VendorDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid vendor ID');
    const vendor = await this.vendorModel.findById(id).exec();
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  // ================= PURCHASE ORDERS =================

  async createPurchaseOrder(
    userId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderDocument> {
    if (!Types.ObjectId.isValid(dto.vendor)) throw new BadRequestException('Invalid vendor ID');

    const vendor = await this.vendorModel.findById(dto.vendor);
    if (!vendor) throw new NotFoundException('Vendor not found');

    let subtotal = 0;
    let taxAmount = 0;

    const items = dto.items.map((item) => {
      const lineSubtotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      const rate = item.taxRate !== undefined ? item.taxRate : 18;
      const lineTax = Math.round((lineSubtotal * (rate / 100)) * 100) / 100;
      const lineTotal = Math.round((lineSubtotal + lineTax) * 100) / 100;

      subtotal += lineSubtotal;
      taxAmount += lineTax;

      return {
        itemName: item.itemName,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: rate,
        taxAmount: lineTax,
        total: lineTotal,
      };
    });

    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    const po = new this.poModel({
      vendor: vendor._id,
      orderDate: new Date(dto.orderDate),
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      totalAmount,
      status: PurchaseOrderStatus.PENDING_APPROVAL,
      notes: dto.notes,
      createdBy: new Types.ObjectId(userId),
    });

    return po.save();
  }

  async getAllPurchaseOrders(query: any = {}): Promise<PurchaseOrderDocument[]> {
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.vendor && Types.ObjectId.isValid(query.vendor)) {
      filter.vendor = new Types.ObjectId(query.vendor);
    }

    return this.poModel
      .find(filter)
      .populate('vendor', 'name vendorId email phone')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async approvePurchaseOrder(
    id: string,
    userId: string,
    notes?: string,
  ): Promise<PurchaseOrderDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid PO ID');

    const po = await this.poModel.findById(id).populate('vendor');
    if (!po) throw new NotFoundException('Purchase order not found');

    po.status = PurchaseOrderStatus.APPROVED;
    po.approvedBy = new Types.ObjectId(userId);
    po.approvedAt = new Date();
    await po.save();

    // Log approval record
    await this.approvalsService.createRequest(userId, {
      entityType: ApprovalEntityType.CUSTOM,
      entityId: po._id.toString(),
      approvalType: 'PURCHASE_ORDER_APPROVAL',
      comments: `PO ${po.poNumber} for ₹${po.totalAmount} approved. ${notes || ''}`,
      metadata: {
        poNumber: po.poNumber,
        totalAmount: po.totalAmount,
        vendor: (po.vendor as any)?.name,
      },
    });

    return po;
  }

  async receiveGoodsAndPostAP(
    id: string,
    userId: string,
  ): Promise<PurchaseOrderDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid PO ID');

    const po = await this.poModel.findById(id).populate('vendor');
    if (!po) throw new NotFoundException('Purchase order not found');

    po.status = PurchaseOrderStatus.RECEIVED;

    // Post Double-Entry AP Journal (P2-08)
    try {
      const accounts = await this.glService.getAllAccounts();
      const apAccount = accounts.find((a) => a.accountCode === '2010'); // Accounts Payable
      const expenseAccount = accounts.find((a) => a.accountCode === '5030') || accounts[0]; // Expense

      if (apAccount && expenseAccount) {
        const journal = await this.glService.createAndPostJournal(userId, {
          entryDate: new Date().toISOString(),
          description: `AP Bill for PO ${po.poNumber} (${(po.vendor as any)?.name || 'Vendor'})`,
          reference: po.poNumber,
          lines: [
            {
              account: expenseAccount._id.toString(),
              debit: po.totalAmount,
              credit: 0,
              description: `Procurement items from PO ${po.poNumber}`,
            },
            {
              account: apAccount._id.toString(),
              debit: 0,
              credit: po.totalAmount,
              description: `Accounts Payable liability for ${po.poNumber}`,
            },
          ],
        });
        po.linkedJournalEntry = journal._id as Types.ObjectId;
      }
    } catch (err) {
      // Continue even if automatic journal fails
    }

    // Update vendor total spend
    await this.vendorModel.findByIdAndUpdate(po.vendor, {
      $inc: { totalSpend: po.totalAmount },
    });

    return po.save();
  }

  // ================= SOFTWARE LICENCES =================

  async createSoftwareLicence(
    userId: string,
    dto: CreateSoftwareLicenceDto,
  ): Promise<SoftwareLicenceDocument> {
    const payload: Partial<SoftwareLicence> = {
      softwareName: dto.softwareName,
      licenceKeyOrPlan: dto.licenceKeyOrPlan || '',
      seatsPurchased: dto.seatsPurchased || 1,
      seatsAssigned: 0,
      billingFrequency: dto.billingFrequency || 'MONTHLY',
      renewalDate: new Date(dto.renewalDate),
      costPerBillingCycle: dto.costPerBillingCycle || 0,
      notes: dto.notes,
      createdBy: new Types.ObjectId(userId),
    };

    if (dto.vendor && Types.ObjectId.isValid(dto.vendor)) {
      payload.vendor = new Types.ObjectId(dto.vendor);
    }

    const licence = new this.licenceModel(payload);
    return licence.save();
  }

  async getAllSoftwareLicences(): Promise<SoftwareLicenceDocument[]> {
    return this.licenceModel
      .find()
      .populate('vendor', 'name vendorId')
      .populate('assignedEmployees.employee', 'name email employeeId department')
      .sort({ renewalDate: 1 })
      .exec();
  }

  async assignSeat(
    licenceId: string,
    dto: AssignSeatDto,
  ): Promise<SoftwareLicenceDocument> {
    if (!Types.ObjectId.isValid(licenceId)) throw new BadRequestException('Invalid licence ID');
    if (!Types.ObjectId.isValid(dto.employeeId)) throw new BadRequestException('Invalid employee ID');

    const licence = await this.licenceModel.findById(licenceId);
    if (!licence) throw new NotFoundException('Licence not found');

    if (licence.seatsAssigned >= licence.seatsPurchased) {
      throw new ConflictException('No available seats left on this licence');
    }

    const alreadyAssigned = licence.assignedEmployees.some(
      (a) => a.employee.toString() === dto.employeeId,
    );
    if (alreadyAssigned) {
      throw new ConflictException('Employee is already assigned a seat on this licence');
    }

    licence.assignedEmployees.push({
      employee: new Types.ObjectId(dto.employeeId),
      assignedAt: new Date(),
    });
    licence.seatsAssigned = licence.assignedEmployees.length;

    return licence.save();
  }

  async getExpiringLicences(daysThreshold: number = 30) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return this.licenceModel
      .find({
        status: 'ACTIVE',
        renewalDate: { $gte: new Date(), $lte: thresholdDate },
      })
      .populate('vendor', 'name contactPerson email phone')
      .sort({ renewalDate: 1 })
      .exec();
  }
}

