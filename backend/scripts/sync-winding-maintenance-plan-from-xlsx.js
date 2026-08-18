require('../dist/load-env.js');

const { runMaintenanceSync, syncChecklistMaintenancePlans } = require('./lib/maintenance-plan-sync');

const MACHINE_TYPE_NAME = 'Winding';
const MODULE_TYPE_ID = 'MT-WINDING-MACHINE-CHECKLIST';
const MODULE_TYPE_NAME = 'Winding Machine';
const MODULE_LOCALISATION = 'Winding Machine';
const SOURCE_TITLE = 'FM_6-5_Winding_Maintenance_Plan_EN.xlsx';

const PLAN_TEMPLATES = [
  {
    code: 'W1',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation:
      'in the machine maintenance plan and the maintenance overview | In the maintenance plan / machine maintenance table',
    instruction: [
      'Checklist for W1:',
      '- Check the movable guard on the winding spindles.',
      '- Check the movable guard on the bobbin spindles.',
      '',
      'Verification details:',
      '- Function test of machine safety door: if door is open, the machine must not start.',
    ].join('\n'),
  },
  {
    code: 'W2',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation:
      'in the machine maintenance plan and the maintenance overview In the maintenance plan / machine maintenance table | in the machine maintenance plan and the maintenance overviewin the machine maintenance plan/maintenance table',
    instruction: [
      'Checklist for W2:',
      '- Check all thread brakes on the bobbin creel.',
      '- Check all thread brakes on the bobbin holder.',
      '- Check thread guide and deflection elements for damage.',
      '',
      'Verification details:',
      '- When the axis is touched, it must return to its starting position.',
      '- No damage and unobstructed wire passage.',
      '- The eyelets are located at the bobbin feed level on the winding machine.',
      '- Visual and tactile inspection.',
    ].join('\n'),
  },
  {
    code: 'W3',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: 'Berner high-performance lubricant',
    documentation:
      'in the machine maintenance plan and the maintenance overview | in the machine maintenance plan/maintenance table',
    instruction: [
      'Checklist for W3:',
      '- Check bobbin winding stroke for smooth operation.',
      '- Check the bobbin winding stroke sliding rods.',
      '- Lubricate the transport carriage.',
      '',
      'Verification details:',
      '- Limit switch sensor: when touched, the axis must return to its initial position.',
      '- Test on machine.',
      '- Rods and gears must be lubricated.',
    ].join('\n'),
  },
  {
    code: 'W4',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: 'Toolcraft pneumatic oil type S',
    documentation:
      'in the machine maintenance plan and the maintenance overview | in the machine maintenance plan/maintenance table',
    instruction: [
      'Checklist for W4:',
      '- Check the air pressure gauge and air pressure system.',
      '- Check the oil level in the lubrication piston and top up if necessary.',
      '- Drain condensation water.',
      '',
      'Verification details:',
      '- Pressure gauge: check zero, variation, and stabilization.',
      '- Check the piston oil level against the min-max indication.',
      '- Vent the air pressure system.',
    ].join('\n'),
  },
  {
    code: 'W5',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'in the machine maintenance plan',
    instruction: [
      'Checklist for W5:',
      '- Check the function of the thread sensor.',
      '',
      'Verification details:',
      '- Cut the thread to test sensor response.',
    ].join('\n'),
  },
  {
    code: 'W6',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: 'Berner high-performance lubricant',
    documentation:
      'in the machine maintenance plan and the maintenance overview | in the machine maintenance plan/maintenance table',
    instruction: [
      'Checklist for W6:',
      '- Clean the ventilation grille on the winding machine.',
      '- Check the V-belt for correct tension and wear.',
      '- Check the oil level in the reverse gear and top up if necessary.',
      '',
      'Verification details:',
      '- Check visually.',
      '- Check condition by touch.',
      '- Perform a functionality test.',
    ].join('\n'),
  },
  {
    code: 'W7',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: '',
    documentation:
      'in the machine maintenance plan and the maintenance overview | in the machine maintenance plan/maintenance table',
    instruction: [
      'Checklist for W7:',
      '- Replace the ventilation grille on the winding machine.',
      '',
      'Verification details:',
      '- Check the grille condition for damage.',
      '- Annual task for verification and replacement planning.',
    ].join('\n'),
  },
];

runMaintenanceSync(syncChecklistMaintenancePlans, {
  machineTypeName: MACHINE_TYPE_NAME,
  machineSlug: 'WINDING',
  sourceTitle: SOURCE_TITLE,
  moduleTypeId: MODULE_TYPE_ID,
  moduleTypeName: MODULE_TYPE_NAME,
  moduleLocalisation: MODULE_LOCALISATION,
  planTemplates: PLAN_TEMPLATES,
  validFrom: '08.08.2011',
  matchModuleMachineIdAsString: false,
  storeModuleMachineIdAsString: false,
  storePlanModuleIdAsString: false,
  includePlanTitle: false,
  includePlanDescription: false,
  includePlanLocalisation: false,
});
