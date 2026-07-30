import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

/**
 * Mirrors the global ValidationPipe config from main.ts
 * (whitelist + forbidNonWhitelisted) so this test proves the same
 * mass-assignment protection that runs in production: the generic
 * PATCH /users/:id admin edit endpoint can never be used to set approval
 * decisions directly — those are only ever made through the dedicated
 * approve/reject transition endpoints.
 */
async function validateAsRequestBody(
  body: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(UpdateUserDto, body, {
    excludeExtraneousValues: false,
  });
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('UpdateUserDto whitelist protection', () => {
  it('accepts a well-formed partial profile edit', async () => {
    const errorProperties = await validateAsRequestBody({
      phone: '+21612345678',
      department: 'Maintenance',
      is_active: true,
    });
    expect(errorProperties).toEqual([]);
  });

  it('rejects a request body carrying approval-decision fields', async () => {
    const errorProperties = await validateAsRequestBody({
      phone: '+21612345678',
      approval_status: 'approved',
      approved_by: 'forged-admin-id',
      approved_at: new Date().toISOString(),
      rejected_by: 'forged-admin-id',
      rejected_at: new Date().toISOString(),
      rejection_reason: 'forged',
      approval_history: [],
    });

    expect(errorProperties).toEqual(
      expect.arrayContaining([
        'approval_status',
        'approved_by',
        'approved_at',
        'rejected_by',
        'rejected_at',
        'rejection_reason',
        'approval_history',
      ]),
    );
  });
});
