import { Injectable } from '@nestjs/common';

@Injectable()
export class TemplateRendererService {
  renderVerificationEmail(url: string): {
    subject: string;
    text: string;
    html: string;
  } {
    const subject = 'Verify your email - Iprotex';
    const text = `Verify your email using this link: ${url}`;
    const html = `<p>Please verify your email address:</p><p><a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`;

    return { subject, text, html };
  }

  renderResetPasswordEmail(url: string): {
    subject: string;
    text: string;
    html: string;
  } {
    const subject = 'Reset your password - Iprotex';
    const text = `Reset your password using this link: ${url}`;
    const html = `<p>You requested a password reset.</p><p><a href="${url}">${url}</a></p><p>This link expires in 1 hour.</p>`;

    return { subject, text, html };
  }
}
