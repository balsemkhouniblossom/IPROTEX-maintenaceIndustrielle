import { Connection, Model, createConnection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  AutomationJobLock,
  AutomationJobLockDocument,
  AutomationJobLockSchema,
} from '../schemas/automation-job-lock.schema';
import { SchedulerLockService } from './scheduler-lock.service';

describe('SchedulerLockService MongoDB lease behavior', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let lockModel: Model<AutomationJobLockDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(mongod.getUri()).asPromise();
    lockModel = connection.model(
      AutomationJobLock.name,
      AutomationJobLockSchema,
    ) as unknown as Model<AutomationJobLockDocument>;
    await lockModel.syncIndexes();
  });

  afterEach(async () => {
    await lockModel.deleteMany({});
  });

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  it('allows only one owner to acquire an active lock during simultaneous attempts', async () => {
    const first = new SchedulerLockService(lockModel);
    const second = new SchedulerLockService(lockModel);

    const [firstResult, secondResult] = await Promise.all([
      first.acquire('singleton-job', 'run-a', 60_000),
      second.acquire('singleton-job', 'run-b', 60_000),
    ]);

    expect([firstResult, secondResult].filter(Boolean)).toHaveLength(1);
  });

  it('allows another instance to acquire after expiry', async () => {
    const first = new SchedulerLockService(lockModel);
    const second = new SchedulerLockService(lockModel);

    const active = await first.acquire('recoverable-job', 'run-a', 60_000);
    expect(active).toBeTruthy();
    await lockModel.updateOne(
      { name: 'recoverable-job' },
      { $set: { expires_at: new Date(Date.now() - 1000) } },
    );

    const recovered = await second.acquire('recoverable-job', 'run-b', 60_000);

    expect(recovered).toBeTruthy();
    expect(recovered?.ownerId).toBe(second.getInstanceId());
  });

  it('rejects release from a stale run id and preserves the newer lock', async () => {
    const service = new SchedulerLockService(lockModel);
    const current = await service.acquire('guarded-release', 'run-new', 60_000);
    expect(current).toBeTruthy();

    const released = await service.release(
      {
        jobName: 'guarded-release',
        ownerId: service.getInstanceId(),
        runId: 'run-old',
        expiresAt: new Date(Date.now() + 60_000),
      },
      'completed',
    );

    expect(released).toBe(false);
    await expect(
      lockModel.findOne({ name: 'guarded-release' }),
    ).resolves.toBeTruthy();
  });

  it('extends the expiry only for the active owner and run id', async () => {
    const service = new SchedulerLockService(lockModel);
    const active = await service.acquire('heartbeat-job', 'run-a', 60_000);
    expect(active).toBeTruthy();
    const before = await lockModel.findOne({ name: 'heartbeat-job' }).lean();

    const ok = await service.heartbeat(active!, 120_000);
    const after = await lockModel.findOne({ name: 'heartbeat-job' }).lean();

    expect(ok).toBe(true);
    expect(after?.expires_at.getTime()).toBeGreaterThan(
      before?.expires_at.getTime() ?? 0,
    );
  });
});
