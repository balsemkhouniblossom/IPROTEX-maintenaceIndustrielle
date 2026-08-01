import { ConflictException } from '@nestjs/common';
import { assertNoDependencies } from './dependency-protection';

function modelExists(value: unknown) {
  return {
    exists: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    }),
  };
}

describe('dependency-protection', () => {
  it('allows deletion when no dependency check matches', async () => {
    const model = modelExists(null);

    await expect(
      assertNoDependencies('Machine', [
        {
          label: 'work orders',
          model: model as never,
          filter: { machine_id: 'm1' },
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it('throws HTTP 409 with every matching dependency label', async () => {
    const empty = modelExists(null);
    const used = modelExists({ _id: 'dep' });

    await expect(
      assertNoDependencies('Machine', [
        {
          label: 'modules',
          model: empty as never,
          filter: { machine_id: 'm1' },
        },
        {
          label: 'work orders',
          model: used as never,
          filter: { machine_id: 'm1' },
        },
        {
          label: 'documents',
          model: used as never,
          filter: { machine_id: 'm1' },
        },
      ]),
    ).rejects.toThrow(ConflictException);
  });
});
