import axios from 'axios';
import { getApiBaseUrl } from '@/config/api-base-url';
import { parseLocalLoginSession, type LoginSession } from './localLogin';
import { updateStoredTokens, updateStoredUser } from './authStorage';

const API_BASE_URL = getApiBaseUrl();
const REFRESH_CHANNEL_NAME = 'gmao-auth-refresh';
const REFRESH_LOCK_KEY = 'gmao:auth-refresh-lock';
const REFRESH_LOCK_TTL_MS = 20000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

type RefreshMessage =
  | { type: 'refresh-started'; ownerId: string }
  | { type: 'refresh-success'; ownerId: string; session: LoginSession }
  | { type: 'refresh-failure'; ownerId: string; error: SerializedRefreshError };

type SerializedRefreshError = {
  response?: { status?: number; data?: unknown };
  code?: string;
  message?: string;
};

type RefreshLock = {
  ownerId: string;
  expiresAt: number;
};

let refreshRequest: Promise<LoginSession> | null = null;
let remoteRefreshRequest: Promise<LoginSession> | null = null;
let resolveRemoteRefresh: ((session: LoginSession) => void) | null = null;
let rejectRemoteRefresh: ((error: unknown) => void) | null = null;
let remoteRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let broadcastChannel: BroadcastChannel | null | undefined;

const tabId = createTabId();

export const AUTH_SESSION_REFRESHED_EVENT = 'app:auth-session-refreshed';

export async function requestAuthRefresh(): Promise<LoginSession> {
  getBroadcastChannel();

  if (refreshRequest) return refreshRequest;
  if (remoteRefreshRequest) return remoteRefreshRequest;

  if (!acquireRefreshLock()) {
    return getOrCreateRemoteRefreshRequest();
  }

  postRefreshMessage({ type: 'refresh-started', ownerId: tabId });

  refreshRequest = axios
    .post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      {
        withCredentials: true,
        headers: getCsrfHeaders(),
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      },
    )
    .then((response) => {
      const session = parseLocalLoginSession(response.data);
      applyRefreshSession(session);
      postRefreshMessage({ type: 'refresh-success', ownerId: tabId, session });
      return session;
    })
    .catch((error) => {
      postRefreshMessage({
        type: 'refresh-failure',
        ownerId: tabId,
        error: serializeRefreshError(error),
      });
      throw error;
    })
    .finally(() => {
      releaseRefreshLock();
      refreshRequest = null;
    });

  return refreshRequest;
}

export function getCsrfHeaders(): Record<string, string> {
  const csrfToken = getCookieValue('csrf_token');
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
}

export function resetAuthRefreshCoordinator(): void {
  refreshRequest = null;
  clearRemoteRefreshRequest();
  releaseRefreshLock();
}

function getOrCreateRemoteRefreshRequest(): Promise<LoginSession> {
  getBroadcastChannel();

  if (remoteRefreshRequest) return remoteRefreshRequest;

  remoteRefreshRequest = new Promise((resolve, reject) => {
    resolveRemoteRefresh = resolve;
    rejectRemoteRefresh = reject;
    remoteRefreshTimeout = setTimeout(() => {
      clearRemoteRefreshRequest();
      reject(new Error('AUTH_REFRESH_COORDINATION_TIMEOUT'));
    }, REFRESH_LOCK_TTL_MS);
  });

  return remoteRefreshRequest;
}

function handleRefreshMessage(message: RefreshMessage): void {
  if (message.ownerId === tabId) return;

  if (message.type === 'refresh-started') {
    void getOrCreateRemoteRefreshRequest();
    return;
  }

  if (message.type === 'refresh-success') {
    applyRefreshSession(message.session);
    resolveRemoteRefresh?.(message.session);
    clearRemoteRefreshRequest();
    return;
  }

  rejectRemoteRefresh?.(message.error);
  clearRemoteRefreshRequest();
}

function applyRefreshSession(session: LoginSession): void {
  updateStoredTokens(session.authToken);
  updateStoredUser(session.user);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_SESSION_REFRESHED_EVENT, { detail: session }),
    );
  }
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (broadcastChannel === undefined) {
    broadcastChannel = new BroadcastChannel(REFRESH_CHANNEL_NAME);
    broadcastChannel.onmessage = (event: MessageEvent<RefreshMessage>) => {
      handleRefreshMessage(event.data);
    };
  }

  return broadcastChannel;
}

function postRefreshMessage(message: RefreshMessage): void {
  getBroadcastChannel()?.postMessage(message);
}

function acquireRefreshLock(): boolean {
  if (typeof window === 'undefined') return true;

  const now = Date.now();
  const current = readRefreshLock();
  if (current && current.expiresAt > now && current.ownerId !== tabId) {
    return false;
  }

  const nextLock: RefreshLock = {
    ownerId: tabId,
    expiresAt: now + REFRESH_LOCK_TTL_MS,
  };
  localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(nextLock));

  return readRefreshLock()?.ownerId === tabId;
}

function releaseRefreshLock(): void {
  if (typeof window === 'undefined') return;
  if (readRefreshLock()?.ownerId === tabId) {
    localStorage.removeItem(REFRESH_LOCK_KEY);
  }
}

function readRefreshLock(): RefreshLock | null {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RefreshLock;
    return typeof parsed.ownerId === 'string' &&
      typeof parsed.expiresAt === 'number'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function clearRemoteRefreshRequest(): void {
  if (remoteRefreshTimeout) {
    clearTimeout(remoteRefreshTimeout);
  }
  remoteRefreshRequest = null;
  resolveRemoteRefresh = null;
  rejectRemoteRefresh = null;
  remoteRefreshTimeout = null;
}

function serializeRefreshError(error: unknown): SerializedRefreshError {
  const value = error as SerializedRefreshError;
  return {
    response: value.response
      ? {
          status: value.response.status,
          data: value.response.data,
        }
      : undefined,
    code: value.code,
    message: value.message,
  };
}

function getCookieValue(key: string): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`));
  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : null;
}

function createTabId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
