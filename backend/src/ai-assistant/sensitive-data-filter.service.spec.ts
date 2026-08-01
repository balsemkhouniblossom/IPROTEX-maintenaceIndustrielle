import { SensitiveDataFilterService } from './sensitive-data-filter.service';

describe('SensitiveDataFilterService', () => {
  let service: SensitiveDataFilterService;

  beforeEach(() => {
    service = new SensitiveDataFilterService();
  });

  it('leaves ordinary maintenance text unchanged', () => {
    const result = service.redact('Motor 2 bearing is overheating above 80C.');

    expect(result.redacted).toBe('Motor 2 bearing is overheating above 80C.');
    expect(result.count).toBe(0);
  });

  it('redacts an email address', () => {
    const result = service.redact(
      'Contact operator.bob@example.com for details.',
    );

    expect(result.redacted).not.toContain('operator.bob@example.com');
    expect(result.redacted).toContain('[REDACTED_EMAIL]');
    expect(result.count).toBe(1);
  });

  it('redacts an api_key/secret/password key-value pair', () => {
    const result = service.redact(
      'Use api_key: sk-live-abc123def456 to authenticate.',
    );

    expect(result.redacted).not.toContain('sk-live-abc123def456');
    expect(result.redacted).toContain('[REDACTED_CREDENTIAL]');
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it('redacts a JWT-shaped token', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQrandomsig';
    const result = service.redact(`Bearer token is ${jwt}`);

    expect(result.redacted).not.toContain(jwt);
    expect(result.redacted).toContain('[REDACTED_TOKEN]');
  });

  it('redacts a phone number', () => {
    const result = service.redact(
      'Call the technician at +216 20 123 456 if urgent.',
    );

    expect(result.redacted).toContain('[REDACTED_PHONE]');
  });

  it('counts multiple distinct redactions in one string', () => {
    const result = service.redact(
      'Email me at ops@example.com or call +216 20 123 456.',
    );

    expect(result.count).toBe(2);
  });

  it('handles empty/undefined input safely', () => {
    expect(service.redact('')).toEqual({ redacted: '', count: 0 });
    expect(service.redact(undefined)).toEqual({ redacted: '', count: 0 });
    expect(service.redact(null)).toEqual({ redacted: '', count: 0 });
  });

  it('is stable across repeated calls (no shared regex lastIndex state)', () => {
    const first = service.redact('Reach me at ops@example.com');
    const second = service.redact('Reach me at ops@example.com');

    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
  });
});
