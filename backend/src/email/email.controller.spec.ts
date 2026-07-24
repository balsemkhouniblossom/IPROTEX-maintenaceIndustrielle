import {
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthThrottleService } from '../auth/auth-throttle.service';
import { Role } from '../schemas/user.schema';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

describe('EmailController diagnostics', () => {
  let controller: EmailController;
  let emailService: { sendMail: jest.Mock };
  let configService: { get: jest.Mock };
  let throttleService: {
    consume: jest.Mock;
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };

  const request = {
    method: 'GET',
    path: '/email/test',
    headers: { 'x-forwarded-for': '203.0.113.5' },
    user: {
      userId: 'admin-id',
      email: 'admin@example.test',
      role: Role.ADMIN,
    },
  };

  beforeEach(() => {
    emailService = {
      sendMail: jest.fn().mockResolvedValue('smtp-preview-url'),
    };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | undefined> = {
          ENABLE_EMAIL_DIAGNOSTIC_TEST: 'true',
          EMAIL_DIAGNOSTIC_RECIPIENT: 'diagnostic@example.test',
          EMAIL_FROM: 'Iprotex <noreply@example.test>',
        };
        return values[key];
      }),
    };
    throttleService = {
      consume: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };

    controller = new EmailController(
      emailService as unknown as EmailService,
      configService as unknown as ConfigService,
      throttleService as unknown as AuthThrottleService,
    );
    jest.spyOn(controller['logger'], 'log').mockImplementation();
  });

  it('is unavailable when the explicit diagnostic flag is disabled', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'ENABLE_EMAIL_DIAGNOSTIC_TEST' ? 'false' : undefined,
    );

    await expect(controller.test(request as never)).rejects.toThrow(
      NotFoundException,
    );
    expect(throttleService.consume).not.toHaveBeenCalled();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it('sends only the restricted diagnostic message to the configured recipient', async () => {
    const result = await controller.test(request as never);

    expect(throttleService.consume).toHaveBeenCalledWith(
      'email-diagnostic',
      request,
      { email: 'admin@example.test' },
    );
    expect(emailService.sendMail).toHaveBeenCalledWith({
      to: 'diagnostic@example.test',
      subject: 'Iprotex email diagnostic',
      text: 'This is a restricted Iprotex email delivery diagnostic.',
      html: '<p>This is a restricted Iprotex email delivery diagnostic.</p>',
    });
    expect(throttleService.recordSuccess).toHaveBeenCalledWith(
      'email-diagnostic',
      request,
      { email: 'admin@example.test' },
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'sent',
        diagnostic: 'email',
        requestedBy: 'admin-id',
      }),
    );
    expect(result).not.toHaveProperty('smtp');
    expect(result).not.toHaveProperty('previewUrl');
  });

  it('falls back to EMAIL_FROM when no diagnostic recipient is configured', async () => {
    configService.get.mockImplementation((key: string) => {
      const values: Record<string, string | undefined> = {
        ENABLE_EMAIL_DIAGNOSTIC_TEST: 'true',
        EMAIL_FROM: 'Iprotex <sender@example.test>',
      };
      return values[key];
    });

    await controller.test(request as never);

    expect(emailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sender@example.test' }),
    );
  });

  it('returns a sanitized error when the provider fails', async () => {
    emailService.sendMail.mockRejectedValue(
      new Error('SMTP secret provider failure'),
    );

    await expect(controller.test(request as never)).rejects.toThrow(
      BadGatewayException,
    );
    expect(throttleService.recordFailure).toHaveBeenCalledWith(
      'email-diagnostic',
      request,
      { email: 'admin@example.test' },
    );
  });

  it('records structured Admin audit events without provider secrets', async () => {
    const logSpy = jest.spyOn(controller['logger'], 'log').mockImplementation();

    await controller.test(request as never);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'admin_email_diagnostic',
        outcome: 'attempted',
        actorUserId: 'admin-id',
        actorRole: Role.ADMIN,
        method: 'GET',
        path: '/email/test',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'admin_email_diagnostic',
        outcome: 'sent',
      }),
    );
  });
});
