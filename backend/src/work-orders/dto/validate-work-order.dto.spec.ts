import { validate } from 'class-validator';
import { ValidateWorkOrderDto } from './validate-work-order.dto';

function dto(action?: unknown) {
  return Object.assign(new ValidateWorkOrderDto(), { action });
}

describe('ValidateWorkOrderDto', () => {
  it('accepts a missing action — the controller defaults it to "approve"', async () => {
    await expect(validate(dto(undefined))).resolves.toHaveLength(0);
  });

  it.each(['approve', 'reject', 'request_correction'])(
    'accepts action=%s',
    async (action) => {
      await expect(validate(dto(action))).resolves.toHaveLength(0);
    },
  );

  it('rejects an arbitrary action string instead of silently no-op-ing the transition', async () => {
    const errors = await validate(dto('do-something-unexpected'));
    expect(errors.map((e) => e.property)).toContain('action');
  });
});
