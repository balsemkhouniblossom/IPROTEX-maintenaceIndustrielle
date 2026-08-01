import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateLubrificationLogDto } from './create-lubrification-log.dto';

function dto(overrides: Partial<CreateLubrificationLogDto> = {}) {
  return Object.assign(new CreateLubrificationLogDto(), {
    log_id: 'LOG-001',
    module_id: new Types.ObjectId().toHexString(),
    lubrifiant_id: new Types.ObjectId().toHexString(),
    date_application: '2026-01-01T00:00:00.000Z',
    quantite: 2,
    technician_id: new Types.ObjectId().toHexString(),
    ...overrides,
  });
}

describe('CreateLubrificationLogDto', () => {
  it('accepts a valid log payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects non-ObjectId refs', async () => {
    const errors = await validate(
      dto({
        module_id: 'nope',
        lubrifiant_id: 'nope',
        technician_id: 'nope',
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['module_id', 'lubrifiant_id', 'technician_id']),
    );
  });

  it('rejects a non-positive or non-integer quantite', async () => {
    const zero = await validate(dto({ quantite: 0 }));
    const fractional = await validate(dto({ quantite: 1.5 }));
    expect(zero.map((e) => e.property)).toContain('quantite');
    expect(fractional.map((e) => e.property)).toContain('quantite');
  });

  it('rejects an invalid date_application', async () => {
    const errors = await validate(dto({ date_application: 'not-a-date' }));
    expect(errors.map((e) => e.property)).toContain('date_application');
  });

  it('rejects an unexpected/protected field under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), {
      _id: 'forged-id',
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('_id');
  });
});
