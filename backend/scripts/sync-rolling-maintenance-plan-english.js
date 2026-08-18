require('../dist/load-env.js');

const { runMaintenanceSync, syncChecklistMaintenancePlans } = require('./lib/maintenance-plan-sync');

const MACHINE_TYPE_NAME = 'Rolling';
const MODULE_TYPE_ID = 'MT-ROLLING-MACHINE-CHECKLIST';
const MODULE_TYPE_NAME = 'Rolling Machine';
const MODULE_LOCALISATION = 'Rolling Machine';
const SOURCE_TITLE = 'FM_6-5e_Rolling_Maintenance_Sheet_EN.xlsx';

const PLAN_TEMPLATES = [
  {
    code: 'W1',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1 x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Check compressed air lines and fittings.',
      '- Detect any air leak by sound or smell.',
      '',
      'Verification details:',
      '- Perform a visual and audible leak check.',
    ].join('\n'),
  },
  {
    code: 'W2',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1 x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W2:',
      '- Inspect machine safety and control points according to the monthly checklist.',
      '',
      'Verification details:',
      '- Perform the systematic monthly checklist review.',
    ].join('\n'),
  },
  {
    code: 'W3',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1 x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W3:',
      '- Check moving contact areas by touch after safe stop.',
      '- Verify abnormal heat or friction.',
      '',
      'Verification details:',
      '- Perform touch verification only after the machine has safely stopped.',
    ].join('\n'),
  },
  {
    code: 'W4',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1 x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W4:',
      '- Lubricate and clean shaft seals and nearby contact surfaces.',
      '',
      'Verification details:',
      '- Confirm the cleaned and lubricated contact points move normally.',
    ].join('\n'),
  },
  {
    code: 'W5',
    responsable: 'Maintenance',
    frequence: 6,
    unite_frequence: 'month',
    frequence_label: 'Every 6 months',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W5:',
      '- Perform semi-annual preventive inspection of drive and winding assemblies.',
      '',
      'Verification details:',
      '- Complete the scheduled semi-annual maintenance inspection.',
    ].join('\n'),
  },
  {
    code: 'W6',
    responsable: 'Maintenance',
    frequence: 6,
    unite_frequence: 'month',
    frequence_label: 'Every 6 months',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Clean sensors.',
      '- Verify signal behavior under operating conditions.',
      '',
      'Verification details:',
      '- Perform sensor cleaning and validation.',
    ].join('\n'),
  },
];

runMaintenanceSync(syncChecklistMaintenancePlans, {
  machineTypeName: MACHINE_TYPE_NAME,
  machineSlug: 'ROLLING',
  sourceTitle: SOURCE_TITLE,
  moduleTypeId: MODULE_TYPE_ID,
  moduleTypeName: MODULE_TYPE_NAME,
  moduleLocalisation: MODULE_LOCALISATION,
  planTemplates: PLAN_TEMPLATES,
  validFrom: '29.09.2022',
  matchModuleMachineIdAsString: true,
  storeModuleMachineIdAsString: true,
  storePlanModuleIdAsString: true,
  includePlanTitle: true,
  includePlanDescription: true,
  includePlanLocalisation: true,
});
