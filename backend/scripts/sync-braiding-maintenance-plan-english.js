require('../dist/load-env.js');

const mongoose = require('mongoose');

const MACHINE_TYPE_NAME = 'Braiding';
const SOURCE_TITLE = 'Plan_maintenance_tresseuses_EN.xlsx';

const moduleTypes = [
  { key: 'KLOEPPEL', nom_module: 'Bobbin Carrier / Braiding Spindle', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'SCHOLLE', nom_module: 'Base Plate / Spindle Carrier Plate', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'DORN', nom_module: 'Spindle / Rod', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'LAUFBAHN', nom_module: 'Track', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'GETRIEBE', nom_module: 'Gear Unit / Mechanism', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'FLUEGELRAEDER', nom_module: 'Wing Wheels', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'SENSOR1', nom_module: 'Sensor 1 Thread Presence', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'SENSOR2', nom_module: 'Sensor 2 Thread Presence', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'ABZUEGE', nom_module: 'Take-off System', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'TURMGETRIEBE', nom_module: 'Tower Gear Unit / Gear Box', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'UNTERGESTELL', nom_module: 'Base Frame / Lower Chassis', categorie_module: 'Braiding Maintenance Plan' },
  { key: 'TURM', nom_module: 'Tower', categorie_module: 'Braiding Maintenance Plan' },
];

