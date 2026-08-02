import { ConfigService } from '@nestjs/config';
import { SchedulerConfigService } from './scheduler.config';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('SchedulerConfigService', () => {
  it('uses production-safe defaults', () => {
    const service = new SchedulerConfigService(config({}));
    expect(service.getSettings()).toMatchObject({
      enabled: true,
      batchSize: 250,
      concurrency: 4,
      externalConcurrency: 2,
      maxItemsPerRun: 5000,
    });
  });

  it('rejects zero, negative, and malformed values', () => {
    expect(() =>
      new SchedulerConfigService(
        config({ AUTOMATION_BATCH_SIZE: '0' }),
      ).getSettings(),
    ).toThrow(/AUTOMATION_BATCH_SIZE/);
    expect(() =>
      new SchedulerConfigService(
        config({ AUTOMATION_SCHEDULER_ENABLED: 'maybe' }),
      ).getSettings(),
    ).toThrow(/AUTOMATION_SCHEDULER_ENABLED/);
  });

  it('rejects a heartbeat that could outlive the lease', () => {
    expect(() =>
      new SchedulerConfigService(
        config({
          AUTOMATION_LOCK_TTL_MS: '60000',
          AUTOMATION_LOCK_HEARTBEAT_MS: '60000',
        }),
      ).getSettings(),
    ).toThrow(/AUTOMATION_LOCK_HEARTBEAT_MS/);
  });
});
