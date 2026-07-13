const AUTH_KEYS = ['token', 'refresh_token', 'user'] as const;

export function getAuthItem(key: (typeof AUTH_KEYS)[number]) {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export function saveAuthSession(
  token: string,
  refreshToken: string | undefined,
  user: unknown,
  persistent: boolean,
) {
  const target = persistent ? localStorage : sessionStorage;
  const other = persistent ? sessionStorage : localStorage;

  AUTH_KEYS.forEach((key) => other.removeItem(key));
  target.setItem('token', token);
  target.setItem('user', JSON.stringify(user));
  if (refreshToken) target.setItem('refresh_token', refreshToken);
  else target.removeItem('refresh_token');
}

export function updateStoredTokens(token: string, refreshToken?: string) {
  const target = localStorage.getItem('refresh_token') ? localStorage : sessionStorage;
  target.setItem('token', token);
  if (refreshToken) target.setItem('refresh_token', refreshToken);
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  AUTH_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}
