import * as fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { parseProductDefectCatalogue } from './product-defect-catalogue.parser';
describe('catalogue parser', () => {
  const file =
    'C:/Users/Balsem/Downloads/FM_7_5-19_iproFlex_Defect_Catalogue_EN.docx';
  const run = fs.existsSync(file) ? it : it.skip;
  run('extracts entries', async () => {
    const r = await parseProductDefectCatalogue(file);
    expect(r.validEntries.length).toBeGreaterThan(10);
    expect(
      r.validEntries.find((x) => x.defectCode === 'F103')?.normalizedProcess,
    ).toBe('Bobinage');
    expect(
      r.validEntries.find((x) => x.defectCode === 'F201')?.normalizedProcess,
    ).toBe('Tressage');
    expect(r.validEntries.every((x) => x.importIdentity.length === 64)).toBe(
      true,
    );
  });
  run('is deterministic', async () =>
    expect(await parseProductDefectCatalogue(file)).toEqual(
      await parseProductDefectCatalogue(file),
    ),
  );
  run(
    'deduplicates repeated official layout sections and retains optional field gaps',
    async () => {
      const parsed = await parseProductDefectCatalogue(file);
      expect(parsed.sectionsInspected).toBe(40);
      expect(parsed.validEntries).toHaveLength(20);
      expect(parsed.duplicates).toHaveLength(20);
      expect(
        new Set(parsed.validEntries.map((entry) => entry.defectCode)).size,
      ).toBe(20);
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F201')
          ?.defectName,
      ).toBe('Loop in the sleeve');
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F201')
          ?.description,
      ).toBeTruthy();
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F103')
          ?.normalizedProcess,
      ).toBe('Bobinage');
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F201')
          ?.normalizedProcess,
      ).toBe('Tressage');
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F303')
          ?.normalizedProcess,
      ).toBe('Coupage');
      expect(
        parsed.validEntries.find((entry) => entry.defectCode === 'F401')
          ?.normalizedProcess,
      ).toBe('Enroulement');
    },
  );
  it('ignores malformed placeholders, rejects nameless code sections, and merges a repeated section', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'iproflex-catalogue-cells-'),
    );
    const fixture = join(directory, 'catalogue-fixture.docx');
    try {
      const paragraphs = [
        'F 2 ?',
        'F201',
        'Loop in the sleeve',
        'F201',
        'Loop in the sleeve',
        'Description',
        'The sleeve contains a loop.',
        'F305',
        'F501',
        'Unknown process sample',
      ];
      const zip = new JSZip();
      zip.file(
        'word/document.xml',
        `<w:document><w:body>${paragraphs.map((value) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
      );
      await writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }));
      const first = await parseProductDefectCatalogue(fixture);
      const second = await parseProductDefectCatalogue(fixture);
      expect(first.validEntries.map((entry) => entry.defectCode)).toEqual([
        'F201',
        'F501',
      ]);
      expect(first.duplicates).toEqual(['F201']);
      expect(first.rejectedSections).toEqual(['F305@8']);
      expect(first.validEntries[0].description).toBe(
        'The sleeve contains a loop.',
      );
      expect(first.validEntries[0].cause).toBeUndefined();
      expect(first.validEntries[1].normalizedProcess).toBeUndefined();
      expect(first.validEntries.map((entry) => entry.importIdentity)).toEqual(
        second.validEntries.map((entry) => entry.importIdentity),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
