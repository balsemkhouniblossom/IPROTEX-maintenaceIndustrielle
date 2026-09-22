import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import JSZip from 'jszip';
export interface CatalogueEntry {
  defectCode: string;
  defectName: string;
  normalizedProcess?: string;
  description?: string;
  cause?: string;
  prevention?: string;
  evaluation?: string;
  testSamples?: string;
  testProcedure?: string;
  testRegulation?: string;
  source: string;
  sourceFile: string;
  sourceSection: number;
  sourceParagraph: number;
  importIdentity: string;
}
export interface CatalogueReport {
  sourceFile: string;
  sectionsInspected: number;
  validEntries: CatalogueEntry[];
  rejectedSections: string[];
  duplicates: string[];
  warnings: string[];
  errors: string[];
}
const CODE = /^F\s?\d\s?\d\s?\d$/;
const labels = [
  'Subject',
  'Material:',
  'Test Programs',
  'Requirements',
  'Requirements / Identification',
  'Test samples',
  'Test Samples',
  'Test procedure',
  'Test Procedure',
  'Test Regulation',
  'Description',
  'Cause',
  'Prevention',
  'Evaluation',
];
const clean = (s: string) =>
  s
    .replace(/<[^<>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const PROCESS_RANGES = [
  { upperBound: 200, name: 'Bobinage' },
  { upperBound: 300, name: 'Tressage' },
  { upperBound: 400, name: 'Coupage' },
  { upperBound: 500, name: 'Enroulement' },
] as const;

const process = (code: string) => {
  const n = Number(code.slice(1));
  return PROCESS_RANGES.find(({ upperBound }) => n < upperBound)?.name;
};

function paragraphText(xml: string): string[] {
  return [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)]
    .map((match) =>
      clean(
        [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map((textMatch) => textMatch[1])
          .join(' '),
      ),
    )
    .filter(Boolean);
}

function matchingLabel(value: string): string | undefined {
  const normalizedValue = value.toLowerCase();
  return labels.find((candidate) => {
    const normalized = candidate.toLowerCase().replace(/:$/, '');
    return (
      normalizedValue === normalized ||
      normalizedValue === `${normalized}:` ||
      normalizedValue.startsWith(`${normalized}: `)
    );
  });
}

function sectionFields(section: string[]): Map<string, string[]> {
  const values = new Map<string, string[]>();
  let currentLabel = '';
  for (const value of section.slice(1)) {
    const label = matchingLabel(value);
    if (label) {
      currentLabel = label.toLowerCase().replace(/:$/, '');
      const separator = value.indexOf(':');
      const inline = separator >= 0 ? value.slice(separator + 1).trim() : '';
      if (inline)
        values.set(currentLabel, [...(values.get(currentLabel) ?? []), inline]);
    } else if (currentLabel) {
      values.set(currentLabel, [...(values.get(currentLabel) ?? []), value]);
    }
  }
  return values;
}

function field(values: Map<string, string[]>, key: string): string | undefined {
  return [...new Set(values.get(key) ?? [])].join(' ').trim() || undefined;
}

function sectionName(section: string[]): string | undefined {
  return section.slice(1).find((value) => {
    const compact = value.replace(/\s+/g, '');
    return !CODE.test(compact) && !matchingLabel(value);
  });
}

function mergeDuplicate(existing: CatalogueEntry, entry: CatalogueEntry): void {
  for (const key of [
    'description',
    'cause',
    'prevention',
    'evaluation',
    'testSamples',
    'testProcedure',
    'testRegulation',
  ] as const) {
    if (entry[key] && !existing[key]) existing[key] = entry[key];
  }
}
export async function parseProductDefectCatalogue(
  filePath: string,
): Promise<CatalogueReport> {
  const z = await JSZip.loadAsync(await readFile(filePath));
  const xml = await z.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX does not contain word/document.xml');
  const ps = paragraphText(xml);
  const starts = ps
    .map((v, i) => ({ v: v.replace(/\s+/g, ''), i }))
    .filter((x) => CODE.test(x.v));
  const out: CatalogueReport = {
    sourceFile: filePath,
    sectionsInspected: starts.length,
    validEntries: [],
    rejectedSections: [],
    duplicates: [],
    warnings: [],
    errors: [],
  };
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const section = ps.slice(s.i, starts[i + 1]?.i ?? ps.length);
    const vals = sectionFields(section);
    const name = sectionName(section);
    if (!name) {
      out.rejectedSections.push(`${s.v}@${s.i + 1}`);
      continue;
    }
    const entry: CatalogueEntry = {
      defectCode: s.v,
      defectName: name,
      normalizedProcess: process(s.v),
      description: field(vals, 'description'),
      cause: field(vals, 'cause'),
      prevention: field(vals, 'prevention'),
      evaluation: field(vals, 'evaluation'),
      testSamples: field(vals, 'test samples'),
      testProcedure: field(vals, 'test procedure'),
      testRegulation: field(vals, 'test regulation'),
      source: 'OFFICIAL_IPROFLEX_DEFECT_CATALOGUE',
      sourceFile: basename(filePath),
      sourceSection: i + 1,
      sourceParagraph: s.i + 1,
      importIdentity: '',
    };
    entry.importIdentity = createHash('sha256')
      .update(
        `iproflex-catalogue-v1|${entry.defectCode}|${entry.sourceSection}|${entry.sourceParagraph}`,
      )
      .digest('hex');
    const existing = out.validEntries.find(
      (x) => x.defectCode === entry.defectCode,
    );
    if (existing) {
      out.duplicates.push(entry.defectCode);
      mergeDuplicate(existing, entry);
      continue;
    }
    out.validEntries.push(entry);
  }
  return out;
}
