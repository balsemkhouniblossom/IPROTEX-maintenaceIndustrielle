import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { SchedulePreventiveDto } from './schedule-preventive.dto';

function dto(overrides: Partial<SchedulePreventiveDto> = {}) {
  return Object.assign(new SchedulePreventiveDto(), {
    machine_id: new Types.ObjectId().toHexString(),
    plan_id: new Types.ObjectId().toHexString(),
    scheduled_date: '2026-02-01T08:00:00.000Z',
    ...overrides,
  });
}

describe('SchedulePreventiveDto', () => {
  it('accepts a valid payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects non-ObjectId machine_id/plan_id', async () => {
    const errors = await validate(dto({ machine_id: 'nope', plan_id: 'nope' }));
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['machine_id', 'plan_id']),
    );
  });

  it('rejects a non-ISO8601 scheduled_date', async () => {
    const errors = await validate(dto({ scheduled_date: 'tomorrow' }));
    expect(errors.map((e) => e.property)).toContain('scheduled_date');
  });

  it('rejects a missing field entirely', async () => {
    const instance = dto();
    delete (instance as { machine_id?: string }).machine_id;
    const errors = await validate(instance);
    expect(errors.map((e) => e.property)).toContain('machine_id');
  });
});
