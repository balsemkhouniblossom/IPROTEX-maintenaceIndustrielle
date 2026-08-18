export interface VerificationEmailIntent {
  to: string;
  token: string;
  locale?: string;
  frontendOrigin?: string;
}

export interface ResetPasswordEmailIntent {
  to: string;
  resetToken: string;
  locale?: string;
  frontendOrigin?: string;
}
