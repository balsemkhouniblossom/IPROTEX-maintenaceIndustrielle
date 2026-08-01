import { ConflictException } from '@nestjs/common';
import { Model } from 'mongoose';

export interface DependencyCheck {
  label: string;
  model: Model<any>;
  filter: Record<string, unknown>;
}

export async function assertNoDependencies(
  resourceLabel: string,
  checks: DependencyCheck[],
): Promise<void> {
  const matches = await Promise.all(
    checks.map(async (check) => ({
      label: check.label,
      exists: Boolean(await check.model.exists(check.filter).exec()),
    })),
  );
  const dependencies = matches
    .filter((match) => match.exists)
    .map((match) => match.label);

  if (dependencies.length > 0) {
    throw new ConflictException(
      `${resourceLabel} cannot be deleted because it is referenced by: ${dependencies.join(', ')}`,
    );
  }
}
