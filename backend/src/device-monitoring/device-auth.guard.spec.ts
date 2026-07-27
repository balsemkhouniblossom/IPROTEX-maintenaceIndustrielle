import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { DeviceAuthGuard } from './device-auth.guard';

function contextWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
  const request: { headers: Record<string, string | undefined>; device?: unknown } = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('DeviceAuthGuard', () => {
  let deviceAuthService: { verifyCredentials: jest.Mock };
  let guard: DeviceAuthGuard;

  beforeEach(() => {
    deviceAuthService = { verifyCredentials: jest.fn() };
    guard = new DeviceAuthGuard(deviceAuthService as never);
  });

  it('rejects a request with no device headers', async () => {
    const context = contextWithHeaders({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
  });

  it('rejects a request with only one of the two required headers', async () => {
    const context = contextWithHeaders({ 'x-device-id': 'DEV-1' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('never accepts a bearer JWT in place of device headers', async () => {
    const context = contextWithHeaders({ authorization: 'Bearer some.jwt.token' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
  });

  it('delegates to DeviceAuthService and attaches the verified device to the request', async () => {
    const device = { device_id: 'DEV-1' };
    deviceAuthService.verifyCredentials.mockResolvedValue(device);
    const context = contextWithHeaders({ 'x-device-id': 'DEV-1', 'x-device-key': 'prefix.secret' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(deviceAuthService.verifyCredentials).toHaveBeenCalledWith('DEV-1', 'prefix.secret');
    const request = context.switchToHttp().getRequest<{ device?: unknown }>();
    expect(request.device).toBe(device);
  });

  it('propagates the underlying UnauthorizedException from DeviceAuthService', async () => {
    deviceAuthService.verifyCredentials.mockRejectedValue(new UnauthorizedException());
    const context = contextWithHeaders({ 'x-device-id': 'DEV-1', 'x-device-key': 'prefix.wrong' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
