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
export const FREQUENCE_UNIT_OPTIONS = ['jour', 'semaine', 'mois', 'an'];
const FREQUENCY_UNITS: Record<string, [string, string]> = {
  jour: ['day', 'days'], day: ['day', 'days'], days: ['day', 'days'],
  semaine: ['week', 'weeks'], week: ['week', 'weeks'], weeks: ['week', 'weeks'],
  mois: ['month', 'months'], month: ['month', 'months'], months: ['month', 'months'],
  an: ['year', 'years'], year: ['year', 'years'], years: ['year', 'years'],
};
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
  return displayText(found?.module_id ?? found?.localisation, fallback);
}

export function getModule(value: string | ModuleEntity, modules: ModuleEntity[]): ModuleEntity | undefined {
  const id = typeof value === 'string' ? value : value?._id;
  return modules.find((module) => module._id === id) ?? (typeof value === 'object' ? value : undefined);
}

export function getMachineId(module?: ModuleEntity): string {
  const machine = module?.machine_id;
  return typeof machine === 'string' ? machine : machine?._id ?? '';
}

export function getMachineLabel(module: ModuleEntity | undefined, modules: ModuleEntity[], fallback: string): string {
  const machine = module?.machine_id;
  if (typeof machine === 'object' && machine) {
    return displayText(machine.machine_id ?? machine.nom_machine ?? machine.name, fallback);
  }
  const related = modules.find((item) => getMachineId(item) === machine && typeof item.machine_id === 'object');
  const populated = related?.machine_id;
  return typeof populated === 'object' && populated
    ? displayText(populated.machine_id ?? populated.nom_machine ?? populated.name, fallback)
    : fallback;
}

export function frequencyLabel(frequency: number, unit: string, explicitLabel?: string): string {
  if (unit.toLowerCase() === 'loading') return explicitLabel || 'At each loading / setup';
  const names = FREQUENCY_UNITS[unit.toLowerCase()];
  if (!names || !Number.isFinite(frequency) || frequency <= 0) {
    return explicitLabel || `Every ${frequency} ${unit}`;
  }
  return `Every ${frequency === 1 ? '' : `${frequency} `}${frequency === 1 ? names[0] : names[1]}`;
}

export function frequencyTranslationKey(frequency: number, unit: string): string | null {
  if (unit.toLowerCase() === 'loading') return 'loading';
  const names = FREQUENCY_UNITS[unit.toLowerCase()];
  if (!names || !Number.isFinite(frequency) || frequency <= 0) return null;
  const canonical = names[0];
  return `${canonical}${frequency === 1 ? '' : 's'}`;
}

export function maintenanceTypeLabel(value: string): string {
  if (value === 'corrective_history') return 'Corrective history (legacy)';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
