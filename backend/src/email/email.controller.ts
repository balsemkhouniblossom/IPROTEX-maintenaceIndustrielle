import {
  BadGatewayException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthThrottleService } from '../auth/auth-throttle.service';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { EmailService } from './email.service';

@Controller('email')
@AdminOnly()
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly authThrottleService: AuthThrottleService,
  ) {}

  @Get('test')
  async test(@Req() req: AuthenticatedRequest) {
    if (!this.isDiagnosticEnabled()) {
      throw new NotFoundException('Email diagnostic endpoint is unavailable');
    }

    await this.authThrottleService.consume('email-diagnostic', req as Request, {
      email: req.user?.email,
    });

    this.recordAuditEvent(req, 'attempted');

    try {
      await this.emailService.sendMail({
        to: this.getDiagnosticRecipient(),
        subject: 'Iprotex email diagnostic',
        text: 'This is a restricted Iprotex email delivery diagnostic.',
        html: '<p>This is a restricted Iprotex email delivery diagnostic.</p>',
      });
      this.authThrottleService.recordSuccess(
        'email-diagnostic',
        req as Request,
        {
          email: req.user?.email,
        },
      );
      this.recordAuditEvent(req, 'sent');

      return {
        status: 'sent',
        diagnostic: 'email',
        requestedBy: req.user?.userId ?? 'unknown',
        timestamp: new Date().toISOString(),
      };
    } catch {
      this.authThrottleService.recordFailure(
        'email-diagnostic',
        req as Request,
        {
          email: req.user?.email,
        },
      );
      this.recordAuditEvent(req, 'failed');
      throw new BadGatewayException({
        code: 'EMAIL_DIAGNOSTIC_FAILED',
        message: 'Email diagnostic failed. Check backend provider logs.',
      });
    }
  }

  private isDiagnosticEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('ENABLE_EMAIL_DIAGNOSTIC_TEST'),
      false,
    );
  }

  private getDiagnosticRecipient(): string {
    const configuredRecipient =
      this.configService.get<string>('EMAIL_DIAGNOSTIC_RECIPIENT')?.trim() ||
      this.extractEmailAddress(
        this.configService.get<string>('EMAIL_FROM')?.trim() ?? '',
      );

    return configuredRecipient || 'noreply@localhost';
  }

  private extractEmailAddress(value: string): string {
    const start = value.indexOf('<');
    const end = value.indexOf('>', start + 1);

    if (start !== -1 && end !== -1) {
      return value.slice(start + 1, end).trim();
    }

    return value.trim();
  }

  private recordAuditEvent(
    req: AuthenticatedRequest,
    outcome: 'attempted' | 'sent' | 'failed',
  ): void {
    this.logger.log({
      event: 'admin_email_diagnostic',
      outcome,
      actorUserId: req.user?.userId ?? 'unknown',
      actorRole: req.user?.role ?? 'unknown',
      method: req.method,
      path: req.path || req.originalUrl?.split('?')[0] || '/email/test',
      timestamp: new Date().toISOString(),
    });
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return fallback;
}
