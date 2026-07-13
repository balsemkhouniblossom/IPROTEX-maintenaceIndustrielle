require('../dist/load-env.js');

const mongoose = require('mongoose');

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

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
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
    machine_id: String(machine._id),
    localisation: MODULE_LOCALISATION,
  });

  if (byExistingName) {
    await db.collection('modules').updateOne(
      { _id: byExistingName._id },
      {
        $set: {
          mod_type_id: String(moduleTypeId),
          localisation: MODULE_LOCALISATION,
        },
      },
    );

    return byExistingName._id;
  }

  const module_id = `MOD-ROLLING-${slugify(machine.machine_id)}-CHECKLIST`;
  await db.collection('modules').updateOne(
    { module_id },
    {
      $set: {
        module_id,
        machine_id: String(machine._id),
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
      `MP-ROLLING-${slugify(machine.machine_id)}-${template.code}`;

    const result = await db.collection('maintenanceplans').updateOne(
      existing ? { _id: existing._id } : { plan_id },
      {
        $set: {
          plan_id,
          title: `${template.code} - ${MODULE_LOCALISATION}`,
          description: template.instruction,
          module_id: String(moduleId),
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
          localisation: MODULE_LOCALISATION,
          valid_from: '29.09.2022',
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
    const sync = await syncPlansForMachine(db, machine, moduleId, PLAN_TEMPLATES);
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
        templateCodes: PLAN_TEMPLATES.map((template) => ({
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
