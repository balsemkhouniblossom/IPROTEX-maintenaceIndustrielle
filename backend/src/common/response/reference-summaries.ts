import { MachineDocument } from '../../schemas/machine.schema';
import { MachineTypeDocument } from '../../schemas/machine-type.schema';
import { ModuleDocument } from '../../schemas/module.schema';
import { MaintenancePlanDocument } from '../../schemas/maintenance-plan.schema';
import { Role } from '../../schemas/user.schema';
import { mapPopulatedRef, serializeObjectId } from './serialization.util';

/**
 * Focused summary response types for the populated references priority
 * endpoints (Work Orders, Machines, Operator, Technician, Machine Timeline)
 * commonly expose. Each mirrors only the fields those endpoints actually
 * populate today — not every field on the underlying schema — so widening
 * one of these to add a field is a deliberate, reviewable contract change
 * rather than an accidental leak of a newly-added schema field.
 */

/** Mirrors the `'name'` (optionally `'name description'`) populate projection used for `type_id`. */
export interface MachineTypeSummaryResponse {
  _id: string;
  type_id?: number;
  name: string;
  description?: string;
}

/** Mirrors a `.populate('machine_id')` (full document) or `.populate('machine_id', '...')` (projected) result. */
export interface MachineSummaryResponse {
  _id: string;
  machine_id: string;
  serial_no?: string;
  reference?: string;
  fabricant?: string;
  model?: string;
  location?: string;
  status?: string;
  type_id?: string | MachineTypeSummaryResponse;
}

export interface ModuleSummaryResponse {
  _id: string;
  module_id: string;
  machine_id?: string | MachineSummaryResponse;
  mod_type_id?: string;
  parent_module_id?: string;
  localisation?: string;
}

/**
 * Every `.populate('plan_id'|'module_id' -> plan lookups)` call site in the
 * codebase populates the full `MaintenancePlan` document (no field-limiting
 * projection is ever used for this ref), so — unlike the other summary
 * types above — this mirrors every schema field, not a narrowed subset.
 */
export interface MaintenancePlanSummaryResponse {
  _id: string;
  plan_id: string;
  module_id?: string;
  type_maintenance: string;
  frequence: number;
  unite_frequence: string;
  instruction?: string;
  responsable?: string;
  huile_graisse?: string;
  documentation?: string;
  maintenance_code?: string;
  frequence_label?: string;
  status?: string;
  version?: number;
}

/**
 * Mirrors `SAFE_USER_PROJECTION` (`'nom_complet user_id role'`,
 * `src/users/safe-user-projection.ts`) exactly — every populated `User` ref
 * on a priority-module response must be this shape, never the full `User`
 * document. Deliberately excludes `photo`: the schema-level projection never
 * requests it, so it is never actually present at runtime today.
 */
export interface UserSummaryResponse {
  _id: string;
  user_id?: string;
  nom_complet?: string;
  role?: Role | string;
}

export function toMachineTypeSummary(
  doc: MachineTypeDocument,
): MachineTypeSummaryResponse {
  return {
    _id: serializeObjectId(doc._id)!,
    type_id: doc.type_id,
    name: doc.name,
    description: doc.description,
  };
}

export function toMachineSummary(
  doc: MachineDocument,
): MachineSummaryResponse {
  return {
    _id: serializeObjectId(doc._id)!,
    machine_id: doc.machine_id,
    serial_no: doc.serial_no,
    reference: doc.reference,
    fabricant: doc.fabricant,
    model: doc.model,
    location: doc.location,
    status: doc.status,
    type_id: mapPopulatedRef(
      doc.type_id as unknown as MachineTypeDocument | string | undefined | null,
      toMachineTypeSummary,
    ),
  };
}

export function toModuleSummary(doc: ModuleDocument): ModuleSummaryResponse {
  return {
    _id: serializeObjectId(doc._id)!,
    module_id: doc.module_id,
    machine_id: mapPopulatedRef(
      doc.machine_id as unknown as MachineDocument | string | undefined | null,
      toMachineSummary,
    ),
    mod_type_id: serializeObjectId(doc.mod_type_id),
    parent_module_id: serializeObjectId(doc.parent_module_id),
    localisation: doc.localisation,
  };
}

export function toMaintenancePlanSummary(
  doc: MaintenancePlanDocument,
): MaintenancePlanSummaryResponse {
  return {
    _id: serializeObjectId(doc._id)!,
    plan_id: doc.plan_id,
    module_id: serializeObjectId(doc.module_id),
    type_maintenance: doc.type_maintenance,
    frequence: doc.frequence,
    unite_frequence: doc.unite_frequence,
    instruction: doc.instruction,
    responsable: doc.responsable,
    huile_graisse: doc.huile_graisse,
    documentation: doc.documentation,
    maintenance_code: doc.maintenance_code,
    frequence_label: doc.frequence_label,
    status: doc.status,
    version: doc.version,
  };
}

export function toUserSummary(doc: {
  _id: unknown;
  user_id?: string;
  nom_complet?: string;
  role?: Role | string;
}): UserSummaryResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    user_id: doc.user_id,
    nom_complet: doc.nom_complet,
    role: doc.role,
  };
}
