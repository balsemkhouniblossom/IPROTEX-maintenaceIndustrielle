const OFFICIAL_PROCESS_NAMES: Readonly<Record<string, string>> = {
  bobinage: 'Winding',
  tressage: 'Braiding',
  coupage: 'Cutting',
  enroulement: 'Rolling',
};

export function normalizeQualityProcessName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('fr');
  return OFFICIAL_PROCESS_NAMES[normalized] ?? value.trim();
}
