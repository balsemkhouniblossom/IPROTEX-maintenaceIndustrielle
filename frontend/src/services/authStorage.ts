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
  _refreshToken: string | undefined,
  user: unknown,
  _persistent: boolean,
) {
  void _refreshToken;
  void user;
  void _persistent;
  setAuthToken(token);
  clearLegacyBrowserAuthStorage();
}

export function updateStoredTokens(token: string, _refreshToken?: string) {
  void _refreshToken;
  setAuthToken(token);
  clearLegacyBrowserAuthStorage();
}

export function updateStoredUser(user: unknown) {
  void user;
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
