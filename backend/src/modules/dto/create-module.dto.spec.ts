import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateModuleDto } from './create-module.dto';

function dto(overrides: Partial<CreateModuleDto> = {}) {
  return Object.assign(new CreateModuleDto(), {
    module_id: 'MOD-001',
    machine_id: new Types.ObjectId().toHexString(),
    mod_type_id: new Types.ObjectId().toHexString(),
    ...overrides,
  });
}

describe('CreateModuleDto', () => {
  it('accepts a valid module payload', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects a missing module_id', async () => {
    const errors = await validate(dto({ module_id: '' }));
    expect(errors.map((e) => e.property)).toContain('module_id');
  });

  it('rejects a non-ObjectId machine_id or mod_type_id', async () => {
    const errors = await validate(
      dto({ machine_id: 'not-an-object-id', mod_type_id: 'also-not-one' }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['machine_id', 'mod_type_id']),
    );
  });

  it('accepts an optional parent_module_id and localisation', async () => {
    await expect(
      validate(
        dto({
          parent_module_id: new Types.ObjectId().toHexString(),
          localisation: 'Bay 3',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects a protected/unexpected field under the same whitelist+forbidNonWhitelisted config main.ts uses globally', async () => {
    const instance = Object.assign(dto(), {
      _id: 'should-not-be-settable',
      version: 99,
    });

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const rejectedProperties = errors.map((e) => e.property);
    expect(rejectedProperties).toEqual(
      expect.arrayContaining(['_id', 'version']),
    );
  });
});
