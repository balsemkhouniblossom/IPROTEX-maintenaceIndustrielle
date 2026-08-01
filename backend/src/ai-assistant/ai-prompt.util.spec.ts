import {
  buildSystemPrompt,
  buildUserPrompt,
  normalizeAnswer,
} from './ai-prompt.util';
import { AiAssistantRequest } from './ai-provider.interface';

describe('normalizeAnswer', () => {
  it('passes through a well-formed answer unchanged', () => {
    const answer = normalizeAnswer({
      knownFacts: ['a'],
      probableCauses: ['b'],
      recommendedChecks: ['c'],
      safetyWarnings: ['d'],
      uncertainty: 'e',
    });

    expect(answer).toEqual({
      knownFacts: ['a'],
      probableCauses: ['b'],
      recommendedChecks: ['c'],
      safetyWarnings: ['d'],
      uncertainty: 'e',
    });
  });

  it('defaults every field when given an empty object', () => {
    expect(normalizeAnswer({})).toEqual({
      knownFacts: [],
      probableCauses: [],
      recommendedChecks: [],
      safetyWarnings: [],
      uncertainty: '',
    });
  });

  it('drops non-string entries from array fields rather than crashing', () => {
    const answer = normalizeAnswer({
      knownFacts: ['ok', 42, null, { nested: true }],
      probableCauses: 'not-an-array',
      uncertainty: 99,
    });

    expect(answer.knownFacts).toEqual(['ok']);
    expect(answer.probableCauses).toEqual([]);
    expect(answer.uncertainty).toBe('');
  });

  it('handles null/undefined input safely', () => {
    expect(normalizeAnswer(null)).toEqual({
      knownFacts: [],
      probableCauses: [],
      recommendedChecks: [],
      safetyWarnings: [],
      uncertainty: '',
    });
    expect(normalizeAnswer(undefined)).toEqual({
      knownFacts: [],
      probableCauses: [],
      recommendedChecks: [],
      safetyWarnings: [],
      uncertainty: '',
    });
  });
});

describe('buildSystemPrompt', () => {
  it('states the advisory-only constraint explicitly', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toMatch(/advisory/i);
    expect(prompt).toMatch(/work order, stock level, machine status/i);
  });

  it('instructs the model to answer in the requested locale', () => {
    expect(buildSystemPrompt('fr')).toContain('locale "fr"');
    expect(buildSystemPrompt('ar')).toContain('locale "ar"');
  });

  it('instructs the model to treat context/question content as untrusted data', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toMatch(/untrusted reference data/i);
  });
});

describe('buildUserPrompt', () => {
  function request(
    overrides: Partial<AiAssistantRequest> = {},
  ): AiAssistantRequest {
    return {
      question: 'Why does the motor trip?',
      locale: 'en',
      context: {
        activeAlarms: [],
        maintenanceHistory: [],
        knowledgeArticles: [],
      },
      ...overrides,
    };
  }

  it('includes the operator question inside a <question> block', () => {
    const prompt = buildUserPrompt(request());
    expect(prompt).toContain('<question>');
    expect(prompt).toContain('Why does the motor trip?');
  });

  it('reports when there are no active alarms or maintenance history rather than omitting the section', () => {
    const prompt = buildUserPrompt(request());
    expect(prompt).toMatch(/none currently active/i);
    expect(prompt).toMatch(/no prior work orders/i);
  });

  it('includes active alarms and maintenance history when present', () => {
    const prompt = buildUserPrompt(
      request({
        context: {
          faultCode: 'E-42',
          activeAlarms: [
            {
              codePanne: 'E-42',
              severity: 'critical',
              raisedAt: '2026-07-01T10:00:00.000Z',
            },
          ],
          maintenanceHistory: [
            {
              date: '2026-06-01T00:00:00.000Z',
              status: 'closed',
              description: 'Bearing replaced',
            },
          ],
          knowledgeArticles: [],
        },
      }),
    );

    expect(prompt).toContain('E-42');
    expect(prompt).toContain('Bearing replaced');
  });
});
