require('../dist/load-env.js');

const mongoose = require('mongoose');

const BRAIDING_MACHINE_TYPE_NAME = 'Braiding';
const SOURCE_TITLE = 'FM 6-5e Stand: 02.11.2016 Wartungsplan Flechtmaschinen/Plan de maintenance tresseuse';

const lubrifiants = [
  {
    lubrifiant_id: 'LUB-BRAID-MOBIL-CHASSIS-GREASE-LBZ',
    nom: 'Mobil Chassis Grease LBZ',
    type: 'graisse',
    usage: 'Wartungsplan Flechtmaschinen / Plan de maintenance tresseuse',
  },
  {
    lubrifiant_id: 'LUB-BRAID-ARAL-DEGOL-B-220',
    nom: 'ARAL Degol B 220',
    type: 'huile',
    viscosite: 'B 220',
    usage: 'Wartungsplan Flechtmaschinen / Plan de maintenance tresseuse',
  },
  {
    lubrifiant_id: 'LUB-BRAID-ARAL-DEGOL-BG-150',
    nom: 'ARAL Degol BG 150',
    type: 'huile',
    viscosite: 'BG 150',
    usage: 'Wartungsplan Flechtmaschinen / Plan de maintenance tresseuse',
  },
];

const moduleTypes = [
  { key: 'KLOEPPEL', nom_module: 'Klöppel / Fuseau de tressage', categorie_module: 'FM 6-5e' },
  { key: 'SCHOLLE', nom_module: 'Scholle / Plateau porte-fuseau', categorie_module: 'FM 6-5e' },
  { key: 'DORN', nom_module: 'Dorn / Tige', categorie_module: 'FM 6-5e' },
  { key: 'LAUFBAHN', nom_module: 'Laufbahn / Piste', categorie_module: 'FM 6-5e' },
  { key: 'GETRIEBE', nom_module: 'Getriebe / Mécanisme', categorie_module: 'FM 6-5e' },
  { key: 'FLUEGELRAEDER', nom_module: 'Flügelräder / Roue à ailettes', categorie_module: 'FM 6-5e' },
  { key: 'SENSOR1', nom_module: 'Sensor 1 Drahtpräsenz / Capteur 1 présence fil', categorie_module: 'FM 6-5e' },
  { key: 'SENSOR2', nom_module: 'Sensor 2 Drahtpräsenz / Capteur 2 présence fil', categorie_module: 'FM 6-5e' },
  { key: 'ABZUEGE', nom_module: 'Abzüge / Système de tirage', categorie_module: 'FM 6-5e' },
  { key: 'TURMGETRIEBE', nom_module: 'Turmgetriebe / Boite d\'engrenage', categorie_module: 'FM 6-5e' },
  { key: 'UNTERGESTELL', nom_module: 'Untergestell / Chassis inférieur', categorie_module: 'FM 6-5e' },
  { key: 'TURM', nom_module: 'Turm / Tour', categorie_module: 'FM 6-5e' },
];

