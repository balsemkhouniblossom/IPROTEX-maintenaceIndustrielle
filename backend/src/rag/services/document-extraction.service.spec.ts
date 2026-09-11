import { BadRequestException } from '@nestjs/common';
import {
  DocumentExtractionService,
  normalizeText,
} from './document-extraction.service';

describe('DocumentExtractionService', () => {
  const service = new DocumentExtractionService();

  it('extracts and normalizes UTF-8 text without changing technical identifiers', async () => {
    await expect(
      service.extract(
        Buffer.from('  Fault  FF37\r\n\r\n\r\nLED01 = 24 V  '),
        'sop.txt',
      ),
    ).resolves.toMatchObject({
      text: 'Fault FF37\n\nLED01 = 24 V',
    });
  });

  it('rejects invalid UTF-8 and unsupported files clearly', async () => {
    await expect(
      service.extract(Buffer.from([0xff]), 'bad.txt'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.extract(Buffer.from('x'), 'sheet.xlsx'),
    ).rejects.toThrow('does not support .xlsx');
  });

  it('normalizes whitespace without lowercasing or stripping punctuation', () => {
    expect(normalizeText(' FF37\t  LED01: 24 V. ')).toBe('FF37 LED01: 24 V.');
  });
});
