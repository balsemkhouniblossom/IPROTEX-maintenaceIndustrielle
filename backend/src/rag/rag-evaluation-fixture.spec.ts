import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type EvaluationCase = {
  category: string;
  locale: string;
  role?: string;
  forbiddenSource?: string;
  expectGrounded?: boolean;
  mustNotContain?: string;
};

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'rag-evaluation.json'), 'utf8'),
) as EvaluationCase[];

describe('RAG controlled evaluation fixture', () => {
  it('contains the required quality and security categories', () => {
    expect(fixture).toHaveLength(20);
    expect(new Set(fixture.map((item) => item.category))).toEqual(
      new Set([
        'direct-factual',
        'maintenance-interval',
        'procedure',
        'machine-specific',
        'no-answer',
        'authorization',
        'prompt-injection',
        'source-attribution',
      ]),
    );
  });

  it('covers every supported locale and explicit abstention cases', () => {
    expect(new Set(fixture.map((item) => item.locale))).toEqual(
      new Set(['en', 'fr', 'ar', 'es', 'de', 'it']),
    );
    expect(
      fixture.filter((item) => item.expectGrounded === false).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('defines authorization and injection leak assertions', () => {
    expect(
      fixture.some((item) => item.role === 'operator' && item.forbiddenSource),
    ).toBe(true);
    expect(
      fixture.some(
        (item) => item.category === 'prompt-injection' && item.mustNotContain,
      ),
    ).toBe(true);
  });
});
