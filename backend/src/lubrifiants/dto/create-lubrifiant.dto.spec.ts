import { validate } from 'class-validator';
import { CreateLubrifiantDto } from './create-lubrifiant.dto';

function dto(overrides: Partial<CreateLubrifiantDto> = {}) {
  return Object.assign(new CreateLubrifiantDto(), {
    lubrifiant_id: 'LUB-001',
    nom: 'Grease XT',
    type: 'grease',
    ...overrides,
  });
}

describe('CreateLubrifiantDto', () => {
  it('accepts a valid lubrifiant payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects missing required fields', async () => {
    const errors = await validate(dto({ nom: '', type: '' }));
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['nom', 'type']),
    );
  });

  it('accepts optional viscosite/usage', async () => {
    await expect(
      validate(dto({ viscosite: 'SAE 30', usage: 'bearings' })),
    ).resolves.toHaveLength(0);
  });

  it('rejects an unexpected/protected field under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), {
      created_by: 'someone-else',
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('created_by');
  });
});
