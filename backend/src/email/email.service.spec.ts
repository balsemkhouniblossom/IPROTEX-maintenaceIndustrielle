import nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
    createTestAccount: jest.fn(),
    getTestMessageUrl: jest.fn(),
  },
}));

const mockedMailer = nodemailer as jest.Mocked<typeof nodemailer>;
const originalEnv = process.env;

const mail = {
  to: 'technician@example.com',
  subject: 'Maintenance alert',
  text: 'Machine M-1 requires attention',
  html: '<p>Machine M-1 requires attention</p>',
};

function setEnv(values: Record<string, string | undefined>) {
  process.env = { NODE_ENV: 'test' };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function smtpTransport(overrides: Record<string, unknown> = {}) {
  return {
    sendMail: jest.fn().mockResolvedValue({ messageId: 'smtp-1' }),
    verify: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('EmailService delivery and diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env = { ...originalEnv };
    delete (global as { fetch?: unknown }).fetch;
    mockedMailer.getTestMessageUrl.mockReturnValue(false);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the development Ethereal fallback when no provider is configured', async () => {
    setEnv({ NODE_ENV: 'development' });
    mockedMailer.createTestAccount.mockResolvedValue({
      user: 'ethereal-user',
      pass: 'ethereal-pass',
    } as never);
    const transport = smtpTransport();
    mockedMailer.createTransport.mockReturnValue(transport as never);
    mockedMailer.getTestMessageUrl.mockReturnValue('https://preview.test/mail');

    const result = await new EmailService().sendMail(mail);

    expect(result).toBe('https://preview.test/mail');
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: mail.to, subject: mail.subject }),
    );
  });

  it('rejects unconfigured delivery in production', async () => {
    setEnv({ NODE_ENV: 'production' });
    await expect(new EmailService().sendMail(mail)).rejects.toThrow(
      'SMTP provider is not configured',
    );
  });

  it('sends through SMTP and reports a reachable SMTP provider', async () => {
    setEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_VERIFY_ON_STARTUP: 'false',
      EMAIL_FROM: 'Maintenance <maintenance@example.com>',
      EMAIL_DELIVERY_MODE: 'smtp',
    });
    const transport = smtpTransport();
    mockedMailer.createTransport.mockReturnValue(transport as never);
    mockedMailer.getTestMessageUrl.mockReturnValue('https://preview.test/smtp');
    const service = new EmailService();

    await expect(service.sendMail(mail)).resolves.toBe(
      'https://preview.test/smtp',
    );
    await expect(service.getDiagnostics()).resolves.toMatchObject({
      status: 'ok',
      mode: 'smtp',
      smtp: { configured: true, reachable: true },
    });
    expect(mockedMailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
  });

  it('falls back to Brevo after a network SMTP failure and bypasses SMTP during cooldown', async () => {
    setEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_VERIFY_ON_STARTUP: 'false',
      SMTP_FALLBACK_COOLDOWN_MS: '60000',
      BREVO_API_KEY: 'brevo-secret',
      EMAIL_FROM: 'Iprotex <noreply@example.com>',
    });
    const transport = smtpTransport({
      sendMail: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        ),
    });
    mockedMailer.createTransport.mockReturnValue(transport as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    const service = new EmailService();

    await expect(service.sendMail(mail)).resolves.toBeUndefined();
    await expect(service.sendMail(mail)).resolves.toBeUndefined();

    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await expect(service.getDiagnostics()).resolves.toMatchObject({
      status: 'degraded',
      mode: 'brevo-api',
      smtp: { reachable: false, errorCode: 'ETIMEDOUT' },
    });
  });

  it('supports explicit Brevo mode and surfaces safe provider errors', async () => {
    setEnv({
      SMTP_HOST: 'ignored.example.com',
      EMAIL_DELIVERY_MODE: 'brevo-api',
      BREVO_API_KEY: 'brevo-secret',
      BREVO_API_URL: 'https://api.example.test/email',
      EMAIL_FROM: 'noreply@example.com',
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('unrecognised IP address'),
      }) as never;
    const service = new EmailService();

    await expect(service.sendMail(mail)).resolves.toBeUndefined();
    await expect(service.sendMail(mail)).rejects.toThrow(
      'Brevo API send failed (401)',
    );
    expect(mockedMailer.createTransport).not.toHaveBeenCalled();
  });

  it('rejects explicit Brevo mode without an API key', async () => {
    setEnv({ EMAIL_DELIVERY_MODE: 'brevo-api' });
    await expect(new EmailService().sendMail(mail)).rejects.toThrow(
      'requires BREVO_API_KEY',
    );
  });

  it('reports unconfigured and API-only diagnostic states', async () => {
    setEnv({ NODE_ENV: 'production' });
    await expect(new EmailService().getDiagnostics()).resolves.toMatchObject({
      status: 'down',
      mode: 'unconfigured',
      smtp: { configured: false },
    });

    setEnv({ NODE_ENV: 'test', BREVO_API_KEY: 'key' });
    await expect(new EmailService().getDiagnostics()).resolves.toMatchObject({
      status: 'ok',
      mode: 'brevo-api',
      brevoApi: { configured: true },
    });
  });

  it('reports verification errors without leaking provider internals', async () => {
    setEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_VERIFY_ON_STARTUP: 'false',
    });
    mockedMailer.createTransport.mockReturnValue(
      smtpTransport({
        verify: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
          ),
      }) as never,
    );

    await expect(new EmailService().getDiagnostics()).resolves.toMatchObject({
      status: 'down',
      mode: 'smtp',
      smtp: { reachable: false, errorCode: 'ECONNREFUSED' },
    });
  });

  it('builds verification and reset messages through the common delivery path', async () => {
    setEnv({
      FRONTEND_BASE_URL: 'https://iprotex.example/',
      DEFAULT_LOCALE: 'fr',
    });
    const service = new EmailService();
    const sendMail = jest
      .spyOn(service, 'sendMail')
      .mockResolvedValue('message-preview');

    await expect(
      service.sendVerificationEmail('user@example.com', 'token + value'),
    ).resolves.toBe('message-preview');
    await expect(
      service.sendPasswordResetEmail(
        'user@example.com',
        'https://iprotex.example/reset?token=abc',
      ),
    ).resolves.toBe('message-preview');

    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subject: 'Verify your email - Iprotex',
        text: 'https://iprotex.example/fr/auth/verify-email?token=token%20%2B%20value',
      }),
    );
    expect(sendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ subject: 'Reset your password - Iprotex' }),
    );
  });
});
