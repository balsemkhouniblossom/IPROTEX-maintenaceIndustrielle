import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AutomationJobLock,
  AutomationJobLockDocument,
} from '../schemas/automation-job-lock.schema';
import { SchedulerLockHandle } from './scheduler.types';
import { createInstanceId } from './scheduler-utils';

@Injectable()
export class SchedulerLockService {
  private readonly instanceId = createInstanceId('backend-scheduler');

  constructor(
    @InjectModel(AutomationJobLock.name)
    private readonly lockModel: Model<AutomationJobLockDocument>,
  ) {}

  getInstanceId(): string {
    return this.instanceId;
  }

  async acquire(
    jobName: string,
    runId: string,
    leaseMs: number,
  ): Promise<SchedulerLockHandle | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseMs);
    try {
      const lock = await this.lockModel
        .findOneAndUpdate(
          {
            name: jobName,
            $or: [
              { expires_at: { $lte: now } },
              { owner_id: this.instanceId },
              { owner_id: { $exists: false } },
            ],
          },
          {
            $set: {
              name: jobName,
              owner: this.instanceId,
              owner_id: this.instanceId,
              run_id: runId,
              acquired_at: now,
              heartbeat_at: now,
              expires_at: expiresAt,
              status: 'running',
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .lean()
        .exec();

      if (lock?.owner_id !== this.instanceId || lock?.run_id !== runId) {
        return null;
      }
      return {
        jobName,
        ownerId: this.instanceId,
        runId,
        expiresAt,
      };
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) return null;
      throw error;
    }
  }

  async heartbeat(
    handle: SchedulerLockHandle,
    leaseMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseMs);
    const result = await this.lockModel
      .findOneAndUpdate(
        {
          name: handle.jobName,
          owner_id: handle.ownerId,
          run_id: handle.runId,
          expires_at: { $gt: now },
        },
        {
          $set: {
            owner: handle.ownerId,
            heartbeat_at: now,
            expires_at: expiresAt,
            status: 'running',
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    return Boolean(result);
  }

  async release(
    handle: SchedulerLockHandle,
    status: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.lockModel
      .deleteOne({
        name: handle.jobName,
        owner_id: handle.ownerId,
        run_id: handle.runId,
      })
      .exec();

    if (result.deletedCount === 0) {
      await this.lockModel
        .updateOne(
          {
            name: handle.jobName,
            owner_id: handle.ownerId,
            run_id: handle.runId,
          },
          {
            $set: {
              status,
              metadata: metadata ?? {},
            },
          },
        )
        .exec();
      return false;
    }
    return true;
  }
}
