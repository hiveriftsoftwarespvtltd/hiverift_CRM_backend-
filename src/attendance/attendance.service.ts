import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Returns minutes from midnight in India Standard Time (Asia/Kolkata)
 */
function getISTMinutes(date: Date): number {
  try {
    const istString = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    return istDate.getHours() * 60 + istDate.getMinutes();
  } catch {
    // Fallback: UTC + 5:30 (330 minutes)
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return (utcMinutes + 330) % 1440;
  }
}

/**
 * Calculates 07:00 PM IST (19:00 Asia/Kolkata) on the date of check-in.
 * 19:00 IST = 13:30 UTC.
 */
function get7PMIST(dateInput: Date | string): Date {
  const date = new Date(dateInput);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);
    return new Date(Date.UTC(year, month - 1, day, 13, 30, 0, 0));
  } catch {
    const d = new Date(date);
    d.setUTCHours(13, 30, 0, 0);
    return d;
  }
}

@Injectable()
export class AttendanceService implements OnModuleInit {
  constructor(
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.autoCheckoutExpiredShifts();
    setInterval(() => {
      this.autoCheckoutExpiredShifts();
    }, 60000); // Auto check-out scanner runs every 60 seconds
  }

  /**
   * Auto Check-Out at 07:00 PM (19:00 IST):
   * Automatically completes shift at 07:00 PM for any employee who checked in but hasn't checked out by 07:00 PM.
   */
  async autoCheckoutExpiredShifts(): Promise<void> {
    try {
      const now = new Date();
      // Find all records where checkOut is null/undefined
      const activeAttendances = await this.attendanceModel.find({
        checkOut: { $exists: false },
      });

      for (const attendance of activeAttendances) {
        if (!attendance.checkIn) continue;

        const checkInDate = new Date(attendance.checkIn);
        const cutoff7PM = get7PMIST(checkInDate);

        if (now.getTime() >= cutoff7PM.getTime()) {
          const autoCheckOutTime = cutoff7PM.getTime() > checkInDate.getTime() ? cutoff7PM : checkInDate;

          // Auto-end active break if employee was on break
          if (attendance.activeBreak && attendance.activeBreak.startTime) {
            const breakStart = new Date(attendance.activeBreak.startTime);
            const breakEnd = breakStart < autoCheckOutTime ? autoCheckOutTime : breakStart;
            const durationMinutes = Math.max(1, Math.round((breakEnd.getTime() - breakStart.getTime()) / (1000 * 60)));
            if (!attendance.breaks) attendance.breaks = [];
            attendance.breaks.push({
              type: attendance.activeBreak.type,
              startTime: attendance.activeBreak.startTime,
              endTime: breakEnd,
              durationMinutes,
            });
            attendance.totalBreakMinutes = attendance.breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
            attendance.activeBreak = undefined;
          }

          // Calculate working hours up to 07:00 PM
          const grossHours = (autoCheckOutTime.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
          const totalBreakHours = (attendance.totalBreakMinutes || 0) / 60;
          const netHours = Math.max(0, grossHours - totalBreakHours);

          attendance.checkOut = autoCheckOutTime;
          attendance.workingHours = Math.round(netHours * 100) / 100;

          if (attendance.workingHours < 4.5 && attendance.status === 'present') {
            attendance.status = 'half_day';
          }

          if (!attendance.notes?.includes('Auto checked out')) {
            attendance.notes = `${attendance.notes || 'Shift: 10:00 AM - 07:00 PM'} (Auto checked out at 07:00 PM)`;
          }

          await attendance.save();
        }
      }
    } catch (err) {
      console.error('Error in autoCheckoutExpiredShifts:', err);
    }
  }

  /**
   * Check In:
   * - Office Timing: 10:00 AM to 07:00 PM (IST)
   * - On-Time cutoff: 10:00 AM IST (600 mins)
   * - Half-Day cutoff: 01:00 PM IST (780 mins)
   * - Rule: 1 Check-In per day. Once checked out, next check-in is only allowed next day.
   */
  async checkIn(userId: string, notes?: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (existing) {
      if (existing.checkOut) {
        throw new ConflictException('Shift already completed for today. Next check-in is available tomorrow.');
      }
      throw new ConflictException('Already checked in for today.');
    }

    const checkInTime = new Date();
    const istMinutes = getISTMinutes(checkInTime);
    const tenAMMinutes = 10 * 60; // 10:00 AM (600 mins)
    const onePMMinutes = 13 * 60; // 01:00 PM (780 mins)

    let status = 'present';
    if (istMinutes > onePMMinutes) {
      status = 'half_day';
    } else if (istMinutes > tenAMMinutes) {
      status = 'late';
    }

    return new this.attendanceModel({
      employee: new Types.ObjectId(userId),
      date: today,
      checkIn: checkInTime,
      status,
      notes: notes || `Shift: 10:00 AM - 07:00 PM`,
    }).save();
  }

  /**
   * Check Out:
   * - Office Timing: 10:00 AM to 07:00 PM
   * - Calculates total working hours
   * - If working hours < 4.5 hrs, mark as half_day
   * - Once checked out, shift is marked complete for today.
   */
  async checkOut(userId: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (!attendance) throw new NotFoundException('No check-in record found for today');
    if (attendance.checkOut) throw new ConflictException('Shift already completed for today. Next check-in available tomorrow.');

    const checkOut = new Date();
    const checkInDate = new Date(attendance.checkIn);
    const cutoff7PM = get7PMIST(checkInDate);

    // Auto-end active break if on break during checkout
    if (attendance.activeBreak && attendance.activeBreak.startTime) {
      const durationMinutes = Math.max(1, Math.round((checkOut.getTime() - new Date(attendance.activeBreak.startTime).getTime()) / (1000 * 60)));
      if (!attendance.breaks) attendance.breaks = [];
      attendance.breaks.push({
        type: attendance.activeBreak.type,
        startTime: attendance.activeBreak.startTime,
        endTime: checkOut,
        durationMinutes,
      });
      attendance.totalBreakMinutes = attendance.breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
      attendance.activeBreak = undefined;
    }

    if (checkOut.getTime() > cutoff7PM.getTime()) {
      // Worked past 7:00 PM - calculate overtime
      const extraMins = Math.round((checkOut.getTime() - cutoff7PM.getTime()) / (1000 * 60));
      const extraH = Math.floor(extraMins / 60);
      const extraM = extraMins % 60;
      let extraStr = '';
      if (extraH > 0 && extraM > 0) extraStr = `${extraH}h ${extraM}m`;
      else if (extraH > 0) extraStr = `${extraH} hrs`;
      else extraStr = `${extraM} mins`;

      const formattedCheckOutTime = checkOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      attendance.overtime = `${extraStr} (${formattedCheckOutTime})`;
      attendance.overtimeMinutes = extraMins;

      // Cap regular checkOut at 7:00 PM
      attendance.checkOut = cutoff7PM;
      const grossHours = (cutoff7PM.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
      const totalBreakHours = (attendance.totalBreakMinutes || 0) / 60;
      attendance.workingHours = Math.round(Math.max(0, grossHours - totalBreakHours) * 100) / 100;
    } else {
      attendance.checkOut = checkOut;
      const grossHours = (checkOut.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
      const totalBreakHours = (attendance.totalBreakMinutes || 0) / 60;
      attendance.workingHours = Math.round(Math.max(0, grossHours - totalBreakHours) * 100) / 100;
    }

    // If worked less than 4.5 hours, mark as half-day
    if (attendance.workingHours < 4.5 && attendance.status === 'present') {
      attendance.status = 'half_day';
    }

    return attendance.save();
  }

  /**
   * Update Extra Time / Overtime manually for an attendance record
   */
  async updateOvertime(id: string, overtime: string, overtimeMinutes?: number): Promise<AttendanceDocument> {
    const attendance = await this.attendanceModel.findById(id);
    if (!attendance) throw new NotFoundException('Attendance record not found');

    attendance.overtime = overtime?.trim() || undefined;
    if (overtimeMinutes !== undefined) {
      attendance.overtimeMinutes = overtimeMinutes;
    }
    return attendance.save();
  }

  /**
   * Start Break:
   * Types: 'Tea Break' | 'Lunch Break' | 'Bio Break' | 'Training' | 'Huddle'
   */
  async startBreak(userId: string, breakType: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (!attendance) throw new NotFoundException('Please check-in first before taking a break');
    if (attendance.checkOut) throw new ConflictException('Shift is already completed for today');
    if (attendance.activeBreak && attendance.activeBreak.startTime) {
      throw new ConflictException(`Already on ${attendance.activeBreak.type}. Please resume work first.`);
    }

    attendance.activeBreak = {
      type: breakType || 'Tea Break',
      startTime: new Date(),
    };

    const saved = await attendance.save();

    // 🔔 Notify Super Admin, Management, and HR
    try {
      const employee = await this.userModel.findById(userId).select('name role department');
      if (employee) {
        const recipients = await this.userModel.find({
          role: { $in: ['admin', 'management', 'hr'] },
          _id: { $ne: new Types.ObjectId(userId) },
        }).select('_id');

        const deptOrRole = employee.department || (employee.role ? employee.role.toUpperCase() : 'Staff');
        const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        for (const recipient of recipients) {
          await this.notificationsService.create({
            userId: recipient._id.toString(),
            title: `${employee.name} is on ${breakType}`,
            message: `${employee.name} (${deptOrRole}) has taken a ${breakType} at ${timeStr}.`,
            type: 'break',
            module: 'attendance',
            referenceId: saved._id.toString(),
          });
        }
      }
    } catch (notifErr) {
      console.error('Error sending break start notification:', notifErr);
    }

    return saved;
  }

  /**
   * End Break / Resume Work:
   * Calculates duration in minutes and adds to breaks history & totalBreakMinutes
   */
  async endBreak(userId: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (!attendance) throw new NotFoundException('No attendance record found for today');
    if (!attendance.activeBreak || !attendance.activeBreak.startTime) {
      throw new ConflictException('No active break found to end');
    }

    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(attendance.activeBreak.startTime).getTime()) / (1000 * 60)));
    const endedBreakType = attendance.activeBreak.type || 'Break';

    if (!attendance.breaks) {
      attendance.breaks = [];
    }

    attendance.breaks.push({
      type: endedBreakType,
      startTime: attendance.activeBreak.startTime,
      endTime: now,
      durationMinutes,
    });

    attendance.totalBreakMinutes = attendance.breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
    attendance.activeBreak = undefined;

    const saved = await attendance.save();

    // 🔔 Notify Super Admin, Management, and HR
    try {
      const employee = await this.userModel.findById(userId).select('name role department');
      if (employee) {
        const recipients = await this.userModel.find({
          role: { $in: ['admin', 'management', 'hr'] },
          _id: { $ne: new Types.ObjectId(userId) },
        }).select('_id');

        const deptOrRole = employee.department || (employee.role ? employee.role.toUpperCase() : 'Staff');

        for (const recipient of recipients) {
          await this.notificationsService.create({
            userId: recipient._id.toString(),
            title: `${employee.name} Resumed Work (${endedBreakType})`,
            message: `${employee.name} (${deptOrRole}) ended ${endedBreakType} after ${durationMinutes} mins. Total break today: ${saved.totalBreakMinutes}m.`,
            type: 'break',
            module: 'attendance',
            referenceId: saved._id.toString(),
          });
        }
      }
    } catch (notifErr) {
      console.error('Error sending break end notification:', notifErr);
    }

    return saved;
  }

