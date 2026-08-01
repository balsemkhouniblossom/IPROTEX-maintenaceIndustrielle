import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { SetPartQuantityDto } from './set-part-quantity.dto';

function dto(overrides: Partial<SetPartQuantityDto> = {}) {
  return Object.assign(new SetPartQuantityDto(), {
    partId: new Types.ObjectId().toHexString(),
    quantity: 1,
    ...overrides,
  });
}

describe('SetPartQuantityDto', () => {
  it('accepts a valid payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects a non-ObjectId partId', async () => {
    const errors = await validate(dto({ partId: 'not-an-object-id' }));
    expect(errors.map((e) => e.property)).toContain('partId');
  });

  it('rejects zero, negative, or fractional quantity — matches the service-level rule (integer > 0)', async () => {
    const zero = await validate(dto({ quantity: 0 }));
    const negative = await validate(dto({ quantity: -1 }));
    const fractional = await validate(dto({ quantity: 0.5 }));
    expect(zero.map((e) => e.property)).toContain('quantity');
    expect(negative.map((e) => e.property)).toContain('quantity');
    expect(fractional.map((e) => e.property)).toContain('quantity');
  });
});
