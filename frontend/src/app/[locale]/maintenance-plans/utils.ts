import { displayText } from '@/services/displayValues';
import { MaintenancePlanStatus, ModuleEntity } from './types';

export const STATUS_BADGE_CLASSES: Record<MaintenancePlanStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  active: 'bg-green-100 text-green-800 border-green-200',
  paused: 'bg-amber-100 text-amber-800 border-amber-200',
  archived: 'bg-gray-200 text-gray-600 border-gray-300',
  completed: 'bg-blue-100 text-blue-800 border-blue-200',
};

export const CUSTOM_OPTION = '__custom__';

export const MAINTENANCE_TYPE_OPTIONS = ['preventive', 'corrective', 'inspection', 'lubrication'];
export const FREQUENCE_OPTIONS = ['1', '2', '3', '4', '6', '12'];
export const FREQUENCE_UNIT_OPTIONS = ['jour', 'semaine', 'mois', 'trimestre', 'semestre', 'an'];
export const RESPONSABLE_OPTIONS = ['Maintenance', 'Operator', 'Supervisor', 'Quality'];
export const HUILE_GRAISSE_OPTIONS = ['Huile', 'Graisse', 'Aucune'];
export const DOCUMENTATION_OPTIONS = ['Maintenance plan', 'Machine maintenance plan', 'SOP', 'Checklist'];
export const INSTRUCTION_OPTIONS = [
  'Visual inspection',
  'Clean and lubricate',
  'Check safety points',
  'Verify sensor status',
  'Tighten fittings and connectors',
];

export function getSelectValue(options: string[], value: string): string {
  return options.includes(value) ? value : CUSTOM_OPTION;
}

export function getNextFieldValue(options: string[], currentValue: string, selectedValue: string): string {
  if (selectedValue !== CUSTOM_OPTION) {
    return selectedValue;
  }
  return options.includes(currentValue) ? '' : currentValue;
}

export function mergeOptions(dynamicValues: Array<string | undefined>, fixedValues: string[] = []): string[] {
  const values = [...fixedValues, ...dynamicValues]
    .map((value) => (value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

export function cleanInstruction(value?: string): string {
  return (value || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:Photo|Mode)\s*:\s*N\/A\s*$/i.test(line))
    .join('\n')
    .trim();
}

export function cleanResponsable(value?: string): string {
  const responsable = (value || '').trim();
  return /setup\s*technician/i.test(responsable) ? 'Maintenance' : responsable;
}

export function getModuleLabel(value: string | ModuleEntity, modules: ModuleEntity[], fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'object') {
    return displayText(value.module_id ?? value.localisation, fallback);
  }
  const found = modules.find((module) => module._id === value);
  return displayText(found?.module_id ?? found?.localisation ?? value, fallback);
}
