import { describe, expect, it, jest } from '@jest/globals';
import { HealthService } from './health.service';
import { Connection } from 'mongoose';
import { EmailService } from '../email/email.service';

describe('HealthService', () => {
  it('returns API health payload', () => {
    const mockConnection = {} as Connection;
    const mockEmailService = {
      getDiagnostics: jest.fn(),
    } as unknown as EmailService;
    const service = new HealthService(mockConnection, mockEmailService);

    const result = service.getApiHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns aggregated health payload', async () => {
    const ping = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const getDiagnostics = jest.fn<() => Promise<any>>().mockResolvedValue({
      status: 'ok',
      service: 'email',
      mode: 'smtp',
      smtp: {
        configured: true,
        reachable: true,
      },
      brevoApi: {
        configured: false,
      },
      timestamp: new Date().toISOString(),
    });
    const mockConnection = {
      db: {
        admin: () => ({ ping }),
      },
    } as unknown as Connection;
    const mockEmailService = {
      getDiagnostics,
    } as unknown as EmailService;
    const service = new HealthService(mockConnection, mockEmailService);

    const result = await service.getHealth();

    expect(result.status).toBe('ok');
    expect(result.checks.api.service).toBe('api');
    expect(result.checks.database.service).toBe('database');
    expect(result.checks.email.service).toBe('email');
    expect(ping).toHaveBeenCalledTimes(1);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('sanitizes public health output so dependency diagnostics are not exposed anonymously', async () => {
    const ping = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const getDiagnostics = jest.fn<() => Promise<any>>().mockResolvedValue({
      status: 'degraded',
      service: 'email',
      mode: 'brevo-api',
      smtp: {
        configured: true,
        reachable: false,
        errorCode: 'SMTP_AUTH_FAILED',
      },
      brevoApi: {
        configured: true,
      },
      timestamp: new Date().toISOString(),
    });
    const mockConnection = {
      db: {
        admin: () => ({ ping }),
      },
    } as unknown as Connection;
    const mockEmailService = {
      getDiagnostics,
    } as unknown as EmailService;
    const service = new HealthService(mockConnection, mockEmailService);

    const result = await service.getPublicHealth();
    const serialized = JSON.stringify(result);

    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({
      api: {
        status: 'ok',
        service: 'api',
      },
      database: {
        status: 'ok',
        service: 'database',
      },
    });
    expect(getDiagnostics).not.toHaveBeenCalled();
    expect(serialized).not.toContain('SMTP_AUTH_FAILED');
    expect(serialized).not.toContain('brevo-api');
    expect(serialized).not.toContain('configured');
  });
});
