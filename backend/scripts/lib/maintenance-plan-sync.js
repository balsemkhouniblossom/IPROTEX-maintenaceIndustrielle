const mongoose = require('mongoose');

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

async function loadMachines(db, machineTypeName) {
  const machineType = await db.collection('machinetypes').findOne({ name: machineTypeName });
  if (!machineType) {
    throw new Error(`Machine type not found: ${machineTypeName}`);
  }

  const machines = await db
    .collection('machines')
    .find({ type_id: String(machineType._id) })
    .sort({ machine_id: 1 })
    .toArray();

  if (machines.length === 0) {
    throw new Error(`No machines found for machine type: ${machineTypeName}`);
  }

  return { machineType, machines };
}

async function upsertLubrifiants(db, lubrifiants) {
  let count = 0;
  for (const lubrifiant of lubrifiants) {
    await db.collection('lubrifiants').updateOne(
      { lubrifiant_id: lubrifiant.lubrifiant_id },
      { $set: lubrifiant },
      { upsert: true },
    );
    count += 1;
  }
  return count;
}

async function upsertBraidingModuleTypes(db, machineTypeId, moduleTypes) {
  const ids = new Map();

  for (const moduleType of moduleTypes) {
    const mod_type_id = `MT-BRAID-${moduleType.key}`;
    await db.collection('moduletypes').updateOne(
      { mod_type_id },
      {
        $set: {
          mod_type_id,
          type_id: String(machineTypeId),
          nom_module: moduleType.nom_module,
          categorie_module: moduleType.categorie_module,
        },
      },
      { upsert: true },
    );

    const saved = await db.collection('moduletypes').findOne(
      { mod_type_id },
      { projection: { _id: 1 } },
    );
    ids.set(moduleType.key, saved._id);
  }

  return ids;
}

async function upsertBraidingModules(db, machines, moduleTypes, moduleTypeIds) {
  const ids = new Map();
  let count = 0;

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

      const saved = await db.collection('modules').findOne(
        { module_id },
        { projection: { _id: 1 } },
      );
      ids.set(`${machine._id}:${moduleType.key}`, String(saved._id));
      count += 1;
    }
  }

  return { count, ids };
}

async function upsertBraidingPlans(db, machines, templates, moduleIds, config) {
  let count = 0;

  for (const machine of machines) {
    for (const template of templates) {
      const module_id = moduleIds.get(`${machine._id}:${template.moduleKey}`);
      const plan_id = `MP-BRAID-${slugify(machine.machine_id)}-${template.code}-${template.moduleKey}`;
      const update = {
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
          source_title: config.sourceTitle,
          valid_from: config.validFrom,
          created_by: 'G. Fleischmann',
          approved_by: config.approvedBy,
        },
      };

      if (config.setOnInsert) {
        update.$setOnInsert = config.setOnInsert;
      }

      await db.collection('maintenanceplans').updateOne({ plan_id }, update, { upsert: true });
      count += 1;
    }
  }

  return count;
}

async function syncBraidingMaintenancePlans(config) {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const { machineType, machines } = await loadMachines(db, config.machineTypeName);
  const lubrifiantUpserts = await upsertLubrifiants(db, config.lubrifiants ?? []);
  const moduleTypeIds = await upsertBraidingModuleTypes(db, machineType._id, config.moduleTypes);
  const modules = await upsertBraidingModules(db, machines, config.moduleTypes, moduleTypeIds);
  const planUpserts = await upsertBraidingPlans(db, machines, config.planTemplates, modules.ids, config);
  const maintenancePlanCount = await db
    .collection('maintenanceplans')
    .countDocuments({ source_title: config.sourceTitle });

  console.log(
    JSON.stringify(
      {
        machineType: machineType.name,
        machineCount: machines.length,
        lubrifiantUpserts,
        moduleTypeUpserts: config.moduleTypes.length,
        moduleUpserts: modules.count,
        planUpserts,
        maintenancePlanCount,
      },
      null,
      2,
    ),
  );
}

