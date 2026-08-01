import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateKpiDto } from './create-kpi.dto';

function dto(overrides: Partial<CreateKpiDto> = {}) {
  return Object.assign(new CreateKpiDto(), {
    kpi_id: 'KPI-001',
    machine_id: new Types.ObjectId().toHexString(),
    date_calcul: '2026-01-01T00:00:00.000Z',
    periode_debut: '2025-12-01T00:00:00.000Z',
    periode_fin: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('CreateKpiDto', () => {
  it('accepts a valid KPI snapshot payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects a non-ObjectId machine_id', async () => {
    const errors = await validate(dto({ machine_id: 'not-an-object-id' }));
    expect(errors.map((e) => e.property)).toContain('machine_id');
  });

  it('rejects non-date strings for the required date fields', async () => {
    const errors = await validate(
      dto({
        date_calcul: 'not-a-date',
        periode_debut: 'nope',
        periode_fin: 'nope',
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['date_calcul', 'periode_debut', 'periode_fin']),
    );
  });

  it('rejects non-numeric mtbf/mttr/availability values when provided', async () => {
    const errors = await validate(
      dto({
        mtbf_value: 'not-a-number' as unknown as number,
      }),
    );
    expect(errors.map((e) => e.property)).toContain('mtbf_value');
  });

  it('accepts omitted optional numeric fields', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects an unexpected/protected field under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), { version: 1 });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('version');
  });
});
