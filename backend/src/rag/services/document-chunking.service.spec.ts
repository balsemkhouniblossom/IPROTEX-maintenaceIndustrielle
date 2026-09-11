import { DocumentChunkingService } from './document-chunking.service';

describe('DocumentChunkingService', () => {
  const service = new DocumentChunkingService();

  it('preserves technical text and source metadata deterministically', () => {
    const pages = [
      {
        pageNumber: 7,
        text: `BEARING MAINTENANCE\n\nInspect FF37 at 24 V and lubricate LED01. ${'step '.repeat(800)}`,
      },
    ];

    const first = service.chunk(pages);
    const second = service.chunk(pages);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      chunkIndex: 0,
      pageNumber: 7,
      section: 'BEARING MAINTENANCE',
    });
    expect(first[0].content).toContain('FF37');
    expect(first[0].content.split(/\s+/)).toHaveLength(700);
    expect(
      first.every((chunk) => chunk.content.split(/\s+/).length <= 700),
    ).toBe(true);
  });

  it('does not create tiny chunks', () => {
    expect(service.chunk([{ text: 'short' }])).toEqual([]);
  });
});