const planTemplates = [
  {
    code: 'W1',
    moduleKey: 'KLOEPPEL',
    responsable: 'Rüster / Manutention',
    frequence: 1,
    unite_frequence: 'bei jedem Aufsetzen / A chaque chargement',
    frequence_label: 'bei jedem Aufsetzen / A chaque chargement',
    huile_graisse: '',
    documentation: 'Über Wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Klöppel:',
      'Fadenführungsösen (3) und -hülse(1) auf Beschädigugen und Sitz prüfen',
      'Verschluss i.O. (Metallklammer)?',
      'Schwinghebelfunktion prüfen',
      'frei von Verschmutzungen',
      '',
      'Fuseaux de tressage',
      '13 Vérifier les œillets du guidage du fil (3) et le manchon (1)',
      'qu\'ils ne sont pas endommagés et qu\'ils sont bien ajustés',
      '1 Verrouillage OK (clip métalique )?',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'SCHOLLE',
    responsable: 'Rüster / Manutention',
    frequence: 1,
    unite_frequence: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    frequence_label: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    huile_graisse: '',
    documentation: 'Über Wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Scholle:',
      'parallel zur Grundplatte, (Schollenmitte in Flucht zu Abzug)',
      '',
      'Plateau porte-fuseau:',
      '8 Parallèlement à la plaque de base, anneau au centre en alignement avecle déclencheur',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'DORN',
    responsable: 'Rüster / Manutention',
    frequence: 1,
    unite_frequence: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    frequence_label: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    huile_graisse: '',
    documentation: 'Über Wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Dorn:',
      'richtige Größe, nicht verbogen/ beschädigt, mittig in der Scholle ausgerichtet',
      '',
      'Tige:',
      '11 Taille correcte, non pliée/endommagée, centrée dans le carrelet',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'LAUFBAHN',
    responsable: 'Rüster / Manutention',
    frequence: 1,
    unite_frequence: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    frequence_label: 'bei jedem Aufsetzen zus. beim Einrichten / A chaque chargement',
    huile_graisse: '',
    documentation: 'Über Wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Laufbahn:',
      'auf Fremdgegenstände und Beschädigungen prüfen',
      '',
      'piste :',
      'Vérifiez l\'absence des  objets étrangers et des dommages',
    ].join('\n'),
  },
  {
    code: 'W1',
    moduleKey: 'GETRIEBE',
    responsable: 'Rüster / Manutention',
    frequence: 1,
    unite_frequence: 'A chaque chargement',
    frequence_label: 'A chaque chargement',
    huile_graisse: 'Mobil Chassis Grease LBZ',
    documentation: 'Über Wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Getriebe:',
      'ausgebaute Zahnräder säubern, neue fetten',
      '',
      'mécanisme',
      'Nettoyez les engrenages démontés , graisser de nouveaux les engrenages',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'KLOEPPEL',
    responsable: 'Rüster / Maintenance',
    frequence: 1,
    unite_frequence: 'Woche / semaine',
    frequence_label: '1 x pro Woche / 1fois /semaine',
    huile_graisse: '',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Klöppel:',
      'Sperrbolzen und -splint prüfen',
      '(unbeschädigt, gerade)',
      'Schwinghebel und - splint prüfen',
      '(unbeschädigt, gerade)',
      'Flechtspulenlagerhülsenabnutzung',
      '(Sperrbolzen greift nicht im Spulenlauf)',
      'Klöppelfuß kontrollieren',
      '(Abnutzungsgrad ohne Einfluß auf Laufeigenschaften)',
      '',
      'Fuseau de tressage:',
      '7 Vérifiez la goupille et la goupille de verrouillage',
      '(non endommagé, droit)',
      '12 Vérifiez le levier d\'oscillation et la goupille',
      '(non endommagé, droit)',
      '4 Usure des douilles de bobines tressées',
      '(la goupille de verrouillage ne s\'engage',
      '8 Vérifiez le pied du fuseau',
      '(pas dans le parcours de  la bobine)',
      '(degré d\'usure sans influence sur les propriétés de fonctionnement)',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'LAUFBAHN',
    responsable: 'Rüster / Maintenance',
    frequence: 1,
    unite_frequence: 'Woche / semaine',
    frequence_label: '1 x pro Woche / 1fois /semaine',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Laufbahn:',
      'gründlich säubern, auf Beschädigungen pr.',
      'zwischen den Flügelrädern ölen',
      '',
      'Mécanisme:',
      'Nettoyer soigneusement,vérifier  les dommages PR.',
      'Huile entre les roues',
    ].join('\n'),
  },
  {
    code: 'W2',
    moduleKey: 'FLUEGELRAEDER',
    responsable: 'Rüster / Maintenance',
    frequence: 1,
    unite_frequence: 'Woche / semaine',
    frequence_label: '1 x pro Woche / 1fois /semaine',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Flügelräder:',
      'auf den Flügelrädern ölen',
      'in und unter Teller auf Flügelradmutter ölen',
      '',
      'Roue à ailettes',
      'Huile sur les turbines ,sous les plaques',
      'et les écrous  de la roue',
    ].join('\n'),
  },
  {
    code: 'W3',
    moduleKey: 'SENSOR1',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'Monat / mois',
    frequence_label: '1fois /mois',
    huile_graisse: '',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Testen Sie die Funktion von Sensor 1 Drahtpräsenz',
      '',
      'Capteur1 présence fil',
      'Tester le fonctionnement de capteur 1 présence fil',
      'Couper un fil et verifier l\'arret de la machine',
    ].join('\n'),
  },
  {
    code: 'W3',
    moduleKey: 'SENSOR2',
    responsable: 'Maintenance',
    frequence: 1,
    unite_frequence: 'Monat / mois',
    frequence_label: '1fois /mois',
    huile_graisse: '',
    documentation: 'Fiche plan de maintenance',
    instruction: [
      'Testen Sie die Funktion von Sensor 2 Drahtpräsenz',
      '',
      'Capteur 2 présence fil',
      'Tester le fonctionnement de capteur 2 présence bobine',
    ].join('\n'),
  },
  {
    code: 'W4',
    moduleKey: 'ABZUEGE',
    responsable: 'Instand-haltung Maintenance',
    frequence: 1,
    unite_frequence: 'Monat / mois',
    frequence_label: '1fois /mois   monatlich',
    huile_graisse: '',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Abzüge:Système de tirage',
      'Walzen auf Funktion und Verschleiß prüfen',
      'Vérifier le fonctionnement et l\'usure des rouleaux de tirage',
    ].join('\n'),
  },
  {
    code: 'W5',
    moduleKey: 'KLOEPPEL',
    responsable: 'Instand-haltung / Maintenance',
    frequence: 2,
    unite_frequence: 'Jahr / an',
    frequence_label: '2 mal/pro jahren / 2 fois/an',
    huile_graisse: 'Mobil Chassis Grease LBZ',
    documentation: 'im Maschinen-wartungsplan / Fiche plan de maintenance',
    instruction: [
      'Klöppel:',
      'Gleitstangen fetten',
      '',
      'Fuseau de tressage',
      'Graisser les tiges coulissantes',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'TURMGETRIEBE',
    responsable: 'Instand-haltung / Maintenance',
    frequence: 1,
    unite_frequence: 'Jahr / an',
    frequence_label: '1 x pro Jahr / 1fois/An',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'im Maschinen-wartungsplan / plan de mainte machine',
    instruction: [
      'Turmgetriebe:',
      'kontrollieren ggf. fetten bzw. Öl auffüllen',
      '',
      'Boite d\'engrenage :',
      'Vérifier la graisse ou le remplissage d\'huile si nécessaire',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'FLUEGELRAEDER',
    responsable: 'Instand-haltung / Maintenance',
    frequence: 1,
    unite_frequence: 'Jahr / an',
    frequence_label: '1 x pro Jahr / 1fois/An',
    huile_graisse: '',
    documentation: 'im Maschinen-wartungsplan / machine',
    instruction: [
      'Flügelräder:',
      'prüfen ggf. nachziehen',
      '',
      'Roue à ailettes',
      'Vérifier resserrer si nécessaire',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'ABZUEGE',
    responsable: 'Instand-haltung / Maintenance',
    frequence: 1,
    unite_frequence: 'Jahr / an',
    frequence_label: '1 x pro Jahr / 1fois/An',
    huile_graisse: '',
    documentation: 'im Maschinen-wartungsplan / machine',
    instruction: [
      'Abzüge:',
      'Walzen auf Funktion und Verschleiß prüfen',
      '',
      'Système de tirage',
      'Vérifiez le fonctionnement et l\'usure des rouleaux .',
    ].join('\n'),
  },
  {
    code: 'W6',
    moduleKey: 'KLOEPPEL',
    responsable: 'Instand-haltung / Maintenance',
    frequence: 1,
    unite_frequence: 'Jahr / an',
    frequence_label: '1 x pro Jahr / 1fois/An',
    huile_graisse: 'ARAL Degol B 220',
    documentation: 'im Maschinen-wartungsplan / machine',
    instruction: [
      'Klöppel:',
      'Schwinghebelfedern ausbauen und ölen',
      '',
      'Fuseau de tressage',
      '1 Enlever et huiler les ressorts du levier oscillant',
    ].join('\n'),
  },
  {
    code: 'W7',
    moduleKey: 'UNTERGESTELL',
    responsable: 'Instand-haltung',
    frequence: 2,
    unite_frequence: 'Jahre / ans',
    frequence_label: 'alle 2 Jahre / Chaque 2 ans',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'im Maschinen-wartungsplan / maintenance machine',
    instruction: [
      'Untergestell:',
      'Ölwechsel durchführen',
      '',
      'chassis inférieur',
      'Effectuer le changement d\'huile',
    ].join('\n'),
  },
  {
    code: 'W7',
    moduleKey: 'TURM',
    responsable: 'Instand-haltung',
    frequence: 2,
    unite_frequence: 'Jahre / ans',
    frequence_label: 'alle 2 Jahre / Chaque 2 ans',
    huile_graisse: 'ARAL Degol BG 150',
    documentation: 'im Maschinen-wartungsplan / maintenance machine',
    instruction: [
      'Turm:',
      'Ölwechsel durchführen',
      '',
      'Tour:',
      'Effectuer le changement d\'huile',
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

  const machineType = await db.collection('machinetypes').findOne({ name: BRAIDING_MACHINE_TYPE_NAME });

  if (!machineType) {
    throw new Error(`Machine type not found: ${BRAIDING_MACHINE_TYPE_NAME}`);
  }

  const machines = await db.collection('machines').find({ type_id: String(machineType._id) }).toArray();

  if (machines.length === 0) {
    throw new Error(`No machines found for machine type: ${BRAIDING_MACHINE_TYPE_NAME}`);
  }

  let lubrifiantUpserts = 0;
  for (const lubrifiant of lubrifiants) {
    await db.collection('lubrifiants').updateOne(
      { lubrifiant_id: lubrifiant.lubrifiant_id },
      { $set: lubrifiant },
      { upsert: true },
    );
    lubrifiantUpserts += 1;
  }

  const moduleTypeIds = new Map();
  let moduleTypeUpserts = 0;
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
    moduleTypeUpserts += 1;
  }

  const moduleIds = new Map();
  let moduleUpserts = 0;
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
      moduleUpserts += 1;
    }
  }

  let planUpserts = 0;
  for (const machine of machines) {
    for (const planTemplate of planTemplates) {
      const module_id = moduleIds.get(`${machine._id}:${planTemplate.moduleKey}`);
      const plan_id = `MP-BRAID-${slugify(machine.machine_id)}-${planTemplate.code}-${planTemplate.moduleKey}`;

      await db.collection('maintenanceplans').updateOne(
        { plan_id },
        {
          $set: {
            plan_id,
            module_id,
            type_maintenance: 'preventive',
            frequence: planTemplate.frequence,
            unite_frequence: planTemplate.unite_frequence,
            instruction: planTemplate.instruction,
            maintenance_code: planTemplate.code,
            responsable: planTemplate.responsable,
            frequence_label: planTemplate.frequence_label,
            huile_graisse: planTemplate.huile_graisse,
            documentation: planTemplate.documentation,
            source_title: SOURCE_TITLE,
            valid_from: '08.08.2011',
            created_by: 'G. Fleischmann',
            approved_by: 'W.Rödel',
          },
          // Only stamped on first insert: these plans represent equipment
          // already in service, so they start life Active (not Draft) —
          // but re-running this script must never clobber a lifecycle
          // change (pause/archive/etc.) an admin made since the import.
          $setOnInsert: {
            status: 'active',
            version: 1,
            lifecycle_history: [
              {
                action: 'created',
                to_status: 'active',
                reason: 'Bulk-imported from historical maintenance plan data',
                at: new Date(),
              },
            ],
          },
        },
        { upsert: true },
      );
      planUpserts += 1;
    }
  }

  const maintenancePlanCount = await db.collection('maintenanceplans').countDocuments({ source_title: SOURCE_TITLE });

  console.log(
    JSON.stringify(
      {
        machineType: machineType.name,
        machineCount: machines.length,
        lubrifiantUpserts,
        moduleTypeUpserts,
        moduleUpserts,
        planUpserts,
        maintenancePlanCount,
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
