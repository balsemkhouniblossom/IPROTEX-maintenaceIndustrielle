export interface EntityReference { _id: string; [key: string]: unknown }
export type PopulatedReference = string | EntityReference;

export interface Mesure {
  _id: string;
  mesure_id: string;
  capteur_id: PopulatedReference;
  valeur: number;
  timestamp: string;
  status: string;
}

export interface ModulePiece {
  _id: string;
  mod_type_id: PopulatedReference;
  part_id: PopulatedReference;
  quantite_standard: number;
}

export interface PreventiveTask {
  _id: string;
  task_id: string;
  plan_id?: PopulatedReference;
  plan_code?: string;
  module_id?: PopulatedReference;
  instruction: string;
  responsable?: string;
  status: 'pending' | 'completed';
  notes?: string;
  completed_at?: string;
  source: 'plan' | 'manual';
}

export interface CapteurOption { _id: string; capteur_id: string; code_capteur?: string }
export interface ModuleTypeOption { _id: string; mod_type_id: string; nom_module?: string }
export interface CatalogueOption { _id: string; part_id: string; nom_piece?: string }
