import { Controller, Get, Put, Delete, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(@CurrentUser() user: any) {
    const result = await this.notificationsService.findAll(user._id.toString());
    return { message: 'Notifications fetched', data: result };
  }

  @Put(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: any) {
    await this.notificationsService.markRead(id, user._id.toString());
    return { message: 'Notification marked read', data: null };
  }

  @Put('read-all')
  async markAllRead(@CurrentUser() user: any) {
    await this.notificationsService.markAllRead(user._id.toString());
    return { message: 'All notifications marked read', data: null };
  }

  @Delete(':id')
  @Roles('admin', 'management')
  async deleteNotification(@Param('id') id: string, @CurrentUser() user: any) {
    const isAdmin = ['admin', 'management', 'super_admin'].includes(user.role);
    if (!isAdmin) {
      throw new ForbiddenException('Only admin can delete notifications');
    }
    await this.notificationsService.delete(id, user._id.toString(), true);
    return { message: 'Notification deleted successfully', data: null };
  }

  @Delete()
  @Roles('admin', 'management')
  async deleteAllNotifications(@CurrentUser() user: any) {
    const isAdmin = ['admin', 'management', 'super_admin'].includes(user.role);
    if (!isAdmin) {
      throw new ForbiddenException('Only admin can delete notifications');
    }
    await this.notificationsService.deleteAll(user._id.toString(), true);
    return { message: 'All notifications deleted successfully', data: null };
  }
}