  async resetToday(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.attendanceModel.deleteMany({ employee: new Types.ObjectId(userId), date: today });
  }

  async remove(id: string): Promise<void> {
    await this.attendanceModel.findByIdAndDelete(id);
  }

  async resetRecord(id: string): Promise<void> {
    await this.attendanceModel.findByIdAndDelete(id);
  }

  /**
   * Edit Check-In / Check-Out time & status (HR / Super Admin override)
   */
  async editAttendance(
    id: string,
    updateDto: { checkInTime?: string; checkOutTime?: string; status?: string; notes?: string },
  ): Promise<AttendanceDocument> {
    const attendance = await this.attendanceModel.findById(id);
    if (!attendance) throw new NotFoundException('Attendance record not found');

    const parseTime = (str?: string) => {
      if (!str || !str.trim()) return null;
      const s = str.trim();
      const isPM = /pm/i.test(s);
      const isAM = /am/i.test(s);
      const match = s.match(/(\d{1,2}):(\d{2})/);
      if (!match) return null;
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (isPM && h < 12) h += 12;
      if (isAM && h === 12) h = 0;
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
      return { hours: h, minutes: m };
    };

    if (updateDto.checkInTime) {
      const parsed = parseTime(updateDto.checkInTime);
      if (parsed) {
        const newCheckIn = new Date(attendance.checkIn || attendance.date);
        newCheckIn.setHours(parsed.hours, parsed.minutes, 0, 0);
        attendance.checkIn = newCheckIn;

        if (!updateDto.status || updateDto.status === 'auto') {
          const istMinutes = getISTMinutes(newCheckIn);
          if (istMinutes <= 600) {
            attendance.status = 'present';
          } else {
            attendance.status = 'late';
          }
        }
      }
    }

    if (updateDto.checkOutTime) {
      const parsed = parseTime(updateDto.checkOutTime);
      if (parsed) {
        const newCheckOut = new Date(attendance.checkOut || attendance.checkIn || attendance.date);
        newCheckOut.setHours(parsed.hours, parsed.minutes, 0, 0);
        attendance.checkOut = newCheckOut;
      }
    }

    if (attendance.checkIn && attendance.checkOut) {
      const grossHours = (new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) / (1000 * 60 * 60);
      const totalBreakHours = (attendance.totalBreakMinutes || 0) / 60;
      attendance.workingHours = Math.round(Math.max(0, grossHours - totalBreakHours) * 100) / 100;
    }

    if (updateDto.status && updateDto.status !== 'auto') {
      attendance.status = updateDto.status;
    }

    if (!attendance.notes?.includes('(Adjusted by HR/Admin)')) {
      attendance.notes = `${attendance.notes || ''} (Adjusted by HR/Admin)`.trim();
    }

    return attendance.save();
  }

