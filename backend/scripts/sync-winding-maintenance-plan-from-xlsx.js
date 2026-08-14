require('../dist/load-env.js');

const mongoose = require('mongoose');

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

function slugify(value) {
  let slug = '';
  let pendingSeparator = false;

  for (const character of String(value).normalize('NFD').toUpperCase()) {
    const code = character.codePointAt(0);
    if (code === undefined || (code >= 0x0300 && code <= 0x036f)) {
      continue;
    }

    const isDigit = code >= 48 && code <= 57;
    const isUppercaseLetter = code >= 65 && code <= 90;

    if (isDigit || isUppercaseLetter) {
      if (pendingSeparator && slug) {
        slug += '-';
      }
      slug += character;
      pendingSeparator = false;
    } else if (slug) {
      pendingSeparator = true;
    }
  }

  return slug;
}

async function ensureModuleType(db, machineTypeId) {
  await db.collection('moduletypes').updateOne(
    { mod_type_id: MODULE_TYPE_ID },
    {
      $set: {
        mod_type_id: MODULE_TYPE_ID,
        type_id: String(machineTypeId),
        nom_module: MODULE_TYPE_NAME,
        categorie_module: SOURCE_TITLE,
      },
    },
    { upsert: true },
  );

  return db.collection('moduletypes').findOne(
    { mod_type_id: MODULE_TYPE_ID },
    { projection: { _id: 1 } },
  );
}

async function ensureChecklistModule(db, machine, moduleTypeId) {
  const byExistingName = await db.collection('modules').findOne({
    $expr: { $eq: [{ $toString: '$machine_id' }, String(machine._id)] },
    localisation: MODULE_LOCALISATION,
  });

  if (byExistingName) {
    await db.collection('modules').updateOne(
      { _id: byExistingName._id },
      {
        $set: {
          mod_type_id: String(moduleTypeId),
          machine_id: machine._id,
          localisation: MODULE_LOCALISATION,
        },
      },
    );

    return byExistingName._id;
  }

  const module_id = `MOD-WINDING-${slugify(machine.machine_id)}-CHECKLIST`;
  await db.collection('modules').updateOne(
    { module_id },
    {
      $set: {
        module_id,
        machine_id: machine._id,
        mod_type_id: String(moduleTypeId),
        localisation: MODULE_LOCALISATION,
      },
    },
    { upsert: true },
  );

  const saved = await db.collection('modules').findOne(
    { module_id },
    { projection: { _id: 1 } },
  );
  return saved._id;
}

async function syncPlansForMachine(db, machine, moduleId, templates) {
  const existingPlans = await db.collection('maintenanceplans').find({
    module_id: String(moduleId),
    type_maintenance: 'preventive',
  }).toArray();

  const existingByCode = new Map();
  for (const plan of existingPlans) {
    if (plan.maintenance_code) {
      existingByCode.set(String(plan.maintenance_code).toUpperCase(), plan);
    }
  }

  let created = 0;
  let updated = 0;

  for (const template of templates) {
    const existing = existingByCode.get(template.code);
    const plan_id =
      existing?.plan_id ||
      `MP-WINDING-${slugify(machine.machine_id)}-${template.code}`;

    const result = await db.collection('maintenanceplans').updateOne(
      existing ? { _id: existing._id } : { plan_id },
      {
        $set: {
          plan_id,
          module_id: moduleId,
          type_maintenance: 'preventive',
          frequence: template.frequence,
          unite_frequence: template.unite_frequence,
          instruction: template.instruction,
          maintenance_code: template.code,
          responsable: template.responsable,
          frequence_label: template.frequence_label,
          huile_graisse: template.huile_graisse,
          documentation: template.documentation,
          source_title: SOURCE_TITLE,
          valid_from: '08.08.2011',
          created_by: 'G. Fleischmann',
          approved_by: 'W. Rödel',
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return { created, updated };
}

async function main() {
  const templates = PLAN_TEMPLATES;
  if (templates.length === 0) {
    throw new Error('No winding maintenance templates were extracted');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const machineType = await db
    .collection('machinetypes')
    .findOne({ name: MACHINE_TYPE_NAME });

  if (!machineType) {
    throw new Error(`Machine type not found: ${MACHINE_TYPE_NAME}`);
  }

  const machines = await db
    .collection('machines')
    .find({ type_id: String(machineType._id) })
    .sort({ machine_id: 1 })
    .toArray();

  if (machines.length === 0) {
    throw new Error(`No machines found for machine type: ${MACHINE_TYPE_NAME}`);
  }

  const moduleType = await ensureModuleType(db, machineType._id);
  const summary = [];

  for (const machine of machines) {
    const moduleId = await ensureChecklistModule(db, machine, moduleType._id);
    const sync = await syncPlansForMachine(db, machine, moduleId, templates);
    summary.push({
      machine_id: machine.machine_id,
      module_id: String(moduleId),
      createdPlans: sync.created,
      updatedPlans: sync.updated,
    });
  }

  console.log(
    JSON.stringify(
      {
        workbook: SOURCE_TITLE,
        machineType: MACHINE_TYPE_NAME,
        templateCodes: templates.map((template) => ({
          code: template.code,
          frequence: template.frequence,
          unite_frequence: template.unite_frequence,
          frequence_label: template.frequence_label,
        })),
        machines: summary,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
