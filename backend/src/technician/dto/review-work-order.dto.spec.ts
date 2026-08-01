import { validate } from 'class-validator';
import { ReviewWorkOrderDto } from './review-work-order.dto';

function dto(action: unknown) {
  return Object.assign(new ReviewWorkOrderDto(), { action });
}

describe('ReviewWorkOrderDto', () => {
  it.each(['return', 'intervene'])('accepts action=%s', async (action) => {
    await expect(validate(dto(action))).resolves.toHaveLength(0);
  });

  it('rejects a missing action', async () => {
    const errors = await validate(dto(undefined));
    expect(errors.map((e) => e.property)).toContain('action');
  });

  it('rejects "approve" — a technician must never be able to self-approve via this endpoint', async () => {
    const errors = await validate(dto('approve'));
    expect(errors.map((e) => e.property)).toContain('action');
  });

  it('rejects an arbitrary string', async () => {
    const errors = await validate(dto('do-something-else'));
    expect(errors.map((e) => e.property)).toContain('action');
  });
});
