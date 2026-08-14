const API_BASE = 'http://localhost:3001';

const commonChecks = [
  'Verifier le moteur et le cablage pour court-circuit.',
  'Verifier la resistance de freinage et le cablage.',
  'Verifier le couplage moteur (triangle/etoile).',
  'Verifier le parametrage des donnees moteur.',
].join('\n');

const rows = [
  {
    code: '2250',
    en: 'CiA: Continuous overcurrent (inside the device)',
    fr: "CiA : Surintensite continue (interne a l'appareil)",
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '2320',
    en: 'Short circuit or earth leakage on the motor side',
    fr: 'Court-circuit ou fuite a la terre cote moteur',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '2340',
    en: 'CiA: Short circuit (inside the device)',
    fr: "CiA : Court-circuit (interne a l'appareil)",
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '2350',
    en: 'CiA: i2*t overload (thermal state)',
    fr: 'CiA : Surcharge i2*t (etat thermique)',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '2382',
    en: 'Error: Device utilization (Ixt) too high',
    fr: "Erreur : Utilisation de l'appareil (Ixt) trop elevee",
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '3120',
    en: 'Mains phase fault',
    fr: 'Defaut de phase secteur',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '3210',
    en: 'DC bus overvoltage',
    fr: 'Surtension du bus CC',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '3220',
    en: 'DC bus undervoltage',
    fr: 'Sous-tension du bus CC',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '4210',
    en: 'PU: Overtemperature fault',
    fr: 'Defaut de surchauffe (Unite de Puissance)',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '4310',
    en: 'Error: Motor overtemperature',
    fr: 'Erreur : Surchauffe moteur',
    severity: 'Trouble (Probleme)',
    solution: commonChecks,
  },
  {
    code: '6280',
    en: 'Trigger/functions connected incorrectly',
    fr: 'Declencheurs/fonctions mal connectes',
    severity: 'Trouble (Probleme)',
    solution: [
      "Verifier et corriger l'attribution des declencheurs aux fonctions.",
      'Avec la commande par clavier ou reseau, les deux fonctions Inverter enable (P400.01) et Run (P400.02) peuvent etre reglees sur Constant TRUE [1] pour demarrer le moteur.',
    ].join('\n'),
  },
  {
    code: '7180',
    en: 'Motor overcurrent',
    fr: 'Surintensite moteur',
    severity: 'Trouble (Probleme)',
    solution: [
      'Verifier la charge du moteur.',
      'Verifier le dimensionnement du variateur.',
      "Adapter le seuil d'erreur regle (P353.01).",
    ].join('\n'),
  },
  {
    code: '9080',
    en: 'Keypad removed',
    fr: 'Clavier retire',
    severity: 'Trouble (Probleme)',
    solution: 'Rebrancher le clavier ou activer une autre source de commande.',
  },
  {
    code: 'FF02',
    en: 'Error: Brake resistor overload',
    fr: 'Erreur : Surcharge de la resistance de freinage',
    severity: 'Trouble (Probleme)',
    solution: [
      'Verifier le dimensionnement du variateur.',
      "Verifier les reglages de gestion de l'energie de freinage.",
      "Note: l'erreur sera reinitialisee si la charge thermique descend en dessous du seuil d'erreur (P707.09) de -20 %.",
    ].join('\n'),
  },
  {
    code: 'FF06',
    en: 'Motor overspeed',
    fr: 'Survitesse moteur',
    severity: 'Trouble (Probleme)',
    solution: "Adapter la vitesse maximale du moteur (P322.00) et le seuil d'erreur (P350.01).",
  },
  {
    code: 'FF37',
    en: 'Automatic start disabled',
    fr: 'Demarrage automatique desactive',
    severity: 'Trouble (Probleme)',
    solution: "Desactiver la commande de demarrage et reinitialiser l'erreur.",
  },
  {
    code: '2383',
    en: 'Warning: Device utilization (Ixt) too high',
    fr: "Avertissement : Utilisation de l'appareil (Ixt) trop elevee",
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '3211',
    en: 'Warning: DC bus overvoltage',
    fr: 'Avertissement : Surtension du bus CC',
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '3221',
    en: 'Warning: DC bus undervoltage',
    fr: 'Avertissement : Sous-tension du bus CC',
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '3222',
    en: 'DC-bus voltage too low for switch-on',
    fr: 'Tension du bus CC trop faible pour la mise en marche',
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '4281',
    en: 'Heatsink fan warning',
    fr: 'Avertissement ventilateur dissipateur',
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '5112',
    en: '24 V supply critical',
    fr: 'Alimentation 24 V critique',
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: '5180',
    en: '24-V supply overload',
    fr: "Surcharge de l'alimentation 24 V",
    severity: 'Warning (Avertissement)',
    solution: commonChecks,
  },
  {
    code: 'FF36',
    en: 'Warning: Brake resistor overload',
    fr: 'Avertissement : Surcharge de la resistance de freinage',
    severity: 'Warning (Avertissement)',
    solution: [
      'Verifier le dimensionnement du variateur.',
      "Verifier les reglages de gestion de l'energie de freinage.",
      "Note: l'avertissement sera reinitialise si la charge thermique descend en dessous du seuil d'avertissement (P707.08) de -20 %.",
    ].join('\n'),
  },
  {
    code: 'FF85',
    en: 'Keypad full control active',
    fr: 'Controle total via clavier actif',
    severity: 'Warning (Avertissement)',
    solution: 'Appuyer sur la touche CTRL pour quitter le mode de commande.',
  },
  {
    code: 'LED01',
    en: 'RDY off / ERR off - No supply voltage.',
    fr: "RDY eteinte / ERR eteinte - Aucune tension d'alimentation.",
    severity: 'Info (Etat)',
    solution: 'Verifier la presence de la tension secteur et de la tension de commande.',
  },
  {
    code: 'LED02',
    en: 'RDY steady / ERR steady - Mains voltage is switched on, inverter initialized.',
    fr: 'RDY allumee fixe / ERR allumee fixe - Tension secteur presente, onduleur initialise.',
    severity: 'Info (Etat)',
    solution: 'Etat normal de mise sous tension.',
  },
  {
    code: 'LED03',
    en: 'RDY flashing / ERR off - Inverter disabled, ready for operation.',
    fr: 'RDY clignotante / ERR eteinte - Onduleur desactive, pret a fonctionner.',
    severity: 'Info (Etat)',
    solution: "Activer l'onduleur via la commande si un demarrage est attendu.",
  },
  {
    code: 'LED04',
    en: 'RDY flashing / ERR fast flashing - Safe torque off (STO) active, warning active.',
    fr: 'RDY clignotante / ERR clignotement rapide - STO actif, avertissement actif.',
    severity: 'Warning (Avertissement)',
    solution: 'Verifier la chaine de securite STO et les entrees de securite.',
  },
  {
    code: 'LED05',
    en: 'RDY flashing / ERR off - Inverter disabled.',
    fr: 'RDY clignotante / ERR eteinte - Onduleur desactive.',
    severity: 'Info (Etat)',
    solution: "Verifier la commande d'activation de l'onduleur.",
  },
  {
    code: 'LED06',
    en: 'RDY flashing / ERR fast flashing - Inverter disabled, warning active.',
    fr: 'RDY clignotante / ERR clignotement rapide - Onduleur desactive, avertissement actif.',
    severity: 'Warning (Avertissement)',
    solution: "Consulter le code d'avertissement actif et corriger la cause.",
  },
  {
    code: 'LED07',
    en: 'RDY flashing / ERR steady - Inverter disabled, error active.',
    fr: 'RDY clignotante / ERR allumee fixe - Onduleur desactive, erreur active.',
    severity: 'Trouble (Probleme)',
    solution: "Lire et reinitialiser l'erreur apres correction de la cause.",
  },
  {
    code: 'LED08',
    en: 'RDY flashing / ERR short on every 1.5 s - Inverter disabled, no DC bus voltage.',
    fr: 'RDY clignotante / ERR allumee brievement toutes les 1,5 s - Onduleur desactive, pas de tension bus CC.',
    severity: 'Warning (Avertissement)',
    solution: 'Verifier la tension bus CC et la presence de la tension secteur.',
  },
  {
    code: 'LED09',
    en: 'RDY steady / ERR off - Inverter enabled.',
    fr: 'RDY allumee fixe / ERR eteinte - Onduleur active.',
    severity: 'Info (Etat)',
    solution: 'Etat normal de fonctionnement.',
  },
  {
    code: 'LED10',
    en: 'RDY steady / ERR off - Motor rotates according to setpoint or quick stop active.',
    fr: 'RDY allumee fixe / ERR eteinte - Le moteur tourne selon la consigne ou arret rapide actif.',
    severity: 'Info (Etat)',
    solution: 'Verifier la consigne et la logique de commande.',
  },
  {
    code: 'LED11',
    en: 'RDY steady / ERR fast flashing - Inverter enabled, warning active.',
    fr: 'RDY allumee fixe / ERR clignotement rapide - Onduleur active, avertissement actif.',
    severity: 'Warning (Avertissement)',
    solution: "Verifier le code d'avertissement tout en maintenant la surveillance du process.",
  },
  {
    code: 'LED12',
    en: 'RDY steady / ERR flashing - Inverter enabled, quick stop active as response to a fault.',
    fr: 'RDY allumee fixe / ERR clignotement - Onduleur active, arret rapide actif suite a un defaut.',
    severity: 'Trouble (Probleme)',
    solution: "Analyser le defaut declencheur puis redemarrer apres acquittement.",
  },
];

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`API request failed with status ${res.status}`);
  }

  return res.json();
}

