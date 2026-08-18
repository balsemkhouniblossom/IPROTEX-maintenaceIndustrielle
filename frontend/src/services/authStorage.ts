const LEGACY_AUTH_KEYS = ['token', 'user', 'refresh_token'] as const;

let memoryAccessToken: string | null = null;

export function getAuthToken(): string | null {
  return memoryAccessToken;
}

export function setAuthToken(token: string | null): void {
  memoryAccessToken = token;
}

export function getAuthSessionPersistence() {
  clearLegacyBrowserAuthStorage();
  return true;
}

export function getStoredAuthSession() {
  clearLegacyBrowserAuthStorage();
  return null;
}

export function saveAuthSession(
  token: string,
  refreshToken: string | undefined,
  user: unknown,
  persistent: boolean,
): void;
export function saveAuthSession(
  token: string,
  refreshToken?: string,
  user?: unknown,
  persistent?: boolean,
) {
  if (refreshToken || user || persistent) {
    clearLegacyBrowserAuthStorage();
  }
  setAuthToken(token);
  clearLegacyBrowserAuthStorage();
}

export function updateStoredTokens(token: string, refreshToken?: string): void;
export function updateStoredTokens(
  token: string,
  refreshToken?: string,
) {
  if (refreshToken) {
    clearLegacyBrowserAuthStorage();
  }
  setAuthToken(token);
  clearLegacyBrowserAuthStorage();
}

export function updateStoredUser(user: unknown): void;
export function updateStoredUser(user?: unknown) {
  if (user) {
    clearLegacyBrowserAuthStorage();
  }
  clearLegacyBrowserAuthStorage();
}

export function clearAuthSession() {
  setAuthToken(null);
  clearLegacyBrowserAuthStorage();
}

export function clearLegacyBrowserAuthStorage() {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_AUTH_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}
