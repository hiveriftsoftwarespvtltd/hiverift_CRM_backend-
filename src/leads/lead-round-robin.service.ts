import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { LeadRoundRobin, LeadRoundRobinDocument } from './schemas/lead-round-robin.schema';

export interface RoundRobinAssignee {
  _id: Types.ObjectId;
  name: string;
  email?: string;
}

/**
 * Distributes automatically ingested leads evenly across active sales employees
 * in strict round-robin order using an atomic MongoDB counter.
 */
@Injectable()
export class LeadRoundRobinService {
  private readonly logger = new Logger(LeadRoundRobinService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(LeadRoundRobin.name)
    private readonly roundRobinModel: Model<LeadRoundRobinDocument>,
  ) {}

  /**
   * Returns the next active sales employee in round-robin rotation,
   * or null if no active sales employees exist.
   */
  async getNextAssignee(): Promise<RoundRobinAssignee | null> {
    const salesUsers = await this.userModel
      .find({ role: UserRole.SALES, isActive: { $ne: false } })
      .select('_id name email')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    if (!salesUsers || salesUsers.length === 0) {
      this.logger.warn('Round Robin: No active sales employees found. Lead will remain unassigned.');
      return null;
    }

    try {
      const state = await this.roundRobinModel
        .findOneAndUpdate(
          { key: 'default' },
          { $inc: { assignmentCount: 1 } },
          { upsert: true, new: true },
        )
        .lean()
        .exec();

      const count = state?.assignmentCount || 1;
      const index = (count - 1) % salesUsers.length;
      const selected = salesUsers[index];

      await this.roundRobinModel
        .updateOne({ key: 'default' }, { $set: { lastAssignedUserId: selected._id } })
        .exec();

      this.logger.log(
        `Round Robin (#${count}): Assigning lead to ${selected.name} (slot ${index + 1}/${salesUsers.length})`,
      );

      return {
        _id: selected._id as Types.ObjectId,
        name: selected.name,
        email: selected.email,
      };
    } catch (err: any) {
      this.logger.error(`Round Robin counter error, falling back to first sales employee: ${err.message}`);
      const fallback = salesUsers[0];
      return {
        _id: fallback._id as Types.ObjectId,
        name: fallback.name,
        email: fallback.email,
      };
    }
  }
}
