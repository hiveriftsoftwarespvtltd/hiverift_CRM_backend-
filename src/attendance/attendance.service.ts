import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';

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

@Injectable()
export class AttendanceService {
  constructor(@InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>) {}

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
    const workingHours = (checkOut.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
    attendance.checkOut = checkOut;
    attendance.workingHours = Math.round(workingHours * 100) / 100;

    // If worked less than 4.5 hours, mark as half-day
    if (attendance.workingHours < 4.5 && attendance.status === 'present') {
      attendance.status = 'half_day';
    }

    return attendance.save();
  }

  async resetToday(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.attendanceModel.deleteMany({ employee: new Types.ObjectId(userId), date: today });
  }

  async remove(id: string): Promise<void> {
    await this.attendanceModel.findByIdAndDelete(id);
  }

  async findAll(query: any, user: any): Promise<{ attendances: any[]; total: number }> {
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
