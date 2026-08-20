require('../dist/load-env.js');

const mongoose = require('mongoose');
const {
  ensureNamedModule,
  loadMachineType,
  loadReferenceMachine,
  normalizeText,
  parseMaintenanceFrequency,
  slugify,
} = require('./lib/maintenance-plan-sync');

const ADMIN_HISTORY_ROWS = [
  {
    category: 'Braiding',
    rows: [
      {
        maintenance: 'W1',
        module: 'Braiding Bobbin',
        responsible: 'Setup Technician',
        frequency: 'At each loading',
        operation:
          'Check thread guide eyelets and sleeve for damage and proper seating. Confirm clip lock and oscillating lever function. Keep clean.',
        mode: '',
        photo: '',
        oilGrease: 'Mobil Chassis Grease LBZ',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W1',
        module: 'Bobbin Carrier Plate',
        responsible: 'Setup Technician',
        frequency: 'At each loading',
        operation: 'Check the bobbin carrier plate alignment parallel to base plate and centered with draw-off.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W1',
        module: 'Mandrel Pin',
        responsible: 'Setup Technician',
        frequency: 'At each loading',
        operation: 'Check correct pin size, no bending or damage, centered in the carrier plate.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W1',
        module: 'Track Path',
        responsible: 'Setup Technician',
        frequency: 'At each loading',
        operation: 'Inspect track path for foreign objects and damage.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W1',
        module: 'Gear Mechanism',
        responsible: 'Setup Technician',
        frequency: 'At each loading',
        operation: 'Clean removed gears and grease newly installed gears.',
        mode: '',
        photo: '',
        oilGrease: 'Mobil Chassis Grease LBZ',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W2',
        module: 'Braiding Bobbin',
        responsible: 'Setup Technician / Maintenance',
        frequency: '1 x per week',
        operation:
          'Check locking pin and split pin condition. Check oscillating lever and pin. Inspect bushing wear and bobbin foot condition.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W2',
        module: 'Track Path',
        responsible: 'Setup Technician / Maintenance',
        frequency: '1 x per week',
        operation: 'Thoroughly clean the mechanism path and inspect for damage. Oil between wing wheels.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol B 220',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W2',
        module: 'Wing Wheels',
        responsible: 'Setup Technician / Maintenance',
        frequency: '1 x per week',
        operation: 'Apply oil on wing wheels and under plates at wing-wheel nut points.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol B 220',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W3',
        module: 'Wire Presence Sensor 1',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Test wire presence sensor 1. Cut one wire and verify machine stop response.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W3',
        module: 'Wire Presence Sensor 2',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Test wire presence sensor 2 and verify bobbin presence stop response.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W4',
        module: 'Draw-Off System',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check draw-off rollers for operation and wear.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W5',
        module: 'Braiding Bobbin',
        responsible: 'Maintenance',
        frequency: '2 x per year',
        operation: 'Grease sliding rods of braiding bobbins.',
        mode: '',
        photo: '',
        oilGrease: 'Mobil Chassis Grease LBZ',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W6',
        module: 'Tower Gearbox',
        responsible: 'Maintenance',
        frequency: '1 x per year',
        operation: 'Check gearbox lubricant condition. Grease or refill oil if required.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol BG 150',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W6',
        module: 'Wing Wheels',
        responsible: 'Maintenance',
        frequency: '1 x per year',
        operation: 'Inspect wing wheels and tighten when needed.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W6',
        module: 'Draw-Off System',
        responsible: 'Maintenance',
        frequency: '1 x per year',
        operation: 'Inspect draw-off roller operation and wear.',
        mode: '',
        photo: '',
        oilGrease: '',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W6',
        module: 'Braiding Bobbin',
        responsible: 'Maintenance',
        frequency: '1 x per year',
        operation: 'Remove and oil oscillating lever springs.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol B 220',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W7',
        module: 'Lower Chassis',
        responsible: 'Maintenance',
        frequency: 'Every 2 years',
        operation: 'Perform complete oil change on lower chassis.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol BG 150',
        documentation: 'Machine maintenance plan',
      },
      {
        maintenance: 'W7',
        module: 'Tower',
        responsible: 'Maintenance',
        frequency: 'Every 2 years',
        operation: 'Perform complete oil change on tower.',
        mode: '',
        photo: '',
        oilGrease: 'ARAL Degol BG 150',
        documentation: 'Machine maintenance plan',
      },
    ],
  },
  {
    category: 'Rolling',
    rows: [
      {
        maintenance: 'W1',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check compressed air lines and fittings; detect any air leak by sound or smell.',
        mode: 'Visual and audible leak check',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W2',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Inspect machine safety and control points according to the monthly checklist.',
        mode: 'Systematic monthly checklist',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W3',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check moving contact areas by touch after safe stop; verify abnormal heat or friction.',
        mode: 'Touch verification after stop',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W4',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Lubricate and clean shaft seals and nearby contact surfaces.',
        mode: 'Lubricate and clean',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W5',
        responsible: 'Maintenance',
        frequency: 'Every 6 months',
        operation: 'Perform semi-annual preventive inspection of drive and winding assemblies.',
        mode: 'Scheduled semi-annual maintenance',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W6',
        responsible: 'Maintenance',
        frequency: 'Every 6 months',
        operation: 'Clean sensors and verify signal behavior under operating conditions.',
        mode: 'Sensor cleaning and validation',
        photo: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
    ],
  },
  {
    category: 'Winding',
    rows: [
      {
        maintenance: 'W1',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check pneumatic system for leaks.',
        photo: '',
        mode: 'Detect leaks by listening or smelling for escaping air.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W2',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check emergency-stop circuit lamp test and test metal detector function.',
        photo: '',
        mode: 'Machine must stop when metal is detected.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W3',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Check emergency-stop circuit lamp test.',
        photo: '',
        mode: 'Verify by touch test.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W4',
        responsible: 'Maintenance',
        frequency: '1 x per month',
        operation: 'Lubricate and clean shaft joint points.',
        photo: '',
        mode: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W5',
        responsible: 'Maintenance',
        frequency: 'Every 6 months',
        operation: 'Lubricate linear bearings.\n\nCheck filter mats and replace when necessary.\n\nClean cabinet ventilation.',
        photo: '',
        mode: '2 bearings on sliding shaft\n1 bearing at bobbin shaft\n2 bearings on sliding shaft\n1 bearing at bobbin shaft\n\nSystem includes 2 cabinets and 4 filters.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W6',
        responsible: 'Maintenance',
        frequency: 'Every 6 months',
        operation: 'Clean sensors.',
        photo: '',
        mode: 'System includes 3 detectors.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
    ],
  },
  {
    category: 'Cutting',
    rows: [
      {
        maintenance: 'W1',
        responsible: 'Maintenance staff',
        frequency: '1 x per month',
        operation: 'Check the movable protection on the cutting head.\nClean and grease the cutting guides.',
        photo: '',
        mode: 'If the safety door is open, the machine does not start.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W2',
        responsible: 'Maintenance staff',
        frequency: '1 x per week',
        operation: 'Inspect the hot cutting blades for damage.\nInspect the ribbed feed rollers for damage.',
        photo: '',
        mode: '2 blades to inspect visually or by touch for damage, breakage, or wear.\n\n3 rollers to inspect visually or by touch for damage.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W3',
        responsible: 'Maintenance staff',
        frequency: '1 x per month',
        operation: 'Inspect and clean the ventilation filters on the cutting machine.',
        photo: '',
        mode: 'The system includes 2 cabinets and 4 filters.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W4',
        responsible: 'Maintenance staff',
        frequency: '1 x per month',
        operation:
          'Check the air pressure gauge and pneumatic system.\nVerify air pressure is between 4 and 8 bars depending on the reference.\n\nCheck the pneumatic system for leaks.',
        photo: '',
        mode: 'Detect escaping air by smell or sound.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W5',
        responsible: 'Maintenance staff',
        frequency: '1 x per year',
        operation: 'Replace the ventilation filter on the cutting machine.',
        photo: '',
        mode: '',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W6',
        responsible: 'Maintenance staff',
        frequency: '1 x per month',
        operation: 'Check the sensors.',
        photo: '',
        mode: 'This concerns 2 detectors.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
      {
        maintenance: 'W7',
        responsible: 'Maintenance staff',
        frequency: '1 x per month',
        operation: 'Check the emergency-stop circuit lamp test.',
        photo: '',
        mode: 'Verify by on/off test.',
        oilGrease: '',
        documentation: 'Maintenance plan',
      },
    ],
  },
];

function buildInstruction(row) {
  return [
    `Operation: ${normalizeText(row.operation)}`,
    `Mode: ${normalizeText(row.mode)}`,
    `Photo: ${normalizeText(row.photo)}`,
  ].join('\n');
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  await db.collection('maintenanceplans').deleteMany({
    plan_id: { $regex: /^MP-ADMIN-/ },
  });

  const summary = {
    categories: {},
    totalRowsImported: 0,
  };

  for (const categoryGroup of ADMIN_HISTORY_ROWS) {
    const categoryName = categoryGroup.category;
    const machineType = await loadMachineType(db, categoryName);
    const machine = await loadReferenceMachine(db, machineType._id, categoryName);

    let importedRows = 0;

    for (let i = 0; i < categoryGroup.rows.length; i += 1) {
      const row = categoryGroup.rows[i];
      const moduleLabel = normalizeText(row.module || `${categoryName} Machine`);
      const moduleId = await ensureNamedModule(db, {
        moduleTypePrefix: 'MT-ADMIN',
        modulePrefix: 'MOD-ADMIN',
        machineTypeName: categoryName,
        machineTypeId: machineType._id,
        machineId: machine._id,
        moduleLabel,
      });
      const parsedFrequency = parseMaintenanceFrequency(row.frequency);

      const planId = `MP-ADMIN-${slugify(categoryName)}-${slugify(row.maintenance)}-${String(i + 1).padStart(2, '0')}`;

      await db.collection('maintenanceplans').updateOne(
        { plan_id: planId },
        {
          $set: {
            plan_id: planId,
            module_id: moduleId,
            type_maintenance: 'preventive',
            frequence: parsedFrequency.frequence,
            unite_frequence: normalizeText(parsedFrequency.unite_frequence),
            instruction: buildInstruction(row),
            responsable: normalizeText(row.responsible),
            huile_graisse: normalizeText(row.oilGrease),
            documentation: normalizeText(row.documentation),
            maintenance_code: normalizeText(row.maintenance),
            frequence_label: normalizeText(row.frequency),
            // These plans represent equipment already in service, so they
            // start life Active (not Draft). The preceding deleteMany
            // means every upsert here is a fresh insert, so there is no
            // existing lifecycle state to preserve.
            status: 'active',
            version: 1,
            lifecycle_history: [
              {
                action: 'created',
                to_status: 'active',
                reason: 'Bulk-imported from historical preventative maintenance data',
                at: new Date(),
              },
            ],
          },
        },
        { upsert: true },
      );

      importedRows += 1;
    }

    summary.categories[categoryName] = importedRows;
    summary.totalRowsImported += importedRows;
  }

  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