const planTemplates = [
  {
    code: 'W1',
    moduleKey: 'KLOEPPEL',
    responsable: 'Rigger',
    frequence: 1,
    unite_frequence: 'loading',
    frequence_label: 'At each loading / setup',
    huile_graisse: '',
    documentation: 'Via maintenance plan | Maintenance plan sheet',
    instruction: [
      'Checklist for W1:',
      '- Bobbin carrier / braiding spindle: check thread guide eyelets (3) and sleeve (1) for damage and fit.',
      '- Check latch condition and metal clip locking.',
      '- Check rocker arm function.',
      '',
      'Verification details:',
      '- Components must be free of contamination.',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'SCHOLLE',
    responsable: 'Rigger',
    frequence: 1,
    unite_frequence: 'loading',
    frequence_label: 'At each loading / setup',
    huile_graisse: '',
    documentation: 'Via maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Base plate / spindle carrier plate: keep parallel to the base plate.',
      '',
      'Verification details:',
      '- The center must align with the take-off trigger.',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'DORN',
    responsable: 'Rigger',
    frequence: 1,
    unite_frequence: 'loading',
    frequence_label: 'At each loading / setup',
    huile_graisse: '',
    documentation: 'Via maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Spindle / rod: confirm correct size.',
      '- Confirm it is not bent or damaged.',
      '',
      'Verification details:',
      '- The spindle must be centered in the base plate / square bar.',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'LAUFBAHN',
    responsable: 'Rigger',
    frequence: 1,
    unite_frequence: 'loading',
    frequence_label: 'At each loading / setup',
    huile_graisse: '',
    documentation: 'Via maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Track: check for foreign objects and damage.',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'GETRIEBE',
    responsable: 'Rigger',
    frequence: 1,
    unite_frequence: 'loading',
    frequence_label: 'At each loading',
    huile_graisse: 'Mobil Chassis Grease LBZ',
    documentation: 'Via maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Gear unit / mechanism: clean removed gears.',
      '- Grease the new gears before installation.',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'KLOEPPEL',
    responsable: 'Rigger / Maintenance',
    frequence: 1,
    unite_frequence: 'week',
    frequence_label: '1x per week',
    huile_graisse: '',
    documentation: 'In the machine maintenance plan',
    instruction: [
      'Checklist for W2:',
      '- Bobbin carrier / braiding spindle: check locking bolt and cotter pin.',
      '- Check rocker arm and cotter pin.',
      '- Check wear of the braiding bobbin bearing sleeve.',
      '- Check bobbin carrier / spindle foot.',
      '',
      'Verification details:',
      '- Parts must be undamaged and straight.',
      '- Locking bolt must engage correctly in bobbin travel.',
      '- Wear must not affect running properties.',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'LAUFBAHN',
    responsable: 'Rigger / Maintenance',
    frequence: 1,
    unite_frequence: 'week',
    frequence_label: '1x per week',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'In the machine maintenance plan',
    instruction: [
      'Checklist for W2:',
      '- Track: clean thoroughly and check for damage.',
      '- Apply oil between the wing wheels.',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'FLUEGELRAEDER',
    responsable: 'Rigger / Maintenance',
    frequence: 1,
    unite_frequence: 'week',
    frequence_label: '1x per week',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'Maintenance plan sheet',
    instruction: [
      'Checklist for W2:',
      '- Wing wheels: apply oil on the wing wheels.',
      '- Oil in and under the plate on the wing wheel nut.',
      '- Oil on turbines, under the plates, and wheel nuts as required.',
    ].join('\n'),
  },
  {
    code: 'W3',
    moduleKey: 'SENSOR1',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'In the machine maintenance plan',
    instruction: [
      'Checklist for W3:',
      '- Sensor 1 thread presence: test the function of sensor 1.',
      '',
      'Verification details:',
      '- Cut a thread and confirm that the machine stops.',
    ].join('\n'),
  },
  {
    code: 'W3',
    moduleKey: 'SENSOR2',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan sheet',
    instruction: [
      'Checklist for W3:',
      '- Sensor 2 thread presence: test sensor 2 for bobbin presence detection.',
    ].join('\n'),
  },
  {
    code: 'W4',
    moduleKey: 'ABZUEGE',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'In the machine maintenance plan | Maintenance plan sheet',
    instruction: [
      'Checklist for W4:',
      '- Take-off system: check rollers for function and wear.',
      '- Check the function and wear of the take-off rollers.',
    ].join('\n'),
  },
  {
    code: 'W5',
    moduleKey: 'KLOEPPEL',
    responsable: 'Maintenance',
    frequence: 2,
    unite_frequence: 'year',
    frequence_label: '2 times per year',
    huile_graisse: 'Mobil Chassis Grease LBZ',
    documentation: 'In the machine maintenance plan | Maintenance plan sheet',
    instruction: [
      'Checklist for W5:',
      '- Bobbin carrier: grease sliding rods.',
      '- Braiding spindle: grease the sliding rods.',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'TURMGETRIEBE',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'In the machine maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Tower gear unit / gear box: check grease and oil level.',
      '- Grease or top up oil if necessary.',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'FLUEGELRAEDER',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Wing wheels: check and retighten if necessary.',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'ABZUEGE',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Take-off system: check roller function and wear.',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'KLOEPPEL',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Bobbin carrier / braiding spindle: remove rocker arm springs and oil them.',
    ].join('\n'),
  },
  {
    code: 'W7',
    moduleKey: 'UNTERGESTELL',
    responsable: 'Maintenance',
    frequence: 2,
    unite_frequence: 'year',
    frequence_label: 'Every 2 years',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'In the machine maintenance plan',
    instruction: [
      'Checklist for W7:',
      '- Base frame / lower chassis: perform the oil change.',
    ].join('\n'),
  },
  {
    code: 'W7',
    moduleKey: 'TURM',
    responsable: 'Maintenance',
    frequence: 2,
    unite_frequence: 'year',
    frequence_label: 'Every 2 years',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W7:',
      '- Tower: perform the oil change.',
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

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const machineType = await db.collection('machinetypes').findOne({ name: MACHINE_TYPE_NAME });
  if (!machineType) {
    throw new Error(`Machine type not found: ${MACHINE_TYPE_NAME}`);
  }

  const machines = await db.collection('machines').find({ type_id: String(machineType._id) }).toArray();
  if (machines.length === 0) {
    throw new Error(`No machines found for machine type: ${MACHINE_TYPE_NAME}`);
  }

  const moduleTypeIds = new Map();
  let moduleTypeUpdates = 0;
  for (const moduleType of moduleTypes) {
    const mod_type_id = `MT-BRAID-${moduleType.key}`;
    await db.collection('moduletypes').updateOne(
      { mod_type_id },
      {
        $set: {
          mod_type_id,
          type_id: String(machineType._id),
          nom_module: moduleType.nom_module,
          categorie_module: moduleType.categorie_module,
        },
      },
      { upsert: true },
    );

    const saved = await db.collection('moduletypes').findOne({ mod_type_id }, { projection: { _id: 1 } });
    moduleTypeIds.set(moduleType.key, saved._id);
    moduleTypeUpdates += 1;
  }

  const moduleIds = new Map();
  let moduleUpdates = 0;
  for (const machine of machines) {
    for (const moduleType of moduleTypes) {
      const module_id = `MOD-BRAID-${slugify(machine.machine_id)}-${moduleType.key}`;
      await db.collection('modules').updateOne(
        { module_id },
        {
          $set: {
            module_id,
            machine_id: String(machine._id),
            mod_type_id: String(moduleTypeIds.get(moduleType.key)),
            localisation: moduleType.nom_module,
          },
        },
        { upsert: true },
      );
      const saved = await db.collection('modules').findOne({ module_id }, { projection: { _id: 1 } });
      moduleIds.set(`${machine._id}:${moduleType.key}`, String(saved._id));
      moduleUpdates += 1;
    }
  }

  let planUpdates = 0;
  for (const machine of machines) {
    for (const template of planTemplates) {
      const module_id = moduleIds.get(`${machine._id}:${template.moduleKey}`);
      const plan_id = `MP-BRAID-${slugify(machine.machine_id)}-${template.code}-${template.moduleKey}`;
      await db.collection('maintenanceplans').updateOne(
        { plan_id },
        {
          $set: {
            plan_id,
            module_id,
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
      planUpdates += 1;
    }
  }

  const totalEnglishPlans = await db.collection('maintenanceplans').countDocuments({ source_title: SOURCE_TITLE });
  console.log(JSON.stringify({
    machineType: machineType.name,
    machineCount: machines.length,
    moduleTypeUpdates,
    moduleUpdates,
    planUpdates,
    totalEnglishPlans,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
