import { Injectable } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';
import { RequestContextService } from '../common/request-context.service';
import {
  ResetPasswordEmailIntent,
  VerificationEmailIntent,
} from './notifications.types';
import { NotificationsListener } from './notifications.listener';
import { TemplateRendererService } from './template-renderer.service';
import { UrlBuilderService } from './url-builder.service';

@Injectable()
export class NotificationsFacade {
  private static readonly VERIFICATION_EVENT_KEY =
    'notifications:flag:event:verification';
  private static readonly RESET_EVENT_KEY = 'notifications:flag:event:reset';

  constructor(
    private readonly featureFlags: FeatureFlagsConfigService,
    private readonly requestContext: RequestContextService,
    private readonly listener: NotificationsListener,
    private readonly emailService: EmailService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  async sendVerificationEmail(
    intent: VerificationEmailIntent,
  ): Promise<string | undefined> {
    if (
      this.shouldUseEventBasedPath(NotificationsFacade.VERIFICATION_EVENT_KEY)
    ) {
      return this.listener.onVerificationEmailIntent(intent);
    }

    return this.sendVerificationViaLegacyPath(intent);
  }

  async sendResetPasswordEmail(
    intent: ResetPasswordEmailIntent,
  ): Promise<string | undefined> {
    if (this.shouldUseEventBasedPath(NotificationsFacade.RESET_EVENT_KEY)) {
      return this.listener.onResetPasswordEmailIntent(intent);
    }

    return this.sendResetViaLegacyPath(intent);
  }

  private shouldUseEventBasedPath(cacheKey: string): boolean {
    return this.requestContext.getOrSet<boolean>(cacheKey, () => {
      return this.featureFlags.isEventBasedEmailsEnabled();
    });
  }

  private async sendVerificationViaLegacyPath(
    intent: VerificationEmailIntent,
  ): Promise<string | undefined> {
    const url = this.urlBuilder.verificationEmailUrl(
      intent.token,
      intent.locale,
      intent.frontendOrigin,
    );
    const rendered = this.templateRenderer.renderVerificationEmail(url);

    return this.emailService.sendMail({
      to: intent.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  private async sendResetViaLegacyPath(
    intent: ResetPasswordEmailIntent,
  ): Promise<string | undefined> {
    const url = this.urlBuilder.resetPasswordUrl(
      intent.resetToken,
      intent.locale,
      intent.frontendOrigin,
    );
    const rendered = this.templateRenderer.renderResetPasswordEmail(url);

    return this.emailService.sendMail({
      to: intent.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
}
