import fs from 'node:fs';

const source = JSON.parse(fs.readFileSync(new URL('../frontend/src/data/braidingInventory.json', import.meta.url), 'utf8'));

const exact = new Map(Object.entries({
  'Weichen/aiguille bobinage': 'Winding needle',
  'Weichen/aiguille tressage': 'Braiding needle',
  'Verschlußschwarz/clapet noir': 'Black bobbin latch',
  'Verschlußschwarz/socle bobine clapet noir': 'Black bobbin-base latch',
  'Verschluß rot/clapet rouge': 'Red bobbin latch',
  'Verschluß rot/socle bobine clapet rouge': 'Red bobbin-base latch',
  "Tellerscheibe/disque d'assiette": 'Plate disc',
  'Sperrbolzenstifte/goupille de verrouillage': 'Locking pin',
  'Schiffchen/calot': 'Shuttle',
  'Kugellager für Antriebsmotor/roulement à billes': 'Drive-motor ball bearing',
  'Frequenzumrichter/convertisseur de fréquence': 'Frequency converter',
  'Flügelräder/roues': 'Wheels',
  'Fadenüberwachungssensor/capteur de fil': 'Thread monitoring sensor',
  'Fadenbremsen/frein à fil': 'Thread brake',
  'Endschalter/interrupteur fin de course': 'Limit switch',
  'E-Motor Antrieb/propulseur': 'Drive motor',
  'Einstellpoti/potensiomètre': 'Adjustment potentiometer',
  'Drehgeber/capteur rotatif': 'Rotary encoder',
  'Display/écran': 'Display',
  'Bolzen für Flügelräder/boulons pour roues': 'Wheel bolts',
  'Abzugswalzen/revêtement de rouleau de halage': 'Haul-off roller',
  'Abzugskeilriemen/courroie de traction de ventilateur': 'Haul-off V-belt',
  'capteur de fil': 'Thread sensor',
  'cosse rouge pour capteur de fil': 'Red terminal for thread sensor',
  'Pointe de centrage': 'Centering point',
  'tapis de gradin': 'Step mat',
  'capot capteur de fil': 'Thread-sensor cover',
  'Câble capteur de fil': 'Thread-sensor cable',
  'frein de fil': 'Thread brake',
  'Bateau': 'Shuttle',
  'aiguille de fil': 'Thread needle',
  'oeillet rose PF': 'Pink eyelet PF',
  'oeillet rose MF': 'Pink eyelet MF',
  'oeillet rose GF': 'Pink eyelet GF',
  'Adhésif tapis': 'Mat adhesive',
  'capteur de fil  avec fourchettte': 'Thread sensor with fork',
  'capteur de fil  rouge': 'Red thread sensor',
  'Guide bobine': 'Bobbin guide',
  'fourchette en V': 'V-shaped fork',
  'Tête fuseau': 'Spindle head',
  'Fuseau noir': 'Black spindle',
  'VIS sans fin': 'Worm screw',
  'ressort PF': 'PF spring',
  'Disque enroulement': 'Winding disc',
  'ressort GF 20cm': 'GF spring 20 cm',
  'Support porte bobine': 'Bobbin-holder support',
  'support de guidage rouge': 'Red guide support',
  'adhésif alu': 'Aluminium adhesive tape',
  'Adhésif bleu': 'Blue adhesive tape',
  'Lame larg 80mm': '80 mm blade',
  'danseur 600g': '600 g dancer weight', 'danseur 550g': '550 g dancer weight',
  'danseur 530g': '530 g dancer weight', 'danseur 500g': '500 g dancer weight',
  'danseur 450g': '450 g dancer weight', 'danseur 400g': '400 g dancer weight',
  'danseur 350g': '350 g dancer weight', 'danseur 250g': '250 g dancer weight',
  'danseur 150g': '150 g dancer weight', 'danseur 100g': '100 g dancer weight',
  'danseur 800g': '800 g dancer weight', 'danseur 75g': '75 g dancer weight',
}));

function englishName(value) {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (exact.has(clean)) return exact.get(clean);
  if (/^Zahnriemen\/courroie de chaîne /i.test(clean)) return clean.replace(/^Zahnriemen\/courroie de chaîne /i, 'Timing belt ');
  if (/^Klingen Breite 80mm\/lame larg 80mm$/i.test(clean)) return '80 mm blade';
  if (/^Klingen Breite 55mm\/lame larg55mm$/i.test(clean)) return '55 mm blade';
  if (/^Klingen Breite 110\/lame larg 110$/i.test(clean)) return '110 mm blade';
  if (/^Abzugswalzenbelag 50mmx50m\//i.test(clean)) return 'Haul-off roller coating 50 mm × 50 m';
  if (/^Engrenage denté /i.test(clean)) return clean.replace(/^Engrenage denté /i, 'Toothed gear ');
  if (/^tige diam /i.test(clean)) return clean.replace(/^tige diam /i, 'Rod diameter ');
  return clean;
}

function englishCategory(value) {
  return ({ 'Pièces de rechange': 'Spare parts', Bobineuse: 'Winding', Tresseuse: 'Braiding', Enroulement: 'Winding', 'Découpe HSGM': 'HSGM cutting', Engrenages: 'Gears', 'Machine F072': 'Machine F072', 'Danseurs et tiges': 'Dancer weights and rods' })[value] ?? value;
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

const newestFirst = [...source].sort((a, b) => {
  const parse = value => { const [d = 0, m = 0, y = 0] = String(value ?? '').split('.').map(Number); return y * 10000 + m * 100 + d; };
  return parse(b.sourceDate) - parse(a.sourceDate);
});
const deduped = new Map();
for (const row of newestFirst) {
  const name = englishName(row.article);
  const key = name.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
  const candidate = {
    reference: `BRD-${String(deduped.size + 1).padStart(3, '0')}`,
    name,
    category: englishCategory(row.category),
    quantity: numeric(row.stock),
    minimumQuantity: numeric(row.minimumStock),
    critical: Boolean(row.critical),
    supplier: row.supplier || null,
    location: String(row.location || 'Braiding workshop').trim().replace(/^atelier tressage$/i, 'Braiding workshop').replace(/^Werkstatt\/atelier$/i, 'Workshop'),
    sourceDate: row.sourceDate,
    sourceSheets: [row.sourceSheet],
  };
  const existing = deduped.get(key);
  if (!existing) deduped.set(key, candidate);
  else {
    existing.quantity = Math.max(existing.quantity, candidate.quantity);
    existing.minimumQuantity = Math.max(existing.minimumQuantity, candidate.minimumQuantity);
    existing.critical ||= candidate.critical;
    if (!existing.supplier) existing.supplier = candidate.supplier;
    if (!existing.sourceSheets.includes(row.sourceSheet)) existing.sourceSheets.push(row.sourceSheet);
  }
}

console.log(JSON.stringify([...deduped.values()].map((row, index) => ({ ...row, reference: `BRD-${String(index + 1).padStart(3, '0')}` })), null, 2));
