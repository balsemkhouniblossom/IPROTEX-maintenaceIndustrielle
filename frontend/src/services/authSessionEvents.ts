export const SESSION_EXPIRED_EVENT = 'app:auth-session-expired';

export function dispatchSessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}
