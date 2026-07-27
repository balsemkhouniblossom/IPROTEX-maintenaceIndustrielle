import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentAccessService } from '../documents/document-access.service';
import { ReportActor } from './report.interfaces';

const MAX_MACHINES_IN_SCOPE = 200;

/**
 * Resolves the machine set a fleet-level report should cover: a single
 * machine when `machineId` is given (still access-checked), or every
 * machine the caller can see otherwise. Returns `undefined` for "no
 * restriction" (Admin, nothing requested) so a caller can pass that
 * straight through to a Mongo filter as "omit `machine_id` entirely"
 * rather than an artificial `$in: [...allIds]`. Capped so an unbounded
 * fleet can't turn a report into an unbounded per-machine loop.
 */
export async function resolveReportMachineScope(
  documentAccessService: DocumentAccessService,
  actor: ReportActor,
  machineId?: string,
): Promise<Types.ObjectId[] | undefined> {
  if (machineId) {
    await documentAccessService.assertCanAccessMachine(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    return [new Types.ObjectId(machineId)];
  }

  const accessible = await documentAccessService.listAccessibleMachineIds({
    userId: actor.userId,
    role: actor.role,
  });
  if (accessible === null) return undefined; // Admin — unrestricted
  if (accessible.length === 0) {
    throw new ForbiddenException('No accessible machines for this report');
  }
  return accessible.slice(0, MAX_MACHINES_IN_SCOPE);
}
