require('../dist/load-env.js');

const mongoose = require('mongoose');

const MACHINE_TYPE_NAME = 'Cutting';
const MODULE_ID = 'MOD-ADMIN-CUTTING-CUTTING-MACHINE';
const MODULE_LOCALISATION = 'Cutting Machine';
const SOURCE_TITLE = 'FM_6-5c_HSGM_Cutting_Maintenance_Plan_EN.xlsx';

const PLAN_TEMPLATES = [
  {
    code: 'W1',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W1:',
      '- Check the movable guard on the cutting head.',
      '- Clean and grease the cutting guides.',
      '',
      'Verification details:',
      '- If the safety door is open, the machine must not start.',
    ].join('\n'),
  },
  {
    code: 'W2',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'week',
    frequence_label: '1x per week',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W2:',
      '- Check the hot-cutting blades for damage.',
      '- Check the ribbed feed rollers for damage.',
      '',
      'Verification details:',
      '- Inspect 2 blades visually or by touch for damage, breakage, or wear.',
      '- Inspect 3 rollers visually or by touch for damage.',
    ].join('\n'),
  },
  {
    code: 'W3',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W3:',
      '- Check and clean the ventilation filters on the cutting machine.',
      '',
      'Verification details:',
      '- The system includes 2 cabinets and 4 filters.',
    ].join('\n'),
  },
  {
    code: 'W4',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W4:',
      '- Check the air pressure gauge and the air pressure system.',
      '- Verify the pressure gauge is between 4 and 8 bar depending on the reference.',
      '- Check the pneumatics for leaks.',
      '',
      'Verification details:',
      '- Detect air leaks by smell or sound.',
    ].join('\n'),
  },
  {
    code: 'W5',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'year',
    frequence_label: '1x per year',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W5:',
      '- Replace the ventilation filter on the cutting machine.',
    ].join('\n'),
  },
  {
    code: 'W6',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W6:',
      '- Check the sensors.',
      '',
      'Verification details:',
      '- There are 2 sensors to verify.',
    ].join('\n'),
  },
  {
    code: 'W7',
    responsable: 'Maintenance staff',
    frequence: 1,
    unite_frequence: 'month',
    frequence_label: '1x per month',
    huile_graisse: '',
    documentation: 'Maintenance plan',
    instruction: [
      'Checklist for W7:',
      '- Check the emergency-stop circuit lamp test.',
      '',
      'Verification details:',
      '- Verify by on/off test.',
    ].join('\n'),
  },
];

async function syncPlansForModule(db, moduleObjectId) {
  const existingPlans = await db
    .collection('maintenanceplans')
    .find({
      module_id: String(moduleObjectId),
      type_maintenance: 'preventive',
      maintenance_code: { $in: PLAN_TEMPLATES.map((template) => template.code) },
    })
    .toArray();

  const existingByCode = new Map(
    existingPlans.map((plan) => [String(plan.maintenance_code).toUpperCase(), plan]),
  );

  let updated = 0;

  for (const template of PLAN_TEMPLATES) {
    const existing = existingByCode.get(template.code);
    if (!existing) {
      throw new Error(`Missing Cutting preventive plan for ${template.code}`);
    }

    await db.collection('maintenanceplans').updateOne(
      { _id: existing._id },
      {
        $set: {
          title: `${template.code} - ${MODULE_LOCALISATION}`,
          description: template.instruction,
          instruction: template.instruction,
          type_maintenance: 'preventive',
          frequence: template.frequence,
          unite_frequence: template.unite_frequence,
          frequence_label: template.frequence_label,
          maintenance_code: template.code,
          responsable: template.responsable,
          huile_graisse: template.huile_graisse,
          documentation: template.documentation,
          localisation: MODULE_LOCALISATION,
          source_title: SOURCE_TITLE,
          valid_from: existing.valid_from || '29.09.2022',
          created_by: existing.created_by || 'G. Fleischmann',
          approved_by: existing.approved_by || 'W. Rödel',
        },
      },
    );

    updated += 1;
  }

  return updated;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const machineType = await db.collection('machinetypes').findOne({ name: MACHINE_TYPE_NAME });
  if (!machineType) {
    throw new Error(`Machine type not found: ${MACHINE_TYPE_NAME}`);
  }

  const module = await db.collection('modules').findOne({ module_id: MODULE_ID });
  if (!module) {
    throw new Error(`Checklist module not found: ${MODULE_ID}`);
  }

  await db.collection('modules').updateOne(
    { _id: module._id },
    {
      $set: {
        localisation: MODULE_LOCALISATION,
      },
    },
  );

  const updatedPlans = await syncPlansForModule(db, module._id);

  console.log(
    JSON.stringify(
      {
        workbook: SOURCE_TITLE,
        machineType: machineType.name,
        module_id: MODULE_ID,
        updatedPlans,
        maintenanceCodes: PLAN_TEMPLATES.map((template) => ({
          code: template.code,
          frequence: template.frequence,
          unite_frequence: template.unite_frequence,
          frequence_label: template.frequence_label,
        })),
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
