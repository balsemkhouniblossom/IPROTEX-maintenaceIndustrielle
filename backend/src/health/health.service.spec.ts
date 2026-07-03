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
});
