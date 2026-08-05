import { MachineTypeSummaryResponse } from '../../common/response/reference-summaries';
import { MachineLifecycleAction } from '../../schemas/machine.schema';

/** Mirrors `MachineLifecycleEntry` (`schemas/machine.schema.ts`) as serialized JSON. */
export interface MachineLifecycleEntryResponse {
  action: MachineLifecycleAction;
  from_status?: string;
  to_status: string;
  actor_user_id?: string;
  reason?: string;
  at: string;
}

/**
 * The actual serialized shape of a Machine as returned by every
 * `/machines*` endpoint today. `type_id` is a plain ObjectId string on
 * every endpoint in this module (none of them call `.populate()`), but the
 * type still represents the populated-summary shape as a real possibility
 * since `MachineSummaryResponse`/other modules populate this same ref.
 */
export interface MachineResponse {
  _id: string;
  machine_id: string;
  type_id: string | MachineTypeSummaryResponse;
  serial_no: string;
  reference?: string;
  installation_date?: string;
  poids_kg?: number;
  fabricant?: string;
  model?: string;
  location?: string;
  status: string;
  lifecycle_history: MachineLifecycleEntryResponse[];
  createdAt?: string;
  updatedAt?: string;
}
