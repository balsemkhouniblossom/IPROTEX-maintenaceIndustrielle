import {
  mapPopulatedRef,
  serializeDate,
  serializeObjectId,
} from '../../common/response/serialization.util';
import { toMachineTypeSummary } from '../../common/response/reference-summaries';
import { MachineTypeDocument } from '../../schemas/machine-type.schema';
import {
  Machine,
  MachineDocument,
  MachineLifecycleEntry,
} from '../../schemas/machine.schema';
import {
  MachineLifecycleEntryResponse,
  MachineResponse,
} from './machine-response.types';

type MachineLike = (Machine | MachineDocument) & {
  _id: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

function toLifecycleEntryResponse(
  entry: MachineLifecycleEntry,
): MachineLifecycleEntryResponse {
  return {
    action: entry.action,
    from_status: entry.from_status,
    to_status: entry.to_status,
    actor_user_id: serializeObjectId(entry.actor_user_id),
    reason: entry.reason,
    at: serializeDate(entry.at)!,
  };
}

/**
 * Converts a Machine (Mongoose document or plain schema instance,
 * `.populate()`d or not) into the exact JSON shape `/machines*` endpoints
 * have always returned.
 */
export function toMachineResponse(doc: MachineLike): MachineResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    machine_id: doc.machine_id,
    type_id: mapPopulatedRef(
      doc.type_id as unknown as MachineTypeDocument | string,
      toMachineTypeSummary,
    )!,
    serial_no: doc.serial_no,
    reference: doc.reference,
    installation_date: serializeDate(doc.installation_date),
    poids_kg: doc.poids_kg,
    fabricant: doc.fabricant,
    model: doc.model,
    location: doc.location,
    status: doc.status,
    lifecycle_history: (doc.lifecycle_history ?? []).map(
      toLifecycleEntryResponse,
    ),
    createdAt: serializeDate(doc.createdAt),
    updatedAt: serializeDate(doc.updatedAt),
  };
}

export function toMachineResponseOrNull(
  doc: MachineLike | null | undefined,
): MachineResponse | null {
  return doc ? toMachineResponse(doc) : null;
}
