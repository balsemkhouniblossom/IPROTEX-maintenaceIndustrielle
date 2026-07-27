import Anthropic from '@anthropic-ai/sdk';
import {
  AiAssistantRequest,
  AiProvider,
  AiProviderResult,
} from '../ai-provider.interface';
import {
  AI_ANSWER_JSON_SCHEMA,
  buildSystemPrompt,
  buildUserPrompt,
  normalizeAnswer,
} from '../ai-prompt.util';

export type AnthropicAiProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};

/**
 * The real provider, wired in only when `AI_ASSISTANT_ENABLED=true` and an
 * `ANTHROPIC_API_KEY` are both present (see `ai-assistant.module.ts`) — off
 * by default everywhere else, per `NullAiProvider`. Uses the official
 * `@anthropic-ai/sdk`, never raw HTTP. The response shape is constrained via
 * `output_config.format` (structured outputs) rather than trusted free text,
 * so "known facts / probable causes / recommended checks / safety warnings /
 * uncertainty" is enforced by the API, not just requested in the prompt.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicAiProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
    });
    this.model = options.model;
  }

  async generate(
    request: AiAssistantRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 1024,
        system: buildSystemPrompt(request.locale),
        messages: [{ role: 'user', content: buildUserPrompt(request) }],
        output_config: {
          format: { type: 'json_schema', schema: AI_ANSWER_JSON_SCHEMA },
        },
      },
      { signal },
    );

    if (response.stop_reason === 'refusal') {
      throw new Error('AI provider declined to answer this request');
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new Error('AI provider returned no text content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new Error('AI provider returned malformed JSON');
    }

    return { answer: normalizeAnswer(parsed), model: this.model };
  }
}