  async findAll(query: any, user: any): Promise<{ attendances: any[]; total: number }> {
    await this.autoCheckoutExpiredShifts();
    const { employee, status, startDate, endDate, date, page = 1, limit = 100 } = query;
    const filter: any = {};

    // Regular Employees see ONLY their own attendance
    if (['sales', 'development', 'digital_marketing'].includes(user?.role)) {
      const uId = user._id ? user._id.toString() : user.id;
      filter.employee = new Types.ObjectId(uId);
    } else if (employee) {
      filter.employee = new Types.ObjectId(employee);
    }

    if (status && status !== 'all') filter.status = status;

    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);
      filter.date = { $gte: d, $lt: nextD };
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const sD = new Date(startDate);
        sD.setHours(0, 0, 0, 0);
        filter.date.$gte = sD;
      }
      if (endDate) {
        const eD = new Date(endDate);
        eD.setHours(23, 59, 59, 999);
        filter.date.$lte = eD;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rawAttendances, total] = await Promise.all([
      this.attendanceModel
        .find(filter)
        .populate('employee', 'name email role department designation')
        .skip(skip)
        .limit(Number(limit))
        .sort({ date: -1, checkIn: -1 }),
      this.attendanceModel.countDocuments(filter),
    ]);

    // Enhance with Late calculation (10:00 AM IST cutoff) and live hours
    const attendances = rawAttendances.map(a => {
      const obj: any = a.toObject();
      if (obj.checkIn) {
        const checkInDate = new Date(obj.checkIn);
        const istMinutes = getISTMinutes(checkInDate);
        const shiftStartMinutes = 10 * 60; // 10:00 AM IST (600 mins)

        if (istMinutes > shiftStartMinutes) {
          const diffMinutes = istMinutes - shiftStartMinutes;
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          obj.lateDuration = hours > 0 ? `${hours}h ${mins}m late` : `${mins}m late`;
          obj.isLate = true;
          // Auto-fix status if it was erroneously set to present
          if (obj.status === 'present') {
            obj.status = istMinutes >= (13 * 60) ? 'half_day' : 'late';
          }
        } else {
          obj.lateDuration = 'On Time';
          obj.isLate = false;
        }

        // Live calculation if still checked in
        if (!obj.checkOut) {
          const now = new Date();
          const currentHours = (now.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
          obj.workingHours = Math.round(currentHours * 100) / 100;
        }
      }
      return obj;
    });

    return { attendances, total };
  }

  async getMyAttendance(userId: string): Promise<AttendanceDocument | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.attendanceModel.findOne({
      employee: new Types.ObjectId(userId),
      date: today,
    });
  }

  async getTodaySummary(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendances = await this.attendanceModel.find({ date: today });
    const present = attendances.filter((a) => a.status === 'present').length;
    const late = attendances.filter((a) => a.status === 'late').length;
    const halfDay = attendances.filter((a) => a.status === 'half_day').length;

    return {
      total: attendances.length,
      present,
      late,
      halfDay,
    };
  }

  async getMonthlyReport(year: number, month: number, employeeId?: string): Promise<any[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const match: any = {
      date: { $gte: startDate, $lte: endDate },
    };

    if (employeeId) {
      match.employee = new Types.ObjectId(employeeId);
    }

    const report = await this.attendanceModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$employee',
          totalDays: { $sum: 1 },
          presentDays: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          lateDays: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          halfDays: { $sum: { $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0] } },
          totalWorkingHours: { $sum: '$workingHours' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'employeeDetails',
        },
      },
      { $unwind: '$employeeDetails' },
      {
        $project: {
          employeeId: '$_id',
          name: '$employeeDetails.name',
          email: '$employeeDetails.email',
          role: '$employeeDetails.role',
          department: '$employeeDetails.department',
          totalDays: 1,
          presentDays: 1,
          lateDays: 1,
          halfDays: 1,
          totalWorkingHours: { $round: ['$totalWorkingHours', 2] },
          avgWorkingHours: {
            $cond: [
              { $gt: ['$totalDays', 0] },
              { $round: [{ $divide: ['$totalWorkingHours', '$totalDays'] }, 2] },
              0,
            ],
          },
        },
      },
      { $sort: { name: 1 } },
    ]);

    return report;
  }
}
