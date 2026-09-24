import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateCorrectiveReportDto } from './create-corrective-report.dto';

function dto(overrides: Partial<CreateCorrectiveReportDto> = {}) {
  return Object.assign(new CreateCorrectiveReportDto(), {
    machine_id: new Types.ObjectId().toHexString(),
    code_panne: 'FAULT-1',
    actions: ['Solved'],
    ...overrides,
  });
}

describe('CreateCorrectiveReportDto', () => {
  it('accepts the same required fields used by the operator corrective progress workflow', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects a missing or invalid machine id', async () => {
    const errors = await validate(dto({ machine_id: 'not-an-object-id' }));

    expect(errors.map((error) => error.property)).toContain('machine_id');
  });

  it('rejects a missing fault code', async () => {
    const errors = await validate(dto({ code_panne: '' }));

    expect(errors.map((error) => error.property)).toContain('code_panne');
  });

  it('rejects missing or empty action arrays, matching backend report creation requirements', async () => {
    const missing = await validate(dto({ actions: undefined as never }));
    const empty = await validate(dto({ actions: [] }));

    expect(missing.map((error) => error.property)).toContain('actions');
    expect(empty.map((error) => error.property)).toContain('actions');
  });

  it('accepts optional description, priority, and absence of photo metadata', async () => {
    await expect(
      validate(
        dto({
          fault_description: 'Operator note',
          priority: 'high',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('accepts machine-stopped intervention timestamps and rejects malformed timestamps', async () => {
    await expect(
      validate(
        dto({
          machine_stopped: true,
          intervention_started_at: '2026-09-24T08:00:00.000Z',
          intervention_ended_at: '2026-09-24T09:00:00.000Z',
        }),
      ),
    ).resolves.toHaveLength(0);

    const errors = await validate(
      dto({
        machine_stopped: true,
        intervention_started_at: 'not-a-date',
      }),
    );
    expect(errors.map((error) => error.property)).toContain(
      'intervention_started_at',
    );
  });
});
