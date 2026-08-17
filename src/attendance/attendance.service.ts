import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';

@Injectable()
export class AttendanceService {
  constructor(@InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>) {}

  async checkIn(userId: string, notes?: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (existing) throw new ConflictException('Already checked in today');

    const checkInTime = new Date();
    // Office Timing: 10:00 AM cutoff for Present vs Late
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);
    const status = checkInTime > tenAM ? 'late' : 'present';

    return new this.attendanceModel({
      employee: new Types.ObjectId(userId),
      date: today,
      checkIn: checkInTime,
      status,
      notes,
    }).save();
  }

  async checkOut(userId: string): Promise<AttendanceDocument> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attendance = await this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
    if (!attendance) throw new NotFoundException('No check-in found for today');
    if (attendance.checkOut) throw new ConflictException('Already checked out');

    const checkOut = new Date();
    const workingHours = (checkOut.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
    attendance.checkOut = checkOut;
    attendance.workingHours = Math.round(workingHours * 100) / 100;
    return attendance.save();
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

    // Enhance with Late calculation and live hours
    const attendances = rawAttendances.map(a => {
      const obj: any = a.toObject();
      if (obj.checkIn) {
        const checkInDate = new Date(obj.checkIn);
        const shiftStart = new Date(checkInDate);
        shiftStart.setHours(10, 0, 0, 0);

        if (checkInDate > shiftStart) {
          const diffMinutes = Math.floor((checkInDate.getTime() - shiftStart.getTime()) / (1000 * 60));
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          obj.lateDuration = hours > 0 ? `${hours}h ${mins}m` : `${mins} mins`;
          obj.lateMinutes = diffMinutes;
        } else {
          obj.lateDuration = 'On Time';
          obj.lateMinutes = 0;
        }

        // Live working hours if not checked out yet
        if (!obj.checkOut) {
          const now = new Date();
          const liveHours = Math.max(0, (now.getTime() - checkInDate.getTime()) / (1000 * 60 * 60));
          obj.currentLiveHours = Math.round(liveHours * 10) / 10;
        }
      }
      return obj;
    });

    return { attendances, total };
  }

  async getMyAttendance(userId: string): Promise<AttendanceDocument | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.attendanceModel.findOne({ employee: new Types.ObjectId(userId), date: today });
  }

  async getTodaySummary(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDay = new Date(today);
    nextDay.setDate(nextDay.getDate() + 1);

    const summary = await this.attendanceModel.aggregate([
      { $match: { date: { $gte: today, $lt: nextDay } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return summary;
  }

  async getMonthlyReport(year: number, month: number, employeeId?: string): Promise<any> {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const match: any = {
      date: { $gte: startOfMonth, $lte: endOfMonth },
    };
    if (employeeId) match.employee = new Types.ObjectId(employeeId);

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
