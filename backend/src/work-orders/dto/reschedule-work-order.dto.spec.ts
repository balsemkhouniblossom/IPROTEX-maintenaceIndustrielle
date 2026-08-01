import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RescheduleWorkOrderDto } from './reschedule-work-order.dto';

function dto(overrides: Partial<RescheduleWorkOrderDto> = {}) {
  return plainToInstance(RescheduleWorkOrderDto, {
    new_due_date: '2026-02-01T00:00:00.000Z',
    reason: 'Machine unavailable',
    ...overrides,
  });
}

describe('RescheduleWorkOrderDto', () => {
  it('accepts a valid payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects a non-ISO8601 new_due_date', async () => {
    const errors = await validate(dto({ new_due_date: 'next tuesday' }));
    expect(errors.map((e) => e.property)).toContain('new_due_date');
  });

  it('rejects an empty reason', async () => {
    const errors = await validate(dto({ reason: '' }));
    expect(errors.map((e) => e.property)).toContain('reason');
  });

  it('rejects a whitespace-only reason once trimmed by the transform', async () => {
    const errors = await validate(dto({ reason: '   ' }));
    expect(errors.map((e) => e.property)).toContain('reason');
  });

  it('trims a reason with leading/trailing whitespace before validating', async () => {
    const instance = dto({ reason: '  Machine unavailable  ' });
    expect(instance.reason).toBe('Machine unavailable');
    await expect(validate(instance)).resolves.toHaveLength(0);
  });

  it('rejects a reason over 500 characters', async () => {
    const errors = await validate(dto({ reason: 'x'.repeat(501) }));
    expect(errors.map((e) => e.property)).toContain('reason');
  });

  it('rejects an unexpected/protected field (e.g. a forged rescheduled_by) under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), {
      rescheduled_by: 'someone-elses-id',
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('rescheduled_by');
  });
});
