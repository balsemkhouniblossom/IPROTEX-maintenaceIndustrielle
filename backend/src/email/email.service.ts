import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: Transporter<SMTPTransport.SentMessageInfo>;
  private fromAddress: string;

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

    this.fromAddress = process.env.EMAIL_FROM || 'Iprotex <noreply@localhost>';

    if (host) {
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

      this.transporter.verify((err) => {
        if (err) {
          this.logger.error('SMTP connection failed', err);
        } else {
          this.logger.log('SMTP server is ready');
        }
      });
    } else {
      this.logger.warn(
        'SMTP_HOST is not configured; development fallback may be used',
      );
    }
  }

  async sendMail(options: SendEmailOptions): Promise<string | undefined> {
    const host = process.env.SMTP_HOST;

    if (!host) {
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

      return nodemailer.getTestMessageUrl(info) || undefined;
    } catch (err) {
      this.logger.error('SMTP SEND FAILED');
      this.logger.error(err);

      throw err;
    }
  }

  async sendVerificationEmail(
    to: string,
    token: string,
  ): Promise<string | undefined> {
    const url = `http://localhost:3001/auth/verify-email?token=${token}`;

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
