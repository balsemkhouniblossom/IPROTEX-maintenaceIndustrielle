import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../../schemas/user.schema';
import { CompleteGoogleProfileDto } from './complete-google-profile.dto';

/**
 * Mirrors the global ValidationPipe config from main.ts
 * (whitelist + forbidNonWhitelisted) so this test proves the same
 * mass-assignment protection that runs in production.
 */
async function validateAsRequestBody(
  body: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(CompleteGoogleProfileDto, body, {
    excludeExtraneousValues: false,
  });
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('CompleteGoogleProfileDto whitelist protection', () => {
  const validBody = {
    phone: '+21612345678',
    role: Role.OPERATOR,
    department: 'Maintenance',
    language: 'en',
  };

  it('accepts a well-formed profile completion payload', async () => {
    const errorProperties = await validateAsRequestBody(validBody);
    expect(errorProperties).toEqual([]);
  });

  it('rejects a request body carrying admin-managed/lifecycle fields', async () => {
    const errorProperties = await validateAsRequestBody({
      ...validBody,
      approval_status: 'approved',
      is_active: true,
      is_verified: true,
      profile_completed: true,
      user_id: 'FORGED-ID',
      _id: 'forged-object-id',
      google_id: 'forged-google-id',
    });

    expect(errorProperties).toEqual(
      expect.arrayContaining([
        'approval_status',
        'is_active',
        'is_verified',
        'profile_completed',
        'user_id',
        '_id',
        'google_id',
      ]),
    );
  });

  it('rejects the removed position field as an unknown property', async () => {
    const errorProperties = await validateAsRequestBody({
      ...validBody,
      position: 'Shift Lead',
    });

    expect(errorProperties).toContain('position');
  });

  it('rejects an attempt to escalate to an admin role', async () => {
    const errorProperties = await validateAsRequestBody({
      ...validBody,
      role: 'admin',
    });

    expect(errorProperties).toContain('role');
  });
});
