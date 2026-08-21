import { RequestContextService } from './request-context.service';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';
import { TemplateRendererService } from '../notifications/template-renderer.service';
import { NotificationsListener } from '../notifications/notifications.listener';
import { NotificationsFacade } from '../notifications/notifications.facade';
import { WorkOrderNotificationService } from '../work-orders/services/work-order-notification.service';
import { NotificationType } from '../schemas/notification.schema';
import { Role } from '../schemas/user.schema';

describe('small service coverage', () => {
  it('keeps request-scoped values isolated and memoizes getOrSet values', () => {
    const context = new RequestContextService();

    expect(context.get('missing')).toBeUndefined();
    context.set('outside', 'ignored');
    expect(context.get('outside')).toBeUndefined();

    const factory = jest.fn(() => 'computed');
    const result = context.run(() => {
      context.set('requestId', 'req-1');
      return {
        requestId: context.get('requestId'),
        first: context.getOrSet('memo', factory),
        second: context.getOrSet('memo', factory),
      };
    });

    expect(result).toEqual({
      requestId: 'req-1',
      first: 'computed',
      second: 'computed',
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.get('requestId')).toBeUndefined();
  });

  it('parses feature flags from config values with safe fallbacks', () => {
    const values: Record<string, string | undefined> = {
      ENABLE_LEGACY_EMAIL_TOKENS: ' yes ',
      ENABLE_LEGACY_RESET_TOKENS: 'off',
      ENABLE_EVENT_BASED_EMAILS: 'not-a-boolean',
    };
    const service = new FeatureFlagsConfigService({
      get: jest.fn((key: string) => values[key]),
    } as never);

    expect(service.isLegacyEmailTokensEnabled()).toBe(true);
    expect(service.isLegacyResetTokensEnabled()).toBe(false);
    expect(service.isEventBasedEmailsEnabled()).toBe(false);
  });

  it('renders notification email templates with subject, text, and html content', () => {
    const renderer = new TemplateRendererService();
    const verification = renderer.renderVerificationEmail(
      'https://app.example.test/verify',
    );
    const reset = renderer.renderResetPasswordEmail(
      'https://app.example.test/reset',
    );

    expect(verification.subject).toBe('Verify your email - Iprotex');
    expect(verification.text).toContain('https://app.example.test/verify');
    expect(verification.html).toContain(
      '<a href="https://app.example.test/verify">',
    );
    expect(reset.subject).toBe('Reset your password - Iprotex');
    expect(reset.text).toContain('https://app.example.test/reset');
    expect(reset.html).toContain('This link expires in 1 hour');
  });

  it('sends notification listener emails through rendered templates and built URLs', async () => {
    const emailService = {
      sendMail: jest.fn().mockResolvedValue('message-id'),
    };
    const renderer = new TemplateRendererService();
    const urlBuilder = {
      verificationEmailUrl: jest.fn(() => 'https://app.example.test/verify'),
      resetPasswordUrl: jest.fn(() => 'https://app.example.test/reset'),
    };
    const listener = new NotificationsListener(
      emailService as never,
      renderer,
      urlBuilder as never,
    );

    await expect(
      listener.onVerificationEmailIntent({
        to: 'ada@example.test',
        token: 'token',
        locale: 'en',
        frontendOrigin: 'https://app.example.test',
      }),
    ).resolves.toBe('message-id');
    await expect(
      listener.onResetPasswordEmailIntent({
        to: 'ada@example.test',
        resetToken: 'reset-token',
        locale: 'fr',
        frontendOrigin: 'https://app.example.test',
      }),
    ).resolves.toBe('message-id');

    expect(emailService.sendMail).toHaveBeenCalledTimes(2);
    expect(emailService.sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'ada@example.test',
        subject: 'Verify your email - Iprotex',
      }),
    );
    expect(emailService.sendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        subject: 'Reset your password - Iprotex',
      }),
    );
  });

  it('routes notification facade through event-based or legacy email paths per request', async () => {
    const featureFlags = {
      isEventBasedEmailsEnabled: jest.fn().mockReturnValue(true),
    };
    const requestContext = new RequestContextService();
    const listener = {
      onVerificationEmailIntent: jest.fn().mockResolvedValue('event-id'),
      onResetPasswordEmailIntent: jest.fn().mockResolvedValue('event-reset-id'),
    };
    const emailService = { sendMail: jest.fn().mockResolvedValue('legacy-id') };
    const renderer = new TemplateRendererService();
    const urlBuilder = {
      verificationEmailUrl: jest.fn(() => 'https://app.example.test/verify'),
      resetPasswordUrl: jest.fn(() => 'https://app.example.test/reset'),
    };
    const facade = new NotificationsFacade(
      featureFlags as never,
      requestContext,
      listener as never,
      emailService as never,
      renderer,
      urlBuilder as never,
    );

    await requestContext.run(async () => {
      await expect(
        facade.sendVerificationEmail({
          to: 'ada@example.test',
          token: 'token',
          locale: 'en',
          frontendOrigin: 'https://app.example.test',
        }),
      ).resolves.toBe('event-id');
      await expect(
        facade.sendResetPasswordEmail({
          to: 'ada@example.test',
          resetToken: 'reset-token',
          locale: 'en',
          frontendOrigin: 'https://app.example.test',
        }),
      ).resolves.toBe('event-reset-id');
    });

    expect(featureFlags.isEventBasedEmailsEnabled).toHaveBeenCalledTimes(2);
    expect(listener.onVerificationEmailIntent).toHaveBeenCalled();
    expect(listener.onResetPasswordEmailIntent).toHaveBeenCalled();

    featureFlags.isEventBasedEmailsEnabled.mockReturnValue(false);
    await expect(
      facade.sendVerificationEmail({
        to: 'legacy@example.test',
        token: 'token',
        locale: 'en',
        frontendOrigin: 'https://app.example.test',
      }),
    ).resolves.toBe('legacy-id');
    expect(emailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'legacy@example.test',
        subject: 'Verify your email - Iprotex',
      }),
    );
  });

  it('creates work-order notifications with expected dedupe keys and recipients', async () => {
    const notificationCenter = {
      createIfNotExists: jest
        .fn()
        .mockResolvedValue({ _id: 'notification-id' }),
    };
    const service = new WorkOrderNotificationService(
      notificationCenter as never,
    );

    await expect(service.notifyCreated({ _id: 'wo-1' })).resolves.toBeNull();
    await service.notifyCreated({
      _id: 'wo-1',
      technician_id: 'tech-1',
      machine_id: 'machine-1',
      ot_id: 'OT-1',
    });
    await service.notifyValidationDecision({
      workOrderId: 'wo-1',
      action: 'approve',
      technicianId: 'tech-1',
      otId: 'OT-1',
    });
    await service.notifyValidationDecision({
      workOrderId: 'wo-1',
      action: 'reject',
      technicianId: 'tech-1',
      otId: 'OT-1',
    });
    await service.notifyCorrectiveAwaitingValidation({
      workOrderId: 'wo-1',
      otId: 'OT-1',
      reportId: 'report-1',
    });
    await service.notifyPartRequestCreated({
      requestId: 'request-1',
      otId: 'OT-1',
      workOrderId: 'wo-1',
    });
    await service.notifyPartRequestDecision({
      requestId: 'request-1',
      decision: 'cancel',
      requesterUserId: 'tech-1',
      workOrderId: 'wo-1',
    });
    await service.notifyPartRequestDecision({
      requestId: 'request-2',
      decision: 'reject',
      requesterUserId: 'tech-1',
      workOrderId: 'wo-1',
    });

    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'work_order_created:wo-1',
        type: NotificationType.WORK_ORDER_CREATED,
        recipientUserId: 'tech-1',
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.VALIDATION_APPROVED,
        title: 'Your report for OT-1 was approved',
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.VALIDATION_REJECTED,
        title: 'Your report for OT-1 was rejected',
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CORRECTIVE_AWAITING_VALIDATION,
        recipientRole: Role.ADMIN,
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.PART_REQUEST_CREATED,
        recipientRole: Role.TECHNICIAN,
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'part_request_decision:request-1:cancel',
        title: 'Your reserved part request was cancelled',
      }),
    );
    expect(notificationCenter.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'part_request_decision:request-2:reject',
        title: 'Your part request was rejected',
      }),
    );
  });
});
