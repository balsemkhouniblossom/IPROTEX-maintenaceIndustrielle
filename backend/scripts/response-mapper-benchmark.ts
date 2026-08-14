/**
 * Pure in-memory mapper-overhead benchmark for the response-contract
 * hardening work — no database involved (mappers never query the DB), so
 * this measures exactly the mapping cost the mapper adds on top of an
 * already-fetched Mongoose result set.
 *
 * Run with: npx ts-node scripts/response-mapper-benchmark.ts
 */
import { performance } from 'node:perf_hooks';
import { Types } from 'mongoose';
import { toWorkOrderResponse } from '../src/work-orders/contracts/work-order-response.mapper';
import { toTechnicianPartResponse } from '../src/technician/contracts/technician-response.mapper';
import { toStockResponse } from '../src/common/response/catalogue-response';
import { toMachineTimelineEventResponse } from '../src/machine-timeline/contracts/machine-timeline-event.mapper';
import {
  MachineTimelineCategory,
  MachineTimelineEvent,
  MachineTimelineEventType,
} from '../src/machine-timeline/machine-timeline.types';

function buildWorkOrder(index: number) {
  return {
    _id: new Types.ObjectId(),
    ot_id: `WO-${index}`,
    machine_id: {
      _id: new Types.ObjectId(),
      machine_id: `MCH-${index}`,
      serial_no: `SN-${index}`,
      status: 'active',
      type_id: new Types.ObjectId(),
    },
    module_id: new Types.ObjectId(),
    technician_id: {
      _id: new Types.ObjectId(),
      user_id: `U-${index}`,
      nom_complet: `Technician ${index}`,
      role: 'technician',
    },
    plan_id: undefined,
    description: `Work order ${index}`,
    type_maintenance: index % 2 === 0 ? 'preventive' : 'corrective',
    status: 'in_progress',
    priorite: 'medium',
    date_created: new Date(),
    date_start: new Date(),
    lifecycle_history: [
      {
        action: 'validated' as const,
        to_status: 'validated',
        actor_user_id: new Types.ObjectId(),
        at: new Date(),
      },
    ],
  };
}

function buildOtPiece(index: number) {
  return {
    _id: new Types.ObjectId(),
    ot_id: new Types.ObjectId(),
    part_id: {
      _id: new Types.ObjectId(),
      part_id: `P-${index}`,
      nom_piece: `Part ${index}`,
      ref_constructeur: `REF-${index}`,
    },
    quantite: index % 5,
  };
}

function buildStock(index: number) {
  return {
    _id: new Types.ObjectId(),
    stock_id: `S-${index}`,
    part_id: {
      _id: new Types.ObjectId(),
      part_id: `P-${index}`,
      nom_piece: `Part ${index}`,
      ref_constructeur: `REF-${index}`,
    },
    quantite_en_stock: 100 - index,
    quantite_reservee: index % 3,
  };
}

const TIMELINE_TYPES = [
  MachineTimelineEventType.MACHINE_CREATED,
  MachineTimelineEventType.WORK_ORDER_CREATED,
  MachineTimelineEventType.INTERVENTION_REPORT_CREATED,
  MachineTimelineEventType.FAULT_REPORTED,
  MachineTimelineEventType.DOCUMENT_UPLOADED,
  MachineTimelineEventType.MAINTENANCE_PLAN_CREATED,
  MachineTimelineEventType.PREVENTIVE_TASK_COMPLETED,
  MachineTimelineEventType.LUBRICATION_COMPLETED,
  MachineTimelineEventType.PARTS_CONSUMED,
  MachineTimelineEventType.AI_RECOMMENDATION_GENERATED,
];

function buildTimelineEvent(index: number): MachineTimelineEvent {
  const type = TIMELINE_TYPES[index % TIMELINE_TYPES.length];
  return {
    id: `evt-${index}`,
    type,
    category: MachineTimelineCategory.SYSTEM,
    at: new Date(),
    title: `Event ${index}`,
    description: `Description ${index}`,
    metadata: { otId: `WO-${index}`, faultCode: `F-${index}`, quantity: index },
  };
}

function bench(name: string, count: number, run: () => unknown[]) {
  const start = performance.now();
  const results = run();
  const durationMs = performance.now() - start;
  const outputSize = Buffer.byteLength(JSON.stringify(results));
  // eslint-disable-next-line no-console
  console.log(
    `${name}: ${count} items in ${durationMs.toFixed(2)}ms ` +
      `(${(durationMs / count).toFixed(4)}ms/item), ` +
      `output ${outputSize} bytes (${(outputSize / count).toFixed(1)} bytes/item)`,
  );
}

const COUNTS = [100, 1000];

for (const count of COUNTS) {
  bench('toWorkOrderResponse', count, () =>
    Array.from({ length: count }, (_, i) =>
      toWorkOrderResponse(buildWorkOrder(i) as never),
    ),
  );
}

bench('technician details parts+stock (100 rows each)', 200, () => [
  ...Array.from({ length: 100 }, (_, i) =>
    toTechnicianPartResponse(buildOtPiece(i) as never),
  ),
  ...Array.from({ length: 100 }, (_, i) => toStockResponse(buildStock(i) as never)),
]);

bench('toMachineTimelineEventResponse (mixed categories)', 500, () =>
  Array.from({ length: 500 }, (_, i) =>
    toMachineTimelineEventResponse(buildTimelineEvent(i)),
  ),
);
