import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateOtPieceDto } from './create-ot-piece.dto';

function dto(overrides: Partial<CreateOtPieceDto> = {}) {
  return Object.assign(new CreateOtPieceDto(), {
    ot_id: new Types.ObjectId().toHexString(),
    part_id: new Types.ObjectId().toHexString(),
    quantite: 3,
    ...overrides,
  });
}

describe('CreateOtPieceDto', () => {
  it('accepts a valid payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects non-ObjectId ot_id/part_id', async () => {
    const errors = await validate(dto({ ot_id: 'nope', part_id: 'nope' }));
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['ot_id', 'part_id']),
    );
  });

  it('rejects a non-positive quantite', async () => {
    const errors = await validate(dto({ quantite: 0 }));
    expect(errors.map((e) => e.property)).toContain('quantite');
  });

  it('rejects an unexpected/protected field under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), {
      version: 5,
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('version');
  });
});
