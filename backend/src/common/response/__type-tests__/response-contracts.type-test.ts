/**
 * Compile-only contract fixtures — never executed, only type-checked by
 * `tsc -p tsconfig.build.json --noEmit` (and therefore `npm run build`).
 * Each assignment below only compiles if the left-hand declared type and the
 * right-hand referenced type actually agree; a divergence between a
 * controller's declared return type and its service's real return type (or
 * between a mapper's output and its declared response interface) fails the
 * build instead of silently drifting at runtime.
 */
import { WorkOrdersController } from '../../../work-orders/work-orders.controller';
import { WorkOrdersService } from '../../../work-orders/work-orders.service';
import { toWorkOrderResponse } from '../../../work-orders/contracts/work-order-response.mapper';
import { WorkOrderResponse } from '../../../work-orders/contracts/work-order-response.types';
import { MachinesController } from '../../../machines/machines.controller';
import { MachinesService } from '../../../machines/machines.service';
import { toMachineResponse } from '../../../machines/contracts/machine-response.mapper';
import { MachineResponse } from '../../../machines/contracts/machine-response.types';
import { MachineTypesController } from '../../../machine-types/machine-types.controller';
import { MachineTypesService } from '../../../machine-types/machine-types.service';
import { toMachineTypeSummary } from '../reference-summaries';
import { MachineTypeResponse } from '../../../machine-types/contracts/machine-type-response.types';
import { toInterventionReportResponse } from '../intervention-report-response';
import type { InterventionReportResponse } from '../intervention-report-response';

/** `true` only if `T` is exactly `any` — used below to prove a contract type never degraded into `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

function assertNotAny<T>(_value: IsAny<T> extends false ? true : never): void {
  return;
}

function assertSameType<A, B>(
  _value: (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : never
    : never,
): void {
  return;
}

function consumeTypeFixtures(..._values: unknown[]): void {
  return;
}

// --- Mapper output satisfies its declared response contract ---------------
declare const workOrderDoc: Parameters<typeof toWorkOrderResponse>[0];
const _workOrderMapperOutput = toWorkOrderResponse(
  workOrderDoc,
) satisfies WorkOrderResponse;

declare const machineDoc: Parameters<typeof toMachineResponse>[0];
const _machineMapperOutput = toMachineResponse(
  machineDoc,
) satisfies MachineResponse;

declare const machineTypeDoc: Parameters<typeof toMachineTypeSummary>[0];
const _machineTypeMapperOutput = toMachineTypeSummary(
  machineTypeDoc,
) satisfies MachineTypeResponse;

declare const reportDoc: Parameters<typeof toInterventionReportResponse>[0];
const _reportMapperOutput = toInterventionReportResponse(
  reportDoc,
) satisfies InterventionReportResponse;

consumeTypeFixtures(
  _workOrderMapperOutput,
  _machineMapperOutput,
  _machineTypeMapperOutput,
  _reportMapperOutput,
);

// --- Controller return type matches its service's declared return type ----
assertSameType<WorkOrdersController['create'], WorkOrdersService['create']>(
  true,
);
assertSameType<WorkOrdersController['findOne'], WorkOrdersService['findOne']>(
  true,
);
assertSameType<MachinesController['create'], MachinesService['create']>(true);
assertSameType<MachinesController['findOne'], MachinesService['findOne']>(true);
assertSameType<
  MachineTypesController['findOne'],
  MachineTypesService['findOne']
>(true);

// --- No `any` leaks into the public response contracts ---------------------
assertNotAny<WorkOrderResponse>(true);
assertNotAny<MachineResponse>(true);
assertNotAny<MachineTypeResponse>(true);
assertNotAny<InterventionReportResponse>(true);
