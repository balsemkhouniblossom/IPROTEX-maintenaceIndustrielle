# Technician implementation mapping

This module does not add or modify any MongoDB schema, entity, collection, or relationship.

| Technician concern | Existing storage used | Existing application value / relation | Technician API |
| --- | --- | --- | --- |
| Assignment | `WorkOrder.technician_id` → `User` | `assigned` | `PATCH /technician/work-orders/:id/claim` |
| Awaiting report review | `WorkOrder.status`, `InterventionReport.validation_responsable` | `waiting_validation`, `technician_required` | `GET /technician/work-orders`, `PATCH .../:id/review` |
| Returned submission | Same work order and report | `returned` | `PATCH .../:id/review` |
| Active intervention | `WorkOrder.status`, `date_start`, `technician_id` | `in_progress` | `PATCH .../:id/start`, `PATCH .../:id/resume` |
| Waiting for parts | `WorkOrder.status` | `waiting_parts` | `PATCH .../:id/waiting-parts` |
| Completed intervention | `WorkOrder.status`, `date_end`, `date_closed` | `completed` | `PATCH .../:id/close` |
| Technical report | Existing `InterventionReport` linked by `ot_id` | `cause_racine`, `description_action`, `etat_final`, `validation_responsable`, `date_fin` | `PATCH .../:id/report` |
| Machine context | `WorkOrder.machine_id` → `Machine.type_id` → `MachineType` | Existing populated relations | `GET .../:id` |
| Preventive context | `WorkOrder.plan_id` → `MaintenancePlan` | Existing populated relation | `GET .../:id` |
| Manuals | `DocumentEntity.machine_id` → `Machine` | Existing file fields and document types | `GET /technician/manuals` |
| Part usage | `OT_Pieces.ot_id`, `OT_Pieces.part_id` → `Catalogue` | Existing line; submitted quantity is the desired total, making retries idempotent | `POST .../:id/parts` |
| Stock | `Stock.part_id` → `Catalogue` | Atomic guarded decrement; no direct frontend stock write | `POST .../:id/parts` |
| Dashboard KPIs | Derived from existing work orders | No stored technician counters | `GET /technician/dashboard` |

The report's existing `technician_id` is not overwritten during review/start because the current operator history uses it as the report-owner scope. Technician assignment is therefore held in the existing, purpose-specific `WorkOrder.technician_id`, preserving the original operator report in operator history.
