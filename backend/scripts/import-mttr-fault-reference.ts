/* eslint-disable no-console */
import '../src/load-env';
import mongoose from 'mongoose';

type FaultSeed = {
  process: string;
  code: string;
  component: string;
  description: string;
};

export const MTTR_FAULTS: FaultSeed[] = [
  ['Bobinage', 'B01', 'Frein de fil', 'Frein de fil défectueux'],
  ['Bobinage', 'B02', 'Guidage du fil', 'Guide-fil défectueux / endommagé'],
  [
    'Bobinage',
    'B03',
    'Répartition du fil',
    'Système de répartition du fil défectueux',
  ],
  ['Bobinage', 'B04', 'Détecteur de fil', 'Détecteur de fil défectueux'],
  ['Bobinage', 'B05', 'Entraînement', "Courroie d'entraînement usée / cassée"],
  ['Bobinage', 'B06', 'Support bobine', 'Support bobine endommagé / bloqué'],
  ['Bobinage', 'B07', 'Moteur', 'Moteur défectueux'],
  ['Bobinage', 'B08', 'Électrique', 'Défaut électrique / capteur'],
  ['Bobinage', 'B09', 'Commande', 'Défaut de commande / afficheur'],
  ['Bobinage', 'B10', 'Autre', 'Autre panne technique'],
  ['Tressage', 'T01', 'Extracteur', 'Extracteur usé / endommagé'],
  ['Tressage', 'T02', 'Extracteur', "Tapis / courroie d'extracteur usé(e)"],
  ['Tressage', 'T03', 'Extracteur', 'Extracteur bloqué'],
  ['Tressage', 'T04', 'Bateau', 'Bateau endommagé / cassé'],
  ['Tressage', 'T05', 'Fuseau', 'Fuseau bloqué / défectueux'],
  ['Tressage', 'T06', 'Support', 'Support endommagé / cassé'],
  ['Tressage', 'T07', 'Guide-fil / œillet', 'Guide-fil / œillet endommagé'],
  ['Tressage', 'T08', 'Tension du fil', 'Tendeur / frein de fil défectueux'],
  [
    'Tressage',
    'T09',
    'Détecteur de fil',
    'Détecteur de rupture fil défectueux',
  ],
  ['Tressage', 'T10', 'Transmission', 'Engrenage / transmission défectueux'],
  [
    'Tressage',
    'T11',
    'Entraînement',
    "Courroie / chaîne d'entraînement défectueuse",
  ],
  ['Tressage', 'T12', 'Moteur', 'Moteur défectueux'],
  ['Tressage', 'T13', 'Électrique', 'Défaut électrique / capteur'],
  ['Tressage', 'T14', 'Sécurité', 'Dispositif de sécurité défectueux'],
  ['Tressage', 'T15', 'Autre', 'Autre panne technique'],
  ['Enroulement', 'E01', 'Entraînement', "Système d'entraînement défectueux"],
  ['Enroulement', 'E02', 'Guidage', 'Guide produit défectueux / endommagé'],
  [
    'Enroulement',
    'E03',
    'Mandrin / axe',
    "Mandrin / axe d'enroulement défectueux",
  ],
  ['Enroulement', 'E04', 'Transmission', 'Courroie / transmission défectueuse'],
  ['Enroulement', 'E05', 'Moteur', 'Moteur défectueux'],
  ['Enroulement', 'E06', 'Capteur', 'Capteur défectueux'],
  ['Enroulement', 'E07', 'Commande', 'Défaut de commande / afficheur'],
  ['Enroulement', 'E08', 'Électrique', 'Défaut électrique'],
  ['Enroulement', 'E09', 'Autre', 'Autre panne technique'],
  ['Coupe', 'C01', 'Lame / couteau', 'Lame / couteau usé ou endommagé'],
  ['Coupe', 'C02', 'Chauffage', 'Couteau chauffant ne chauffe pas'],
  ['Coupe', 'C03', 'Chauffage', 'Température instable / incorrecte'],
  ['Coupe', 'C04', 'Entraînement', "Système d'avance produit défectueux"],
  ['Coupe', 'C05', 'Rouleaux', "Rouleau d'entraînement usé / bloqué"],
  ['Coupe', 'C06', 'Capteur', 'Capteur de longueur / présence défectueux'],
  ['Coupe', 'C07', 'Moteur', 'Moteur défectueux'],
  ['Coupe', 'C08', 'Commande', 'Défaut écran / automate / commande'],
  ['Coupe', 'C09', 'Électrique', 'Défaut électrique'],
  ['Coupe', 'C10', 'Sécurité', 'Dispositif de sécurité défectueux'],
  ['Coupe', 'C11', 'Autre', 'Autre panne technique'],
].map(([process, code, component, description]) => ({
  process,
  code,
  component,
  description,
}));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI or MONGO_URI');
  await mongoose.connect(uri);
  const machineTypes = mongoose.connection.collection('machinetypes');
  const faults = mongoose.connection.collection('pannes');
  const unmatched: string[] = [];
  let matched = 0;
  const processAliases: Record<string, string[]> = {
    Bobinage: ['Bobinage', 'Winding'],
    Tressage: ['Tressage', 'Braiding'],
    Enroulement: ['Enroulement', 'Rolling'],
    Coupe: ['Coupe', 'Cutting'],
  };

  for (const seed of MTTR_FAULTS) {
    const machineType = await machineTypes.findOne({
      name: { $in: processAliases[seed.process] ?? [seed.process] },
    });
    if (!machineType) {
      if (!unmatched.includes(seed.process)) unmatched.push(seed.process);
      continue;
    }
    matched++;
    if (!dryRun) {
      await faults.updateOne(
        { machine_type_id: machineType._id, code_panne: seed.code },
        {
          $set: {
            panne_id: `MTTR-${seed.code}`,
            machine_type_id: machineType._id,
            code_panne: seed.code,
            component: seed.component,
            description: seed.description,
            is_active: true,
          },
        },
        { upsert: true },
      );
    }
  }

  console.log({
    mode: dryRun ? 'dry-run' : 'apply',
    referenceRows: MTTR_FAULTS.length,
    matched,
    unmatched,
  });
  await mongoose.disconnect();
}

if (require.main === module) {
  void main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
