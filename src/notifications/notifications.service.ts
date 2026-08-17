import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>) {}

  async create(data: { userId: string; title: string; message: string; type?: string; module?: string; referenceId?: string }): Promise<NotificationDocument> {
    return new this.notificationModel({ user: data.userId, ...data }).save();
  }

  async findAll(userId: string): Promise<{ notifications: NotificationDocument[]; unreadCount: number }> {
    const [notifications, unreadCount] = await Promise.all([
      this.notificationModel.find({ user: userId }).sort({ createdAt: -1 }).limit(50),
      this.notificationModel.countDocuments({ user: userId, isRead: false }),
    ]);
    return { notifications, unreadCount };
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.notificationModel.findOneAndUpdate({ _id: id, user: userId }, { isRead: true });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany({ user: userId, isRead: false }, { isRead: true });
  }

  async notifyLeadAssigned(salesUserId: string, leadName: string, leadId: string): Promise<void> {
    await this.create({ userId: salesUserId, title: 'New Lead Assigned', message: `Lead "${leadName}" has been assigned to you.`, type: 'lead', module: 'leads', referenceId: leadId });
  }

  async notifyProjectAssigned(techUserId: string, projectName: string, projectId: string): Promise<void> {
    await this.create({ userId: techUserId, title: 'New Project Assigned', message: `Project "${projectName}" has been assigned to you.`, type: 'project', module: 'projects', referenceId: projectId });
  }

  async notifyRenewalDue(salesUserId: string, service: string, daysLeft: number, renewalId: string): Promise<void> {
    await this.create({ userId: salesUserId, title: 'Renewal Due', message: `Service "${service}" renewal is due in ${daysLeft} days.`, type: 'renewal', module: 'renewals', referenceId: renewalId });
  }

  async notifyLeaveApplied(hrAdminId: string, employeeName: string, leaveId: string): Promise<void> {
    await this.create({ userId: hrAdminId, title: 'Leave Application', message: `${employeeName} has applied for leave.`, type: 'leave', module: 'leaves', referenceId: leaveId });
  }
}
