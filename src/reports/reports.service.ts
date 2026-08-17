import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { Renewal, RenewalDocument } from '../renewals/schemas/renewal.schema';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Renewal.name) private renewalModel: Model<RenewalDocument>,
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {} 
  async getSalesReport(query: any) {
    const { startDate, endDate } = query;
    const dateFilter: any = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    const createdAt = Object.keys(dateFilter).length ? dateFilter : undefined;

    const [totalLeads, wonLeads, lostLeads, leadsByStatus, leadsBySource, leadsBySalesUser] = await Promise.all([
      this.leadModel.countDocuments(createdAt ? { createdAt } : {}),
      this.leadModel.countDocuments({ status: 'won', ...(createdAt ? { createdAt } : {}) }),
      this.leadModel.countDocuments({ status: 'lost', ...(createdAt ? { createdAt } : {}) }),
      this.leadModel.aggregate([{ $match: createdAt ? { createdAt } : {} }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.leadModel.aggregate([{ $match: createdAt ? { createdAt } : {} }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
      this.leadModel.aggregate([{ $match: { ...(createdAt ? { createdAt } : {}) } }, { $group: { _id: '$assignedTo', count: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } }, { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }, { $project: { user: { name: 1, email: 1 }, count: 1, won: 1 } }]),
    ]);

    return { totalLeads, wonLeads, lostLeads, conversionRate: totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : 0, leadsByStatus, leadsBySource, leadsBySalesUser };
  }

  async getProjectsReport(query: any) {
    const { startDate, endDate } = query;
    const [totalProjects, projectsByStatus, projectsByDepartment, delayedProjects] = await Promise.all([
      this.projectModel.countDocuments(),
      this.projectModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.projectModel.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }]),
      this.projectModel.countDocuments({ deadline: { $lt: new Date() }, status: { $nin: ['completed', 'cancelled'] } }),
    ]);
    return { totalProjects, projectsByStatus, projectsByDepartment, delayedProjects };
  }

  async getEmployeesReport(query: any) {
    const { month, year } = query;
    const now = new Date();
    const startDate = new Date(year || now.getFullYear(), (month || now.getMonth() + 1) - 1, 1);
    const endDate = new Date(year || now.getFullYear(), (month || now.getMonth() + 1), 0);

    const [totalEmployees, attendanceSummary] = await Promise.all([
      this.userModel.countDocuments({ isActive: true }),
      this.attendanceModel.aggregate([
        { $match: { date: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: { employee: '$employee', status: '$status' }, count: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id.employee', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { 'user.name': 1, 'user.email': 1, '_id.status': 1, count: 1 } },
      ]),
    ]);
    return { totalEmployees, attendanceSummary, month: month || now.getMonth() + 1, year: year || now.getFullYear() };
  }

  async getRenewalsReport(query: any) {
    const [byStatus, total, revenue] = await Promise.all([
      this.renewalModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.renewalModel.countDocuments(),
      this.renewalModel.aggregate([{ $match: { status: 'renewed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    return { byStatus, total, renewalRevenue: revenue[0]?.total || 0 };
  }

  async getFinanceReport(query: any) {
    const summary = await this.paymentModel.aggregate([
      { $group: { _id: '$status', totalInvoice: { $sum: '$invoiceAmount' }, received: { $sum: '$receivedAmount' }, pending: { $sum: '$pendingAmount' } } },
    ]);
    const total = await this.paymentModel.aggregate([
      { $group: { _id: null, totalInvoice: { $sum: '$invoiceAmount' }, received: { $sum: '$receivedAmount' }, pending: { $sum: '$pendingAmount' } } },
    ]);
    return { summary, totals: total[0] || { totalInvoice: 0, received: 0, pending: 0 } };
  }
}
