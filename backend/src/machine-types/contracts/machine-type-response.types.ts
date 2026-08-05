import { MachineTypeSummaryResponse } from '../../common/response/reference-summaries';

/**
 * `MachineType` has no populated references and no fields beyond
 * `_id`/`type_id`/`name`/`description`, so its full response contract is
 * exactly the shared summary type other modules populate it as.
 */
export type MachineTypeResponse = MachineTypeSummaryResponse;
