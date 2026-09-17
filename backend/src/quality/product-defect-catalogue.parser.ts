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
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const process = (code: string) => {
  const n = Number(code.slice(1));
  return n < 200
    ? 'Bobinage'
    : n < 300
      ? 'Tressage'
      : n < 400
        ? 'Coupage'
        : n < 500
          ? 'Enroulement'
          : undefined;
};
export async function parseProductDefectCatalogue(
  filePath: string,
): Promise<CatalogueReport> {
  const z = await JSZip.loadAsync(await readFile(filePath));
  const xml = await z.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX does not contain word/document.xml');
  const ps = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)]
    .map((m) =>
      clean(
        [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map((x) => x[1])
          .join(' '),
      ),
    )
    .filter(Boolean);
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
    const s = starts[i],
      section = ps.slice(s.i, starts[i + 1]?.i ?? ps.length),
      vals = new Map<string, string[]>();
    let label = '';
    for (const v of section.slice(1)) {
      const l = labels.find((x) => {
        const normalized = x.toLowerCase().replace(/:$/, '');
        return (
          v.toLowerCase() === normalized ||
          v.toLowerCase() === `${normalized}:` ||
          v.toLowerCase().startsWith(`${normalized}: `)
        );
      });
      if (l) {
        label = l.toLowerCase().replace(/:$/, '');
        const inline = v.includes(':')
          ? v.slice(v.indexOf(':') + 1).trim()
          : '';
        if (inline) vals.set(label, [...(vals.get(label) ?? []), inline]);
        continue;
      }
      if (label) vals.set(label, [...(vals.get(label) ?? []), v]);
    }
    const field = (key: string) =>
      [...new Set(vals.get(key) ?? [])].join(' ').trim() || undefined;
    const name = section
      .slice(1)
      .find(
        (value) =>
          !CODE.test(value.replace(/\s+/g, '')) &&
          !labels.some((label) => label.toLowerCase() === value.toLowerCase()),
      );
    if (!name) {
      out.rejectedSections.push(`${s.v}@${s.i + 1}`);
      continue;
    }
    const entry: CatalogueEntry = {
      defectCode: s.v,
      defectName: name,
      normalizedProcess: process(s.v),
      description: field('description'),
      cause: field('cause'),
      prevention: field('prevention'),
      evaluation: field('evaluation'),
      testSamples: field('test samples'),
      testProcedure: field('test procedure'),
      testRegulation: field('test regulation'),
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
      for (const key of [
        'description',
        'cause',
        'prevention',
        'evaluation',
        'testSamples',
        'testProcedure',
        'testRegulation',
      ] as const) {
        const value = entry[key];
        if (value && !existing[key]) existing[key] = value;
      }
      continue;
    }
    out.validEntries.push(entry);
  }
  return out;
}
