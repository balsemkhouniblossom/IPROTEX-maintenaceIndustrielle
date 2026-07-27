const createMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

import { AnthropicAiProvider } from './anthropic-ai.provider';
import { AiAssistantRequest } from '../ai-provider.interface';

function request(): AiAssistantRequest {
  return {
    question: 'Why does the motor trip?',
    locale: 'en',
    context: { activeAlarms: [], maintenanceHistory: [], knowledgeArticles: [] },
  };
}

describe('AnthropicAiProvider', () => {
  let provider: AnthropicAiProvider;

  beforeEach(() => {
    createMock.mockReset();
    provider = new AnthropicAiProvider({
      apiKey: 'test-key',
      model: 'claude-opus-4-8',
      timeoutMs: 5000,
    });
  });

  it('is named "anthropic"', () => {
    expect(provider.name).toBe('anthropic');
  });

  it('parses a well-formed structured JSON response into an answer', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            knownFacts: ['Motor tripped twice today'],
            probableCauses: ['Overcurrent'],
            recommendedChecks: ['Inspect bearing'],
            safetyWarnings: ['Lock out before inspection'],
            uncertainty: 'Cannot confirm without a technician visit',
          }),
        },
      ],
    });

    const result = await provider.generate(request(), new AbortController().signal);

    expect(result.model).toBe('claude-opus-4-8');
    expect(result.answer.knownFacts).toEqual(['Motor tripped twice today']);
    expect(result.answer.safetyWarnings).toEqual(['Lock out before inspection']);
  });

  it('throws when the model refuses to answer', async () => {
    createMock.mockResolvedValue({ stop_reason: 'refusal', content: [] });

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toThrow('declined to answer');
  });

  it('throws when the response has no text content block', async () => {
    createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [] });

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toThrow('no text content');
  });

  it('throws when the response text is not valid JSON', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json at all' }],
    });

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toThrow('malformed JSON');
  });

  it('requests output_config.format so the response is schema-constrained', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            knownFacts: [],
            probableCauses: [],
            recommendedChecks: [],
            safetyWarnings: [],
            uncertainty: '',
          }),
        },
      ],
    });

    await provider.generate(request(), new AbortController().signal);

    const [[params]] = createMock.mock.calls;
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.model).toBe('claude-opus-4-8');
  });
});
