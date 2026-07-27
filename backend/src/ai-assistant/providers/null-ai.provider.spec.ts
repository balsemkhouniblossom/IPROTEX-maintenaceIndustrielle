import { NullAiProvider } from './null-ai.provider';

describe('NullAiProvider', () => {
  it('is named "disabled"', () => {
    expect(new NullAiProvider().name).toBe('disabled');
  });

  it('always rejects rather than returning a fabricated answer', async () => {
    await expect(new NullAiProvider().generate()).rejects.toThrow(
      'AI assistant provider is disabled',
    );
  });
});
