export interface ModuleEntity {
  _id: string;
  module_id?: string;
  localisation?: string;
}

export type MaintenancePlanStatus = 'draft' | 'active' | 'paused' | 'archived' | 'completed';
export type MaintenancePlanTransitionAction = 'activate' | 'pause' | 'resume' | 'archive' | 'complete';

export interface MaintenancePlan {
  _id: string;
  plan_id: string;
  module_id: string | ModuleEntity;
  type_maintenance: string;
  frequence: number;
  unite_frequence: string;
  instruction?: string;
  responsable?: string;
  huile_graisse?: string;
  documentation?: string;
  maintenance_code?: string;
  frequence_label?: string;
  status?: MaintenancePlanStatus;
  version?: number;
}

export interface MaintenancePlansFilters {
  status: string;
  typeMaintenance: string;
  [key: string]: string;
}

export type SavedMaintenancePlansQuery = {
  search?: string;
  status?: string;
  typeMaintenance?: string;
  sort?: string;
};
