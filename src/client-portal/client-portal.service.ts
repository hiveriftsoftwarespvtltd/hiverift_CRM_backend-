import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import { Ticket, TicketDocument, TicketStatus } from '../tickets/schemas/ticket.schema';
import { Invoice, InvoiceDocument } from '../invoices/schemas/invoice.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalEntityType,
  ApprovalStatus,
} from '../approvals/schemas/approval-record.schema';
import { DeliverableSignoffDto } from './dto/deliverable-signoff.dto';
import { ClientCreateTicketDto } from './dto/client-create-ticket.dto';

@Injectable()
export class ClientPortalService {
  constructor(
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    private approvalsService: ApprovalsService,
  ) {}

  private resolveClientRef(user: any): Types.ObjectId | null {
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.clientRef) {
      return new Types.ObjectId(user.clientRef);
    }
    // If admin/superadmin accessing on behalf of client
    if (['admin', 'management', 'super_admin'].includes(user.role) && user.actingClientId) {
      return new Types.ObjectId(user.actingClientId);
    }
    // For admin/super_admin — return first active client as preview
    if (['admin', 'management', 'super_admin'].includes(user.role)) {
      return null;
    }
    throw new ForbiddenException('User is not associated with any client organization');
  }

  async getOverview(user: any) {
    const clientId = this.resolveClientRef(user);

    // Admin preview — return aggregate stats across all clients
    if (!clientId) {
      const allClients = await this.clientModel.find().select('name company clientId');
      const invoices = await this.invoiceModel.find().select('total amountPaid balance status');
      const totalBilled = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
      const totalPaid = invoices.reduce((sum, inv) => sum + (inv.amountPaid || 0), 0);
      return {
        client: { name: 'All Clients (Admin View)', company: 'HiveRift Admin' },
        metrics: {
          activeProjects: await this.projectModel.countDocuments({ status: { $in: ['active', 'in_progress', 'review', 'planning'] } }),
          pendingDeliverables: 0,
          openTickets: await this.ticketModel.countDocuments({ status: { $in: ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'ESCALATED'] } }),
          totalInvoices: invoices.length,
          financials: { totalBilled, totalPaid, pendingBalance: totalBilled - totalPaid },
        },
        activeProjectsCount: allClients.length,
        pendingDeliverablesCount: 0,
        openTicketsCount: 0,
        unpaidInvoicesBalance: totalBilled - totalPaid,
      };
    }

    const [
      client,
      activeProjectsCount,
      pendingDeliverablesCount,
      openTicketsCount,
      invoices,
    ] = await Promise.all([
      this.clientModel.findById(clientId).select('name company phone email clientId status'),
      this.projectModel.countDocuments({
        client: clientId,
        status: { $nin: ['completed', 'cancelled'] },
      }),
      this.taskModel.countDocuments({
        client: clientId,
        clientReviewRequired: true,
        clientApproved: false,
        status: { $ne: TaskStatus.CANCELLED },
      }),
      this.ticketModel.countDocuments({
        client: clientId,
        status: {
          $in: [
            TicketStatus.OPEN,
            TicketStatus.ASSIGNED,
            TicketStatus.INVESTIGATING,
            TicketStatus.ESCALATED,
          ],
        },
      }),
      this.invoiceModel.find({ client: clientId }).select('total amountPaid balance status'),
    ]);

    const totalBilled = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + (inv.amountPaid || 0), 0);
    const pendingBalance = totalBilled - totalPaid;

    return {
      client,
      activeProjectsCount,
      pendingDeliverablesCount,
      openTicketsCount,
      unpaidInvoicesBalance: pendingBalance,
      metrics: {
        activeProjects: activeProjectsCount,
        pendingDeliverables: pendingDeliverablesCount,
        openTickets: openTicketsCount,
        totalInvoices: invoices.length,
        financials: {
          totalBilled,
          totalPaid,
          pendingBalance,
        },
      },
    };
  }

  async getProjects(user: any) {
    const clientId = this.resolveClientRef(user);
    const filter: any = clientId ? { client: clientId } : {};
    return this.projectModel
      .find(filter)
      .select('name projectId description status priority progress startDate targetDeliveryDate clientReviewUrl createdAt')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getProjectDetails(user: any, projectId: string) {
    const clientId = this.resolveClientRef(user);
    const project = await this.projectModel.findOne({
      _id: new Types.ObjectId(projectId),
      client: clientId,
    });
    if (!project) throw new NotFoundException('Project not found');

    const deliverables = await this.taskModel
      .find({
        project: project._id,
        clientReviewRequired: true,
      })
      .select('title description status deliverableType clientApproved clientSignoffDate clientSignoffNotes publicationUrl dueDate')
      .exec();

    return { project, deliverables };
  }

  async getDeliverables(user: any) {
    const clientId = this.resolveClientRef(user);
    const filter: any = { clientReviewRequired: true };
    if (clientId) filter.client = clientId;
    return this.taskModel
      .find(filter)
      .populate('project', 'name projectId')
      .select('title description status deliverableType clientApproved clientSignoffDate clientSignoffNotes publicationUrl dueDate createdAt')
      .sort({ createdAt: -1 })
      .exec();
  }

  async signoffDeliverable(user: any, taskId: string, dto: DeliverableSignoffDto) {
    const clientId = this.resolveClientRef(user);
    if (!Types.ObjectId.isValid(taskId)) throw new BadRequestException('Invalid task ID');

    const task = await this.taskModel.findOne({
      _id: new Types.ObjectId(taskId),
      client: clientId,
    });

    if (!task) throw new NotFoundException('Deliverable task not found');

    task.clientApproved = dto.approved;
    task.clientSignoffDate = new Date();
    task.clientSignoffNotes = dto.notes || '';
    task.clientSignoffBy = dto.approvedBy || user.name || user.email;

    if (!dto.approved) {
      task.status = TaskStatus.REWORK;
      task.reworkNotes = `Client feedback: ${dto.notes || 'Revisions requested by client'}`;
    } else {
      task.status = TaskStatus.APPROVED;
    }

    if (task.status) {
      task.status = task.status.toUpperCase().replace('-', '_');
    }

    await task.save();

    // Create auditable approval record
    await this.approvalsService.createRequest(user._id.toString(), {
      entityType: ApprovalEntityType.TASK,
      entityId: task._id.toString(),
      approvalType: 'CLIENT_SIGNOFF',
      comments: dto.notes || (dto.approved ? 'Deliverable approved by client' : 'Deliverable revision requested'),
      metadata: {
        clientApproved: dto.approved,
        clientSignoffBy: task.clientSignoffBy,
        taskTitle: task.title,
      },
    });

    return {
      success: true,
      approved: dto.approved,
      message: dto.approved
        ? 'Deliverable successfully approved'
        : 'Deliverable revision request logged and assigned back to team',
      task,
    };
  }

  async getTickets(user: any) {
    const clientId = this.resolveClientRef(user);
    const filter: any = clientId ? { client: clientId } : {};
    return this.ticketModel
      .find(filter)
      .populate('project', 'name projectId')
      .select('ticketNumber ticketId title description priority status category createdAt resolvedAt resolutionNotes resolutionDetails')
      .sort({ createdAt: -1 })
      .exec();
  }

  async createTicket(user: any, dto: ClientCreateTicketDto) {
    const clientId = this.resolveClientRef(user);

    const ticketTitle = dto.title || dto.subject || 'Client Support Request';

    let mappedPriority = (dto.priority || 'MEDIUM').toUpperCase();
    if (mappedPriority === 'URGENT') mappedPriority = 'CRITICAL';
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(mappedPriority)) {
      mappedPriority = 'MEDIUM';
    }

    let mappedCategory = (dto.category || 'TECHNICAL').toUpperCase();
    if (mappedCategory === 'SUPPORT') mappedCategory = 'TECHNICAL';
    if (!['TECHNICAL', 'BILLING', 'ACCOUNT', 'BUG', 'FEATURE_REQUEST', 'OTHER'].includes(mappedCategory)) {
      mappedCategory = 'TECHNICAL';
    }

    const payload: any = {
      title: ticketTitle,
      description: dto.description,
      client: clientId,
      status: TicketStatus.OPEN,
      priority: mappedPriority,
      category: mappedCategory,
      createdBy: new Types.ObjectId(user._id),
    };

    if (dto.project && Types.ObjectId.isValid(dto.project)) {
      payload.project = new Types.ObjectId(dto.project);
    } else {
      const p = await this.projectModel.findOne({ client: clientId });
      if (p) payload.project = p._id;
    }

    const ticket = new this.ticketModel(payload);
    return ticket.save();
  }

  async getInvoices(user: any) {
    const clientId = this.resolveClientRef(user);
    const filter: any = clientId ? { client: clientId } : {};
    return this.invoiceModel
      .find(filter)
      .select('invoiceNumber issueDate dueDate subtotal taxAmount discount total amountPaid balance status currency')
      .sort({ issueDate: -1, createdAt: -1 })
      .exec();
  }
}