function asArrayResponse(value, resourceName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${resourceName} response was not an array`);
  }

  return value;
}

function logMetric(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} metric was not a safe non-negative integer`);
  }

  console.log(`${name}=${value.toString(10)}`);
}

async function main() {
  const existingPannes = asArrayResponse(
    await request('GET', '/pannes'),
    'Pannes',
  );
  const existingSolutions = asArrayResponse(
    await request('GET', '/panne-solutions'),
    'Panne solutions',
  );

  const panneByCode = new Map(existingPannes.map((p) => [p.panne_id, p]));
  const solutionById = new Map(existingSolutions.map((s) => [s.solution_id, s]));

  let panneCreated = 0;
  let panneUpdated = 0;
  let solutionCreated = 0;
  let solutionUpdated = 0;

  for (const row of rows) {
    const pannePayload = {
      panne_id: row.code,
      code_panne: row.en,
      description: row.fr,
      gravite: row.severity,
    };

    let panneDoc = panneByCode.get(row.code);
    if (panneDoc) {
      panneDoc = await request('PATCH', `/pannes/${panneDoc._id}`, pannePayload);
      panneUpdated += 1;
    } else {
      panneDoc = await request('POST', '/pannes', pannePayload);
      panneCreated += 1;
    }

    const solutionId = `${row.code}-SOL`;
    const solutionPayload = {
      solution_id: solutionId,
      panne_id: panneDoc._id,
      cause_probable: `${row.en} | ${row.fr}`,
      solution_recommandee: row.solution,
    };

    const existingSolution = solutionById.get(solutionId);
    if (existingSolution) {
      await request('PATCH', `/panne-solutions/${existingSolution._id}`, solutionPayload);
      solutionUpdated += 1;
    } else {
      const created = await request('POST', '/panne-solutions', solutionPayload);
      solutionById.set(solutionId, created);
      solutionCreated += 1;
    }
  }

  logMetric('PANNES_CREATED', panneCreated);
  logMetric('PANNES_UPDATED', panneUpdated);
  logMetric('SOLUTIONS_CREATED', solutionCreated);
  logMetric('SOLUTIONS_UPDATED', solutionUpdated);
  logMetric('PANNES_TOTAL', rows.length);
  logMetric('SOLUTIONS_TOTAL', rows.length);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
