import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

export interface UserAccessScope {
  userId: string;
  userObjId: Types.ObjectId;
  userName: string;
  userRole: string;
  isSuperAdmin: boolean;
  isSalesHead: boolean;
  isSalesEmployee: boolean;
}

export function getUserAccessScope(user: any): UserAccessScope {
  if (!user) {
    throw new ForbiddenException('Authentication required to access WhatsApp Campaigns');
  }

  const rawId = user._id ? user._id.toString() : (user.id ? user.id.toString() : '');
  if (!rawId || !Types.ObjectId.isValid(rawId)) {
    throw new ForbiddenException('Invalid user credentials');
  }

  const userId = rawId;
  const userObjId = new Types.ObjectId(rawId);
  const userRole = (user.role || '').toLowerCase().trim();
  const designation = (user.designation || '').toLowerCase().trim();

  // Super Admin: Full system access
  const isSuperAdmin = ['super_admin', 'superadmin', 'admin'].includes(userRole);

  // Sales Head / Manager: Management role, department head flag, or manager/head/director designation
  const isSalesHead = isSuperAdmin ||
                      userRole === 'management' ||
                      Boolean(user.isDepartmentHead) ||
                      designation.includes('manager') ||
                      designation.includes('head') ||
                      designation.includes('director') ||
                      designation.includes('lead');

  // Sales Employee: Regular sales executive
  const isSalesEmployee = !isSalesHead;

  return {
    userId,
    userObjId,
    userName: user.name || 'User',
    userRole,
    isSuperAdmin,
    isSalesHead,
    isSalesEmployee,
  };
}
