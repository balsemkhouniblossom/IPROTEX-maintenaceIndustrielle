import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDiagnostics {
  status: 'ok' | 'degraded' | 'down';
  service: 'email';
  mode: 'smtp' | 'brevo-api' | 'development-fallback' | 'unconfigured';
  smtp: {
    configured: boolean;
    reachable?: boolean;
    errorCode?: string;
  };
  brevoApi: {
    configured: boolean;
  };
  timestamp: string;
}

type EmailDeliveryMode = 'auto' | 'smtp' | 'brevo-api';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: Transporter<SMTPTransport.SentMessageInfo>;
  private fromAddress: string;
  private readonly brevoApiKey: string;
  private readonly brevoApiUrl: string;
  private readonly brevoApiTimeoutMs: number;
  private readonly smtpFallbackCooldownMs: number;
  private readonly smtpVerifyOnStartup: boolean;
  private readonly deliveryMode: EmailDeliveryMode;
  private smtpBypassUntil = 0;
  private lastSmtpErrorCode?: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secureSetting = process.env.SMTP_SECURE;
    const secure = secureSetting
      ? secureSetting.toLowerCase() === 'true'
      : port === 465;

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const connectionTimeout = Number(
      process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 10000,
    );
    const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT_MS ?? 10000);
    const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT_MS ?? 15000);

    this.brevoApiKey = process.env.BREVO_API_KEY?.trim() ?? '';
    this.brevoApiUrl =
      process.env.BREVO_API_URL?.trim() ||
      'https://api.brevo.com/v3/smtp/email';
    this.brevoApiTimeoutMs = Number(process.env.BREVO_API_TIMEOUT_MS ?? 10000);
    this.smtpFallbackCooldownMs = Number(
      process.env.SMTP_FALLBACK_COOLDOWN_MS ?? 300000,
    );
    this.deliveryMode = this.parseDeliveryMode(
      process.env.EMAIL_DELIVERY_MODE,
    );
    this.smtpVerifyOnStartup = this.parseBoolean(
      process.env.SMTP_VERIFY_ON_STARTUP,
      process.env.NODE_ENV !== 'production',
    );

    this.fromAddress = process.env.EMAIL_FROM || 'Iprotex <noreply@localhost>';

    if (host && this.deliveryMode !== 'brevo-api') {
      const smtpConfig: SMTPTransport.Options = {
        host,
        port,
        secure,
        connectionTimeout,
        greetingTimeout,
        socketTimeout,
        auth:
          user && pass
            ? {
                user,
                pass,
              }
            : undefined,
      };

      this.transporter = nodemailer.createTransport(smtpConfig);

      if (this.smtpVerifyOnStartup) {
        this.transporter.verify((err) => {
          if (err) {
            this.markSmtpFailure(err);
            this.logger.warn('SMTP connection check failed at startup', err);
          } else {
            this.smtpBypassUntil = 0;
            this.lastSmtpErrorCode = undefined;
            this.logger.log('SMTP server is ready');
          }
        });
      } else if (this.brevoApiKey) {
        this.logger.log(
          'Skipping SMTP startup verification; Brevo API fallback is enabled',
        );
      }
    } else if (host && this.deliveryMode === 'brevo-api') {
      this.logger.log(
        'EMAIL_DELIVERY_MODE=brevo-api; skipping SMTP transport initialization',
      );
    } else {
      this.logger.warn(
        'SMTP_HOST is not configured; development fallback may be used',
      );

      if (this.brevoApiKey) {
        this.logger.log('Brevo API fallback is enabled');
      }
    }
  }

  async sendMail(options: SendEmailOptions): Promise<string | undefined> {
    const host = process.env.SMTP_HOST;

    if (this.deliveryMode === 'brevo-api') {
      if (!this.brevoApiKey) {
        throw new Error(
          'EMAIL_DELIVERY_MODE=brevo-api requires BREVO_API_KEY to be configured',
        );
      }

      return this.sendViaBrevoApi(options);
    }

    if (!host) {
      if (this.brevoApiKey) {
        return this.sendViaBrevoApi(options);
      }

      const nodeEnv = process.env.NODE_ENV;

      if (nodeEnv === 'production') {
        throw new Error('SMTP provider is not configured');
      }

      try {
        this.logger.warn('Using Ethereal for development');

        const etherealAccount = await nodemailer.createTestAccount();

        const etherealTransporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: etherealAccount.user,
            pass: etherealAccount.pass,
          },
        });

        const info = await etherealTransporter.sendMail({
          from: '"Iprotex" <khounibalsem@gmail.com>',
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);

        this.logger.log(`Email sent to ${options.to}`);

        return previewUrl || undefined;
      } catch (error) {
        this.logger.error('SMTP SEND FAILED', error);
        throw error;
      }
    }

    if (!this.transporter) {
      throw new Error('SMTP transport is not initialized');
    }

    if (this.shouldBypassSmtp()) {
      this.logger.warn(
        'Skipping SMTP attempt during cooldown; using Brevo API fallback',
      );
      return this.sendViaBrevoApi(options);
    }

    this.logger.log('========== SMTP SEND ==========');
    this.logger.log(`FROM: ${this.fromAddress}`);
    this.logger.log(`TO: ${options.to}`);
    this.logger.log(`SUBJECT: ${options.subject}`);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      this.logger.log('SMTP RESPONSE:');
      this.logger.log(JSON.stringify(info, null, 2));

      this.smtpBypassUntil = 0;
      this.lastSmtpErrorCode = undefined;

      return nodemailer.getTestMessageUrl(info) || undefined;
    } catch (err) {
      this.markSmtpFailure(err);
      this.logger.error('SMTP SEND FAILED');
      this.logger.error(err);

      if (this.brevoApiKey) {
        this.logger.warn('Falling back to Brevo API delivery path');
        return this.sendViaBrevoApi(options);
      }

      throw err;
    }
  }

  async getDiagnostics(): Promise<EmailDiagnostics> {
    const smtpConfigured = Boolean(process.env.SMTP_HOST?.trim());
    const brevoConfigured = Boolean(this.brevoApiKey);

    if (!smtpConfigured && !brevoConfigured) {
      return {
        status: 'down',
        service: 'email',
        mode:
          process.env.NODE_ENV === 'production'
            ? 'unconfigured'
            : 'development-fallback',
        smtp: {
          configured: false,
        },
        brevoApi: {
          configured: false,
        },
        timestamp: new Date().toISOString(),
      };
    }

    if (!smtpConfigured && brevoConfigured) {
      return {
        status: 'ok',
        service: 'email',
        mode: 'brevo-api',
        smtp: {
          configured: false,
        },
        brevoApi: {
          configured: true,
        },
        timestamp: new Date().toISOString(),
      };
    }

    if (!this.transporter) {
      return {
        status: brevoConfigured ? 'degraded' : 'down',
        service: 'email',
        mode: brevoConfigured ? 'brevo-api' : 'smtp',
        smtp: {
          configured: true,
          reachable: false,
          errorCode: 'TRANSPORT_NOT_INITIALIZED',
        },
        brevoApi: {
          configured: brevoConfigured,
        },
        timestamp: new Date().toISOString(),
      };
    }

    if (this.shouldBypassSmtp()) {
      return {
        status: brevoConfigured ? 'degraded' : 'down',
        service: 'email',
        mode: brevoConfigured ? 'brevo-api' : 'smtp',
        smtp: {
          configured: true,
          reachable: false,
          errorCode: this.lastSmtpErrorCode ?? 'SMTP_BYPASSED_DURING_COOLDOWN',
        },
        brevoApi: {
          configured: brevoConfigured,
        },
        timestamp: new Date().toISOString(),
      };
    }

    const verifyResult = await this.verifySmtpConnectivity();

    return {
      status: verifyResult.reachable
        ? 'ok'
        : brevoConfigured
          ? 'degraded'
          : 'down',
      service: 'email',
      mode: verifyResult.reachable ? 'smtp' : brevoConfigured ? 'brevo-api' : 'smtp',
      smtp: {
        configured: true,
        reachable: verifyResult.reachable,
        ...(verifyResult.errorCode
          ? {
              errorCode: verifyResult.errorCode,
            }
          : {}),
      },
      brevoApi: {
        configured: brevoConfigured,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async verifySmtpConnectivity(): Promise<{
    reachable: boolean;
    errorCode?: string;
  }> {
    if (!this.transporter) {
      return {
        reachable: false,
        errorCode: 'TRANSPORT_NOT_INITIALIZED',
      };
    }

    try {
      await this.transporter.verify();
      return {
        reachable: true,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : String(error);
      this.logger.warn(`SMTP diagnostics verify failed: ${message}`);

      let errorCode = 'VERIFY_FAILED';
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const rawCode = (error as { code?: unknown }).code;
        if (typeof rawCode === 'string' && rawCode.trim()) {
          errorCode = rawCode;
        }
      }

      return {
        reachable: false,
        errorCode,
      };
    }
  }

  private shouldBypassSmtp(): boolean {
    return Boolean(this.brevoApiKey) && Date.now() < this.smtpBypassUntil;
  }

  private markSmtpFailure(error: unknown): void {
    const errorCode = this.extractErrorCode(error);
    this.lastSmtpErrorCode = errorCode;

    if (!this.brevoApiKey) {
      return;
    }

    const networkFailureCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ESOCKET',
    ]);

    if (networkFailureCodes.has(errorCode)) {
      this.smtpBypassUntil = Date.now() + this.smtpFallbackCooldownMs;
      this.logger.warn(
        `SMTP marked unhealthy (${errorCode}); bypassing SMTP for ${this.smtpFallbackCooldownMs}ms`,
      );
    }
  }

  private extractErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const rawCode = (error as { code?: unknown }).code;
      if (typeof rawCode === 'string' && rawCode.trim()) {
        return rawCode;
      }
    }

    return 'UNKNOWN_SMTP_ERROR';
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  private parseDeliveryMode(
    value: string | undefined,
  ): EmailDeliveryMode {
    const normalized = value?.trim().toLowerCase();
    if (
      normalized === 'auto' ||
      normalized === 'smtp' ||
      normalized === 'brevo-api'
    ) {
      return normalized;
    }

    return 'auto';
  }

  private async sendViaBrevoApi(
    options: SendEmailOptions,
  ): Promise<string | undefined> {
    const fromEmailMatch = this.fromAddress.match(/<([^>]+)>/);
    const fromEmail = fromEmailMatch ? fromEmailMatch[1] : this.fromAddress;
    const fromName = this.fromAddress.replace(/<[^>]+>/, '').trim() || 'Iprotex';

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.brevoApiTimeoutMs);

    try {
      const response = await fetch(this.brevoApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.brevoApiKey,
          'x-api-key': this.brevoApiKey,
          Authorization: `Bearer ${this.brevoApiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: fromName,
            email: fromEmail,
          },
          to: [{ email: options.to }],
          subject: options.subject,
          textContent: options.text,
          htmlContent: options.html,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        if (
          response.status === 401 &&
          /authorised_ips|authorized_ips|unrecognised ip address/i.test(
            responseText,
          )
        ) {
          this.logger.error(
            'Brevo API rejected the request because Render egress IP is not authorized in Brevo security settings',
          );
        }
        throw new Error(
          `Brevo API send failed (${response.status}): ${responseText}`,
        );
      }

      this.logger.log(`Brevo API email sent to ${options.to}`);
      return undefined;
    } catch (error) {
      this.logger.error('BREVO API SEND FAILED', error as Error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendVerificationEmail(
    to: string,
    token: string,
  ): Promise<string | undefined> {
    const verificationBaseUrl =
      process.env.APP_URL?.trim() ||
      process.env.FRONTEND_BASE_URL?.trim() ||
      process.env.BACKEND_URL?.trim() ||
      'http://localhost:3001';
    const normalizedVerificationBaseUrl = verificationBaseUrl.replace(/\/$/, '');
    const url = `${normalizedVerificationBaseUrl}/auth/verify-email?token=${token}`;

    this.logger.log(`========== VERIFICATION EMAIL ==========`);

    const html = `
  <div style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background:#2563EB;padding:20px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:20px;">Iprotex</h1>
        <p style="margin:5px 0 0;font-size:12px;opacity:0.9;">Industrial Maintenance Platform</p>
      </div>

      <!-- Body -->
      <div style="padding:30px;text-align:center;color:#111827;">

        <h2 style="margin-bottom:10px;font-size:22px;">Verify your email address</h2>

        <p style="font-size:14px;color:#6b7280;line-height:1.5;">
          Thank you for registering. Please verify your email to activate your account.
        </p>

        <a href="${url}"
          style="
            display:inline-block;
            margin-top:20px;
            padding:12px 24px;
            background:#2563EB;
            color:#ffffff;
            text-decoration:none;
            border-radius:8px;
            font-weight:bold;
            font-size:14px;
          ">
          Verify Email
        </a>

        <p style="margin-top:25px;font-size:12px;color:#9ca3af;">
          If the button doesn't work, copy and paste this link:
        </p>

        <p style="font-size:12px;word-break:break-all;color:#2563EB;">
          ${url}
        </p>

        <p style="margin-top:20px;font-size:12px;color:#ef4444;">
          This link will expire soon. If you didn’t request this, ignore this email.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#f3f4f6;text-align:center;padding:15px;font-size:12px;color:#6b7280;">
        © ${new Date().getFullYear()} Iprotex. All rights reserved.
      </div>

    </div>
  </div>
  `;

    const result = await this.sendMail({
      to,
      subject: 'Verify your email - Iprotex',
      text: url,
      html,
    });

    this.logger.log(`Verification email sent`);

    return result;
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
  ): Promise<string | undefined> {
    const html = `
  <div style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.08);">

      <div style="background:#1D4ED8;padding:20px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:20px;">Iprotex</h1>
        <p style="margin:5px 0 0;font-size:12px;opacity:0.9;">Password Reset Request</p>
      </div>

      <div style="padding:30px;color:#111827;">
        <h2 style="margin:0 0 14px;font-size:22px;text-align:center;">Reset your password</h2>

        <p style="font-size:14px;color:#4b5563;line-height:1.5;">
          We received a request to reset your account password. Click the button below to continue.
        </p>

        <p style="text-align:center;">
          <a href="${resetLink}"
            style="
              display:inline-block;
              margin-top:14px;
              padding:12px 24px;
              background:#1D4ED8;
              color:#ffffff;
              text-decoration:none;
              border-radius:8px;
              font-weight:700;
              font-size:14px;
            ">
            Reset Password
          </a>
        </p>

        <p style="margin-top:18px;font-size:12px;color:#6b7280;">
          If the button does not work, copy and paste this URL in your browser:
        </p>

        <p style="font-size:12px;word-break:break-all;color:#1D4ED8;">
          ${resetLink}
        </p>

        <p style="margin-top:18px;font-size:12px;color:#dc2626;">
          For your security, this link expires in 1 hour and can only be used once.
        </p>

        <p style="margin-top:8px;font-size:12px;color:#6b7280;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>

      <div style="background:#f3f4f6;text-align:center;padding:15px;font-size:12px;color:#6b7280;">
        © ${new Date().getFullYear()} Iprotex. All rights reserved.
      </div>

    </div>
  </div>
  `;

    const result = await this.sendMail({
      to,
      subject: 'Reset your password - Iprotex',
      text: `Reset your password using this link: ${resetLink}`,
      html,
    });

    this.logger.log(`Password reset email sent`);

    return result;
  }
}