async function ensureChecklistModuleType(db, machineTypeId, config) {
  await db.collection('moduletypes').updateOne(
    { mod_type_id: config.moduleTypeId },
    {
      $set: {
        mod_type_id: config.moduleTypeId,
        type_id: String(machineTypeId),
        nom_module: config.moduleTypeName,
        categorie_module: config.sourceTitle,
      },
    },
    { upsert: true },
  );

  return db.collection('moduletypes').findOne(
    { mod_type_id: config.moduleTypeId },
    { projection: { _id: 1 } },
  );
}

function checklistModuleQuery(machine, config) {
  if (config.matchModuleMachineIdAsString) {
    return {
      machine_id: String(machine._id),
      localisation: config.moduleLocalisation,
    };
  }

  return {
    $expr: { $eq: [{ $toString: '$machine_id' }, String(machine._id)] },
    localisation: config.moduleLocalisation,
  };
}

async function ensureChecklistModule(db, machine, moduleTypeId, config) {
  const byExistingName = await db.collection('modules').findOne(
    checklistModuleQuery(machine, config),
  );
  const machine_id = config.storeModuleMachineIdAsString ? String(machine._id) : machine._id;

  if (byExistingName) {
    await db.collection('modules').updateOne(
      { _id: byExistingName._id },
      {
        $set: {
          mod_type_id: String(moduleTypeId),
          machine_id,
          localisation: config.moduleLocalisation,
        },
      },
    );

    return byExistingName._id;
  }

  const module_id = `MOD-${config.machineSlug}-${slugify(machine.machine_id)}-CHECKLIST`;
  await db.collection('modules').updateOne(
    { module_id },
    {
      $set: {
        module_id,
        machine_id,
        mod_type_id: String(moduleTypeId),
        localisation: config.moduleLocalisation,
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

function buildChecklistPlanFields(machine, moduleId, template, existing, config) {
  const plan_id =
    existing?.plan_id ||
    `MP-${config.machineSlug}-${slugify(machine.machine_id)}-${template.code}`;
  const planFields = {
    plan_id,
    module_id: config.storePlanModuleIdAsString ? String(moduleId) : moduleId,
    type_maintenance: 'preventive',
    frequence: template.frequence,
    unite_frequence: template.unite_frequence,
    instruction: template.instruction,
    maintenance_code: template.code,
    responsable: template.responsable,
    frequence_label: template.frequence_label,
    huile_graisse: template.huile_graisse,
    documentation: template.documentation,
    source_title: config.sourceTitle,
    valid_from: config.validFrom,
    created_by: 'G. Fleischmann',
    approved_by: config.approvedBy ?? 'W. R\u00f6del',
  };

  if (config.includePlanTitle) {
    planFields.title = `${template.code} - ${config.moduleLocalisation}`;
  }

  if (config.includePlanDescription) {
    planFields.description = template.instruction;
  }

  if (config.includePlanLocalisation) {
    planFields.localisation = config.moduleLocalisation;
  }

  return planFields;
}

async function syncChecklistPlansForMachine(db, machine, moduleId, config) {
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

  for (const template of config.planTemplates) {
    const existing = existingByCode.get(template.code);
    const planFields = buildChecklistPlanFields(
      machine,
      moduleId,
      template,
      existing,
      config,
    );

    const result = await db.collection('maintenanceplans').updateOne(
      existing ? { _id: existing._id } : { plan_id: planFields.plan_id },
      { $set: planFields },
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

async function syncChecklistMaintenancePlans(config) {
  if (config.planTemplates.length === 0) {
    throw new Error(`No ${config.machineTypeName.toLowerCase()} maintenance templates were extracted`);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const { machineType, machines } = await loadMachines(db, config.machineTypeName);
  const moduleType = await ensureChecklistModuleType(db, machineType._id, config);
  const summary = [];

  for (const machine of machines) {
    const moduleId = await ensureChecklistModule(db, machine, moduleType._id, config);
    const sync = await syncChecklistPlansForMachine(db, machine, moduleId, config);
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
        workbook: config.sourceTitle,
        machineType: config.machineTypeName,
        templateCodes: config.planTemplates.map((template) => ({
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
}

function runMaintenanceSync(sync, config) {
  sync(config)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = {
  runMaintenanceSync,
  syncBraidingMaintenancePlans,
  syncChecklistMaintenancePlans,
};
