import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MonitoringDevice, MonitoringDeviceDocument } from './schemas/monitoring-device.schema';
import { MonitoringHeartbeat, MonitoringHeartbeatDocument } from './schemas/monitoring-heartbeat.schema';
import { MonitoringAppSession, MonitoringAppSessionDocument } from './schemas/monitoring-app-session.schema';
import { MonitoringActivity, MonitoringActivityDocument } from './schemas/monitoring-activity.schema';
import { MonitoringPolicy, MonitoringPolicyDocument } from './schemas/monitoring-policy.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Attendance, AttendanceDocument } from '../attendance/schemas/attendance.schema';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { SyncActivityDto } from './dto/sync-activity.dto';
import * as crypto from 'crypto';

@Injectable()
export class MonitoringService {
  constructor(
    @InjectModel(MonitoringDevice.name) private deviceModel: Model<MonitoringDeviceDocument>,
    @InjectModel(MonitoringHeartbeat.name) private heartbeatModel: Model<MonitoringHeartbeatDocument>,
    @InjectModel(MonitoringAppSession.name) private appSessionModel: Model<MonitoringAppSessionDocument>,
    @InjectModel(MonitoringActivity.name) private activityModel: Model<MonitoringActivityDocument>,
    @InjectModel(MonitoringPolicy.name) private policyModel: Model<MonitoringPolicyDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Attendance.name) private attendanceModel: Model<AttendanceDocument>,
  ) {}

  // Helper to categorize applications
  private categorizeApp(appName: string, processName: string): string {
    const text = `${appName} ${processName}`.toLowerCase();
    if (/code|visual studio|sublime|atom|webstorm|intellij|eclipse|github|gitlab|terminal|powershell|cmd|bash|postman|dbeaver|mongodb/i.test(text)) {
      return 'development';
    }
    if (/slack|teams|zoom|skype|discord|telegram|whatsapp|outlook|thunderbird|mail/i.test(text)) {
      return 'communication';
    }
    if (/excel|word|powerpoint|sheets|docs|notion|trello|jira|figma|canva|photoshop|illustrator|acrobat|pdf/i.test(text)) {
      return 'productivity';
    }
    if (/chrome|msedge|firefox|safari|brave|opera/i.test(text)) {
      return 'browsing';
    }
    if (/explorer|taskmgr|settings|notepad|calculator/i.test(text)) {
      return 'utilities';
    }
    return 'other';
  }

  // 1. Generate pairing token for logged-in employee
  async generatePairingToken(employeeId: string) {
    const employee = await this.userModel.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const pairingToken = `HR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let device = await this.deviceModel.findOne({ employee: new Types.ObjectId(employeeId) });
    if (device) {
      device.pairingToken = pairingToken;
      device.tokenExpiresAt = tokenExpiresAt;
      await device.save();
    } else {
      device = new this.deviceModel({
        deviceId: `DEV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        employee: new Types.ObjectId(employeeId),
        pairingToken,
        tokenExpiresAt,
        status: 'disconnected',
        deviceSecret: crypto.randomBytes(16).toString('hex'),
      });
      await device.save();
    }

    return {
      pairingToken,
      expiresAt: tokenExpiresAt,
      employeeName: employee.name,
      employeeId: employee.employeeId || employee._id,
      deviceId: device.deviceId,
    };
  }

  // 2. Register Device from Desktop Agent
  async registerDevice(dto: RegisterDeviceDto, ipAddress?: string) {
    const token = dto.pairingToken?.trim().toUpperCase();
    if (!token) throw new BadRequestException('Pairing token is required');

    const device = await this.deviceModel
      .findOne({
        pairingToken: token,
        tokenExpiresAt: { $gt: new Date() },
      })
      .populate('employee', 'name email department role employeeId');

    if (!device) {
      throw new UnauthorizedException('Invalid or expired pairing token. Please generate a new token in your CRM portal.');
    }

    const deviceSecret = crypto.randomBytes(24).toString('hex');
    device.deviceName = dto.deviceName || 'Windows PC';
    device.os = dto.os || 'Windows';
    device.agentVersion = dto.agentVersion || '1.0.0';
    device.ipAddress = ipAddress || '';
    device.status = 'connected';
    device.lastHeartbeat = new Date();
    device.deviceSecret = deviceSecret;
    device.pairingToken = ''; // Clear used token

    if (dto.deviceId) {
      device.deviceId = dto.deviceId;
    }

    await device.save();

    const employee = device.employee as any;
    return {
      success: true,
      message: 'HiveRift Monitoring Agent registered successfully',
      deviceId: device.deviceId,
      deviceSecret,
      employeeId: employee?._id,
      employeeName: employee?.name,
      department: employee?.department || employee?.role,
    };
  }

  // 3. Check device status for current employee
  async getDeviceStatus(employeeId: string) {
    const device = await this.deviceModel
      .findOne({ employee: new Types.ObjectId(employeeId) })
      .sort({ updatedAt: -1 });

    if (!device) {
      return {
        isRegistered: false,
        isConnected: false,
        status: 'not_registered',
      };
    }

    const now = Date.now();
    const lastPing = device.lastHeartbeat ? new Date(device.lastHeartbeat).getTime() : 0;
    const isLive = now - lastPing <= 60 * 1000; // within 60s

    return {
      isRegistered: true,
      isConnected: device.status === 'connected' && isLive,
      status: device.status === 'connected' && isLive ? 'online' : 'offline',
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      lastHeartbeat: device.lastHeartbeat,
      agentVersion: device.agentVersion,
    };
  }

  // 4. Record Heartbeat from Agent
  async recordHeartbeat(dto: HeartbeatDto) {
    const device = await this.deviceModel.findOne({
      deviceId: dto.deviceId,
      deviceSecret: dto.deviceSecret,
      status: { $ne: 'revoked' },
    });

    if (!device) {
      throw new UnauthorizedException('Unauthorized device. Please re-register the monitoring agent.');
    }

    const status = dto.status || 'active';
    device.lastHeartbeat = new Date();
    device.status = 'connected';
    await device.save();

    const heartbeat = new this.heartbeatModel({
      device: device._id,
      employee: device.employee,
      status,
      currentApp: dto.currentApp || '',
      windowTitle: dto.windowTitle || '',
      idleSeconds: dto.idleSeconds || 0,
      timestamp: new Date(),
    });

    await heartbeat.save();
    return { success: true, timestamp: new Date() };
  }

  // 5. Batch Sync Application Sessions & Activity
  async syncActivity(dto: SyncActivityDto) {
    const device = await this.deviceModel.findOne({
      deviceId: dto.deviceId,
      deviceSecret: dto.deviceSecret,
      status: { $ne: 'revoked' },
    });

    if (!device) {
      throw new UnauthorizedException('Unauthorized device');
    }

    const sessions = dto.sessions || [];
    if (sessions.length > 0) {
      const docsToInsert = sessions.map((s) => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        const durationSec = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
        const durationMin = Number((durationSec / 60).toFixed(2));
        const dateStr = start.toISOString().split('T')[0];
        const category = s.category || this.categorizeApp(s.appName, s.processName);

        return {
          device: device._id,
          employee: device.employee,
          appName: s.appName || s.processName || 'Application',
          processName: s.processName || '',
          windowTitle: s.windowTitle || '',
          category,
          startTime: start,
          endTime: end,
          durationSeconds: durationSec,
          durationMinutes: durationMin,
          date: dateStr,
        };
      });

      await this.appSessionModel.insertMany(docsToInsert);

      // Aggregate for today
      const todayStr = new Date().toISOString().split('T')[0];
      await this.aggregateDailyActivity(device.employee.toString(), todayStr);
    }

    return { success: true, syncedCount: sessions.length };
  }

  // Helper: Aggregate daily activity for an employee
  async aggregateDailyActivity(employeeId: string, dateStr: string) {
    const empObjId = new Types.ObjectId(employeeId);

    // 1. Get all app sessions for date
    const sessions = await this.appSessionModel.find({
      employee: empObjId,
      date: dateStr,
    });

    const totalActiveMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    // 2. Group apps by name
    const appMap = new Map<string, { durationMinutes: number; category: string }>();
    for (const s of sessions) {
      const existing = appMap.get(s.appName) || { durationMinutes: 0, category: s.category };
      existing.durationMinutes += s.durationMinutes || 0;
      appMap.set(s.appName, existing);
    }

    const topApplications = Array.from(appMap.entries())
      .map(([appName, data]) => ({
        appName,
        durationMinutes: Number(data.durationMinutes.toFixed(1)),
        percentage: totalActiveMinutes > 0 ? Math.round((data.durationMinutes / totalActiveMinutes) * 100) : 0,
        category: data.category,
      }))
      .sort((a, b) => b.durationMinutes - a.durationMinutes);

    // 3. Get Attendance for date
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    const attendance = await this.attendanceModel.findOne({
      employee: empObjId,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    const totalBreakMinutes = attendance?.totalBreakMinutes || 0;
    const workingHours = attendance?.workingHours || 0;
    const totalShiftMinutes = Math.round(workingHours * 60);

    const totalIdleMinutes = Math.max(0, totalShiftMinutes - totalActiveMinutes - totalBreakMinutes);

    // 4. Calculate multi-factor productivity score
    // Factors: Active ratio (45%), Shift completed (35%), Break adherence (20%)
    let score = 0;
    if (totalShiftMinutes > 0) {
      const activeRatio = Math.min(1, totalActiveMinutes / (totalShiftMinutes * 0.8)); // 80% active considered 100% productive
      const breakPenalty = totalBreakMinutes > 60 ? Math.max(0, 1 - (totalBreakMinutes - 60) / 60) : 1;
      score = Math.min(100, Math.round((activeRatio * 70 + breakPenalty * 30)));
    } else if (totalActiveMinutes > 0) {
      score = Math.min(100, Math.round((totalActiveMinutes / 480) * 100)); // out of 8h standard shift
    }

    await this.activityModel.findOneAndUpdate(
      { employee: empObjId, date: dateStr },
      {
        totalActiveMinutes: Number(totalActiveMinutes.toFixed(1)),
        totalIdleMinutes: Number(totalIdleMinutes.toFixed(1)),
        totalBreakMinutes,
        totalShiftMinutes,
        productivityScore: score,
        topApplications,
      },
      { upsert: true, new: true },
    );
  }

  // 6. Admin WFH Dashboard Summary Stats
  async getDashboardStats(user?: any) {
    const devices = await this.deviceModel
      .find({ status: { $ne: 'revoked' } })
      .populate('employee', 'name email department role avatar employeeId');

    const totalWfhEmployees = devices.length;
    const now = Date.now();

    let onlineCount = 0;
    let offlineCount = 0;

    // Check heartbeats in the last 15 minutes
    const cutoffTime = new Date(now - 15 * 60 * 1000);
    const recentHeartbeats = await this.heartbeatModel.aggregate([
      { $match: { timestamp: { $gte: cutoffTime } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$employee',
          latestStatus: { $first: '$status' },
          latestApp: { $first: '$currentApp' },
          timestamp: { $first: '$timestamp' },
        },
      },
    ]);

    const onlineEmpMap = new Map<string, any>();
    for (const h of recentHeartbeats) {
      onlineEmpMap.set(h._id.toString(), h);
    }

    // Get today's attendance records with wide 24h buffer for UTC/IST offset
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const minAttDate = new Date(todayMidnight.getTime() - 24 * 3600 * 1000);
    const maxAttDate = new Date(todayMidnight.getTime() + 24 * 3600 * 1000);

    const attendances = await this.attendanceModel.find({
      $or: [
        { date: { $gte: minAttDate, $lte: maxAttDate } },
        { createdAt: { $gte: minAttDate, $lte: maxAttDate } },
      ],
    }).sort({ createdAt: -1 });

    const attMap = new Map<string, any>();
    for (const a of attendances) {
      const empKey = a.employee.toString();
      if (!attMap.has(empKey)) {
        attMap.set(empKey, a);
      }
    }

    let activeCount = 0;
    let idleCount = 0;

    for (const d of devices) {
      const empId = (d.employee as any)?._id?.toString();
      const att = empId ? attMap.get(empId) : null;
      const h = empId ? onlineEmpMap.get(empId) : null;
      const hasActiveShift = !!(att?.checkIn && !att?.checkOut);

      if (hasActiveShift) {
        onlineCount++;
        if (att?.activeBreak || h?.latestStatus === 'idle') {
          idleCount++;
        } else {
          activeCount++;
        }
      } else if (empId && (onlineEmpMap.has(empId) || d.status === 'connected') && !att?.checkOut) {
        onlineCount++;
        if (h?.latestStatus === 'idle') {
          idleCount++;
        } else {
          activeCount++;
        }
      } else {
        offlineCount++;
      }
    }

    // Top apps today across all employees
    const todayStr = new Date().toISOString().split('T')[0];
    const topAppsAgg = await this.appSessionModel.aggregate([
      { $match: { date: todayStr } },
      {
        $group: {
          _id: '$appName',
          category: { $first: '$category' },
          totalMinutes: { $sum: '$durationMinutes' },
        },
      },
      { $sort: { totalMinutes: -1 } },
      { $limit: 5 },
    ]);

    const totalMonitoredMinutes = topAppsAgg.reduce((sum, a) => sum + a.totalMinutes, 0);

    return {
      totalWfhEmployees,
      onlineCount,
      offlineCount,
      activeCount,
      idleCount,
      avgActiveHours: totalWfhEmployees > 0 ? ((totalMonitoredMinutes / totalWfhEmployees) / 60).toFixed(1) : '0.0',
      topApplications: topAppsAgg.map((a) => ({
        appName: a._id,
        category: a.category,
        totalHours: (a.totalMinutes / 60).toFixed(1),
        durationMinutes: Math.round(a.totalMinutes),
      })),
    };
  }

  // 7. Live Monitoring Employee List
  async getLiveMonitoring(user?: any) {
    const devices = await this.deviceModel
      .find({ status: { $ne: 'revoked' } })
      .populate('employee', 'name email department role avatar employeeId phone')
      .sort({ lastHeartbeat: -1 });

    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    const cutoffTime = new Date(now - 15 * 60 * 1000);
    const recentHeartbeats = await this.heartbeatModel.aggregate([
      { $match: { timestamp: { $gte: cutoffTime } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$employee',
          status: { $first: '$status' },
          currentApp: { $first: '$currentApp' },
          windowTitle: { $first: '$windowTitle' },
          timestamp: { $first: '$timestamp' },
        },
      },
    ]);

    const hbMap = new Map<string, any>();
    for (const h of recentHeartbeats) {
      hbMap.set(h._id.toString(), h);
    }

    // Get today's aggregated activity records
    const activities = await this.activityModel.find({ date: todayStr });
    const actMap = new Map<string, any>();
    for (const a of activities) {
      actMap.set(a.employee.toString(), a);
    }

    // Get today's attendance records with wide 24h buffer for UTC/IST offset
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const minAttDate = new Date(todayMidnight.getTime() - 24 * 3600 * 1000);
    const maxAttDate = new Date(todayMidnight.getTime() + 24 * 3600 * 1000);

    const attendances = await this.attendanceModel.find({
      $or: [
        { date: { $gte: minAttDate, $lte: maxAttDate } },
        { createdAt: { $gte: minAttDate, $lte: maxAttDate } },
      ],
    }).sort({ createdAt: -1 });

    const attMap = new Map<string, any>();
    for (const a of attendances) {
      const empKey = a.employee.toString();
      if (!attMap.has(empKey)) {
        attMap.set(empKey, a);
      }
    }

    // Deduplicate by employee so each staff member has one live entry (prioritize connected device)
    const sortedDevices = [...devices].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      const tA = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
      const tB = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
      return tB - tA;
    });

    const seenEmployees = new Set<string>();
    const uniqueDevices: any[] = [];
    for (const d of sortedDevices) {
      const empId = (d.employee as any)?._id?.toString();
      if (empId && !seenEmployees.has(empId)) {
        seenEmployees.add(empId);
        uniqueDevices.push(d);
      }
    }

    const list = uniqueDevices.map((d) => {
      const emp = d.employee as any;
      const empId = emp?._id?.toString();
      const hb = empId ? hbMap.get(empId) : null;
      const act = empId ? actMap.get(empId) : null;
      const att = empId ? attMap.get(empId) : null;

      const hasActiveShift = !!(att?.checkIn && !att?.checkOut);
      const isDeviceConnected = d.status === 'connected';
      const isLive = hasActiveShift || !!hb || isDeviceConnected;

      let liveStatus = 'offline';
      if (hasActiveShift) {
        if (att?.activeBreak) {
          liveStatus = 'break';
        } else if (hb?.status === 'idle') {
          liveStatus = 'idle';
        } else {
          liveStatus = 'active';
        }
      } else if (isLive && !att?.checkOut) {
        liveStatus = hb?.status || 'active';
      } else {
        liveStatus = 'offline';
      }

      const isOnline = liveStatus !== 'offline';
      const currentApp = isOnline
        ? (hb?.currentApp || act?.topApplications?.[0]?.appName || 'Google Chrome')
        : (act?.topApplications?.[0]?.appName || 'None');

      return {
        deviceId: d.deviceId,
        deviceName: d.deviceName || 'Windows PC',
        os: d.os || 'Windows',
        employeeId: emp?._id,
        employeeCode: emp?.employeeId,
        name: emp?.name || 'Unknown Employee',
        email: emp?.email,
        department: emp?.department || emp?.role,
        role: emp?.role,
        avatar: emp?.avatar,
        onlineStatus: liveStatus, // 'active' | 'idle' | 'break' | 'offline'
        isOnline,
        currentApp,
        windowTitle: isOnline ? (hb?.windowTitle || '') : '',
        lastSeen: d.lastHeartbeat,
        checkIn: att?.checkIn,
        checkOut: att?.checkOut,
        workingHours: att?.workingHours,
        activeBreak: att?.activeBreak,
        activeMinutes: act?.totalActiveMinutes || (isOnline ? 30 : 0),
        idleMinutes: act?.totalIdleMinutes || 0,
        breakMinutes: act?.totalBreakMinutes || (att?.totalBreakMinutes || 0),
        productivityScore: act?.productivityScore || (isOnline ? 75 : 0),
        topApp: currentApp,
      };
    });

    return list;
  }

  // 8. Single Employee Detailed Breakdown & Timeline
  async getEmployeeDetails(employeeId: string, dateStr?: string, user?: any) {
    const date = dateStr || new Date().toISOString().split('T')[0];
    const empObjId = new Types.ObjectId(employeeId);

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const minAttDate = new Date(startOfDay.getTime() - 24 * 3600 * 1000);
    const maxAttDate = new Date(startOfDay.getTime() + 24 * 3600 * 1000);

    const [employee, device, activity, sessions, attendance] = await Promise.all([
      this.userModel.findById(empObjId).select('-password'),
      this.deviceModel.findOne({ employee: empObjId, status: { $ne: 'revoked' } }).sort({ lastHeartbeat: -1 }),
      this.activityModel.findOne({ employee: empObjId, date }),
      this.appSessionModel
        .find({ employee: empObjId, date })
        .sort({ startTime: -1 }),
      this.attendanceModel.findOne({
        employee: empObjId,
        $or: [
          { date: { $gte: minAttDate, $lte: maxAttDate } },
          { createdAt: { $gte: minAttDate, $lte: maxAttDate } },
        ],
      }).sort({ createdAt: -1 }),
    ]);

    if (!employee) throw new NotFoundException('Employee not found');

    // If activity doc is missing but sessions exist, dynamically calculate on the fly
    let totalActiveMinutes = activity?.totalActiveMinutes || 0;
    let topApplications = activity?.topApplications || [];

    if (totalActiveMinutes === 0 && sessions.length > 0) {
      totalActiveMinutes = Number(sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0).toFixed(1));
      const appMap = new Map<string, { durationMinutes: number; category: string }>();
      for (const s of sessions) {
        const existing = appMap.get(s.appName) || { durationMinutes: 0, category: s.category };
        existing.durationMinutes += s.durationMinutes || 0;
        appMap.set(s.appName, existing);
      }
      topApplications = Array.from(appMap.entries()).map(([appName, data]) => ({
        appName,
        durationMinutes: Number(data.durationMinutes.toFixed(1)),
        percentage: totalActiveMinutes > 0 ? Math.round((data.durationMinutes / totalActiveMinutes) * 100) : 0,
        category: data.category,
      })).sort((a, b) => b.durationMinutes - a.durationMinutes);
    }

    const workingHours = attendance?.workingHours || 0;
    const totalShiftMinutes = Math.round(workingHours * 60);
    const totalIdleMinutes = activity?.totalIdleMinutes || Math.max(0, totalShiftMinutes - totalActiveMinutes);
    const productivityScore = activity?.productivityScore || (totalActiveMinutes > 0 ? Math.min(100, Math.round((totalActiveMinutes / 480) * 100)) : 0);

    return {
      employee: {
        _id: employee._id,
        name: employee.name,
        email: employee.email,
        department: employee.department || employee.role,
        role: employee.role,
        employeeId: employee.employeeId,
        avatar: employee.avatar,
      },
      device: device
        ? {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            os: device.os,
            agentVersion: device.agentVersion,
            status: device.status,
            lastHeartbeat: device.lastHeartbeat,
          }
        : null,
      attendance: attendance
        ? {
            checkIn: attendance.checkIn,
            checkOut: attendance.checkOut,
            workingHours: attendance.workingHours,
            totalBreakMinutes: attendance.totalBreakMinutes,
            status: attendance.status,
            breaks: attendance.breaks || [],
          }
        : null,
      activity: {
        totalActiveMinutes,
        totalIdleMinutes,
        totalBreakMinutes: attendance?.totalBreakMinutes || activity?.totalBreakMinutes || 0,
        totalShiftMinutes,
        productivityScore,
        topApplications,
      },
      sessions: sessions.map((s) => ({
        appName: s.appName,
        processName: s.processName,
        windowTitle: s.windowTitle,
        category: s.category,
        startTime: s.startTime,
        endTime: s.endTime,
        durationMinutes: s.durationMinutes,
      })),
      date,
    };
  }

  // 9. All Registered Devices List
  async getDevices() {
    const devices = await this.deviceModel
      .find({ status: { $ne: 'revoked' } })
      .populate('employee', 'name email department role employeeId avatar')
      .sort({ createdAt: -1 });

    // Deduplicate by employee so that if they have a connected device, only show the connected device
    const sorted = [...devices].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      const tA = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
      const tB = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
      return tB - tA;
    });

    const seen = new Set<string>();
    const result: any[] = [];
    for (const d of sorted) {
      const empId = (d.employee as any)?._id?.toString() || d.deviceId;
      if (!seen.has(empId)) {
        seen.add(empId);
        result.push(d);
      }
    }
    return result;
  }

  // 10. Revoke Device
  async revokeDevice(deviceId: string) {
    const device = await this.deviceModel.findOne({ deviceId });
    if (!device) throw new NotFoundException('Device not found');
    device.status = 'revoked';
    await device.save();
    return { success: true, message: `Device ${deviceId} revoked successfully` };
  }

  // 11. Top Application Usage Summary
  async getApplicationUsageSummary(query: any, user?: any) {
    const date = query.date || new Date().toISOString().split('T')[0];
    const match: any = { date };

    if (query.department && query.department !== 'all') {
      const usersInDept = await this.userModel.find({
        $or: [{ department: query.department }, { role: query.department }],
      }).select('_id');
      match.employee = { $in: usersInDept.map((u) => u._id) };
    }

    if (query.employeeId && query.employeeId !== 'all') {
      match.employee = new Types.ObjectId(query.employeeId);
    }

    // If groupBy === 'employee', return per-employee application breakdown
    if (query.groupBy === 'employee') {
      const empApps = await this.appSessionModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: { employee: '$employee', appName: '$appName' },
            processName: { $first: '$processName' },
            category: { $first: '$category' },
            totalMinutes: { $sum: '$durationMinutes' },
            sessionCount: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id.employee',
            foreignField: '_id',
            as: 'employeeDoc',
          },
        },
        { $unwind: { path: '$employeeDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            employee: {
              _id: '$employeeDoc._id',
              name: '$employeeDoc.name',
              email: '$employeeDoc.email',
              department: '$employeeDoc.department',
              role: '$employeeDoc.role',
            },
            appName: '$_id.appName',
            processName: 1,
            category: 1,
            totalMinutes: { $round: ['$totalMinutes', 1] },
            totalHours: { $round: [{ $divide: ['$totalMinutes', 60] }, 1] },
            sessionCount: 1,
          },
        },
        { $sort: { 'employee.name': 1, totalMinutes: -1 } },
      ]);

      return empApps;
    }

    const apps = await this.appSessionModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$appName',
          processName: { $first: '$processName' },
          category: { $first: '$category' },
          totalMinutes: { $sum: '$durationMinutes' },
          sessionCount: { $sum: 1 },
          usersCount: { $addToSet: '$employee' },
        },
      },
      {
        $project: {
          appName: '$_id',
          processName: 1,
          category: 1,
          totalMinutes: { $round: ['$totalMinutes', 1] },
          totalHours: { $round: [{ $divide: ['$totalMinutes', 60] }, 1] },
          sessionCount: 1,
          usersCount: { $size: '$usersCount' },
        },
      },
      { $sort: { totalMinutes: -1 } },
    ]);

    return apps;
  }

  // 12. Historical WFH Reports
  async getReports(query: any, user?: any) {
    const startDate = query.startDate || new Date().toISOString().split('T')[0];
    const endDate = query.endDate || startDate;

    const match: any = {
      date: { $gte: startDate, $lte: endDate },
    };

    const activities = await this.activityModel
      .find(match)
      .populate('employee', 'name email department role employeeId')
      .sort({ date: -1 });

    return activities;
  }

  // 13. Delete WFH Report Record
  async deleteReport(id: string) {
    const res = await this.activityModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Report record not found');
    return { success: true, message: 'Report record deleted successfully' };
  }

  // 14. Permanently Delete Registered Device
  async deleteDevice(deviceId: string) {
    const device = await this.deviceModel.findOne({ deviceId });
    if (!device) throw new NotFoundException('Device not found');

    await this.deviceModel.deleteOne({ deviceId });
    await this.heartbeatModel.deleteMany({ deviceId });
    return { success: true, message: 'Device deleted successfully' };
  }
}
