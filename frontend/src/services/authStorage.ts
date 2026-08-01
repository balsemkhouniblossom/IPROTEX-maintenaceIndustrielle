const AUTH_KEYS = ['token', 'user'] as const;

export function getAuthItem(key: (typeof AUTH_KEYS)[number]) {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export function getAuthSessionPersistence() {
  if (typeof window === 'undefined') return true;
  if (localStorage.getItem('token') || localStorage.getItem('user')) return true;
  if (sessionStorage.getItem('token') || sessionStorage.getItem('user')) return false;
  return true;
}

export function getStoredAuthSession() {
  if (typeof window === 'undefined') return null;

  const persistent = getAuthSessionPersistence();
  const source = persistent ? localStorage : sessionStorage;
  const token = source.getItem('token');
  const rawUser = source.getItem('user');

  if (!token || !rawUser) return null;

  try {
    return {
      token,
      user: JSON.parse(rawUser) as unknown,
      persistent,
    };
  } catch {
    return null;
  }
}

export function saveAuthSession(
  token: string,
  _refreshToken: string | undefined,
  user: unknown,
  persistent: boolean,
) {
  void _refreshToken;
  const target = persistent ? localStorage : sessionStorage;
  const other = persistent ? sessionStorage : localStorage;

  AUTH_KEYS.forEach((key) => other.removeItem(key));
  other.removeItem('refresh_token');
  target.removeItem('refresh_token');
  target.setItem('token', token);
  target.setItem('user', JSON.stringify(user));
}

export function updateStoredTokens(token: string, _refreshToken?: string) {
  void _refreshToken;
  const target = localStorage.getItem('user') ? localStorage : sessionStorage;
  target.setItem('token', token);
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('refresh_token');
}

export function updateStoredUser(user: unknown) {
  if (typeof window === 'undefined') return;
  const target = localStorage.getItem('user') ? localStorage : sessionStorage;
  target.setItem('user', JSON.stringify(user));
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  AUTH_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('refresh_token');
}
