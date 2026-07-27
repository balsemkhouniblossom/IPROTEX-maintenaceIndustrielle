import { AiAssistantThrottleService } from './ai-assistant-throttle.service';

function configServiceStub(rateLimit?: string) {
  return { get: jest.fn().mockReturnValue(rateLimit) } as never;
}

describe('AiAssistantThrottleService', () => {
  it('allows requests under the configured limit', () => {
    const service = new AiAssistantThrottleService(configServiceStub('3'));

    expect(service.consume('user-1')).toEqual({ allowed: true });
    expect(service.consume('user-1')).toEqual({ allowed: true });
    expect(service.consume('user-1')).toEqual({ allowed: true });
  });

  it('blocks a request once the per-hour limit is exceeded and reports retryAfterSeconds', () => {
    const service = new AiAssistantThrottleService(configServiceStub('2'));

    service.consume('user-1');
    service.consume('user-1');
    const result = service.consume('user-1');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks each user independently', () => {
    const service = new AiAssistantThrottleService(configServiceStub('1'));

    expect(service.consume('user-1').allowed).toBe(true);
    expect(service.consume('user-1').allowed).toBe(false);
    expect(service.consume('user-2').allowed).toBe(true);
  });

  it('falls back to the default limit when unconfigured', () => {
    const service = new AiAssistantThrottleService(configServiceStub(undefined));

    for (let i = 0; i < 20; i += 1) {
      expect(service.consume('user-1').allowed).toBe(true);
    }
    expect(service.consume('user-1').allowed).toBe(false);
  });

  it('resetForTests clears all recorded hits', () => {
    const service = new AiAssistantThrottleService(configServiceStub('1'));

    service.consume('user-1');
    expect(service.consume('user-1').allowed).toBe(false);

    service.resetForTests();
    expect(service.consume('user-1').allowed).toBe(true);
  });
});
