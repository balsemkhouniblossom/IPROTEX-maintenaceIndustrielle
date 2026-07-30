import {
  AiProviderDiagnostics,
  AiAssistantRequest,
  AiProvider,
  AiProviderResult,
} from '../ai-provider.interface';

/**
 * The default provider in every environment where the feature hasn't been
 * explicitly turned on with a real API key — see `validateAiAssistant` in
 * `config/env.validation.ts` and the `AI_PROVIDER` factory in
 * `ai-assistant.module.ts`. Never makes a network call; always rejects, so
 * `AiAssistantService` falls into its `disabled`/`error` handling rather
 * than silently returning an empty-looking success.
 */
export class NullAiProvider implements AiProvider {
  readonly name = 'disabled';

  getDiagnostics(): AiProviderDiagnostics {
    return {
      enabled: false,
      configured: false,
      provider: this.name,
      status: 'disabled',
      message: 'AI assistant is intentionally disabled',
    };
  }

  async generate(): Promise<AiProviderResult> {
    throw new Error('AI assistant provider is disabled');
  }
}
