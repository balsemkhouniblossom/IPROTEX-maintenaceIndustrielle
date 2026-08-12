import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getLoginRedirectForAuthFailure,
  getStableAuthFailureCode,
  isConfirmedRefreshAuthFailure,
  isRefreshTokenErrorCode,
} from "../src/services/authErrors.ts";
import {
  clearAuthSession,
  getAuthToken,
  getAuthSessionPersistence,
  getStoredAuthSession,
  saveAuthSession,
  updateStoredTokens,
} from "../src/services/authStorage.ts";
import { getApiBaseUrl } from "../src/config/api-base-url.ts";
import { parseLocalLoginSession } from "../src/services/localLogin.ts";

const safeUser = {
  _id: "user-id",
  nom_complet: "Refresh User",
  email: "refresh@example.test",
  role: "operator",
  is_active: true,
  is_verified: true,
  approval_status: "approved",
  created_at: "2026-01-01T00:00:00.000Z",
};

test("refresh error codes are recognized as terminal session failures", () => {
  for (const code of [
    "REFRESH_TOKEN_MISSING",
    "REFRESH_TOKEN_INVALID",
    "REFRESH_TOKEN_EXPIRED",
    "REFRESH_TOKEN_INVALID_OR_EXPIRED",
    "REFRESH_TOKEN_REVOKED",
    "REFRESH_TOKEN_REUSE_DETECTED",
    "REFRESH_USER_NOT_FOUND",
    "REFRESH_TOKEN_SUBJECT_INVALID",
    "REFRESH_TOKEN_WRONG_TYPE",
  ]) {
    assert.equal(isRefreshTokenErrorCode(code), true, code);
    assert.equal(
      getStableAuthFailureCode({ response: { data: { code } } }),
      code,
    );
  }
});

test("only confirmed refresh authentication failures are session-clearing failures", () => {
  assert.equal(
    isConfirmedRefreshAuthFailure({
      response: { status: 401, data: { code: "REFRESH_TOKEN_EXPIRED" } },
    }),
    true,
  );
  assert.equal(
    isConfirmedRefreshAuthFailure({
      response: { status: 403, data: { code: "ACCOUNT_PENDING_APPROVAL" } },
    }),
    true,
  );
  assert.equal(
    isConfirmedRefreshAuthFailure({
      code: "ERR_NETWORK",
      message: "Network Error",
    }),
    false,
  );
  assert.equal(
    isConfirmedRefreshAuthFailure({ response: { status: 503, data: {} } }),
    false,
  );
  assert.equal(
    isConfirmedRefreshAuthFailure({ response: { status: 408, data: {} } }),
    false,
  );
});

test("account-state refresh failures map to safe login redirect states", () => {
  assert.equal(
    getLoginRedirectForAuthFailure("en", "ACCOUNT_PENDING_APPROVAL"),
    "/en/auth/login?error=pending-approval",
  );
  assert.equal(
    getLoginRedirectForAuthFailure("fr", "ACCOUNT_REJECTED"),
    "/fr/auth/login?error=rejected",
  );
  assert.equal(
    getLoginRedirectForAuthFailure("ar", "ACCOUNT_INACTIVE"),
    "/ar/auth/login?error=inactive",
  );
  assert.equal(
    getLoginRedirectForAuthFailure("de", "EMAIL_NOT_VERIFIED"),
    "/de/auth/login?error=email-not-verified",
  );
});

test("token-specific refresh failures map to safe session redirects without tokens", () => {
  assert.equal(
    getLoginRedirectForAuthFailure("es", "REFRESH_TOKEN_REVOKED"),
    "/es/auth/login?session=revoked",
  );
  assert.equal(
    getLoginRedirectForAuthFailure("it", "REFRESH_TOKEN_INVALID_OR_EXPIRED"),
    "/it/auth/login?session=expired",
  );

  const redirect = getLoginRedirectForAuthFailure(
    "en",
    "REFRESH_TOKEN_SUBJECT_INVALID",
  );
  assert.equal(redirect.includes("refresh-token"), false);
  assert.equal(redirect.includes("access-token"), false);
  assert.equal(redirect.includes("user-id"), false);
});

test("successful refresh response parser keeps new tokens and safe user", () => {
  assert.deepEqual(
    parseLocalLoginSession({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      user: safeUser,
    }),
    {
      authToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: safeUser,
    },
  );
});

test("cookie refresh response parser accepts responses without readable refresh tokens", () => {
  assert.deepEqual(
    parseLocalLoginSession({
      access_token: "new-access-token",
      user: safeUser,
    }),
    {
      authToken: "new-access-token",
      user: safeUser,
    },
  );
});

test("auth storage keeps access tokens in memory and clears legacy browser storage", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  local.setItem("token", "legacy-local-access-token");
  local.setItem("user", JSON.stringify(safeUser));
  local.setItem("refresh_token", "legacy-refresh-token");
  session.setItem("token", "legacy-session-access-token");
  session.setItem("user", JSON.stringify(safeUser));
  session.setItem("refresh_token", "legacy-session-refresh-token");

  saveAuthSession("access-token", "refresh-token", safeUser, true);
  assert.equal(getAuthToken(), "access-token");
  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
  assert.equal(local.getItem("user"), null);
  assert.equal(session.getItem("user"), null);
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);

  local.setItem("refresh_token", "legacy-refresh-token");
  updateStoredTokens("rotated-access-token", "new-refresh-token");
  assert.equal(getAuthToken(), "rotated-access-token");
  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);

  clearAuthSession();
  assert.equal(getAuthToken(), null);
  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);
});

test("remember-me no longer persists access tokens across refresh recovery", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("access-token", undefined, safeUser, true);
  assert.equal(getAuthSessionPersistence(), true);
  saveAuthSession("rotated-access-token", undefined, safeUser, getAuthSessionPersistence());

  assert.equal(getAuthToken(), "rotated-access-token");
  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
});

test("transient refresh failures cannot restore a cached browser access token", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("cached-access-token", undefined, safeUser, true);

  assert.equal(getStoredAuthSession(), null);
  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
});

test("session-only logins do not write access tokens to sessionStorage", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("access-token", undefined, safeUser, false);
  assert.equal(getAuthSessionPersistence(), true);
  saveAuthSession("rotated-access-token", undefined, safeUser, getAuthSessionPersistence());

  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), null);
  assert.equal(getAuthToken(), "rotated-access-token");
});

test("access token is not present in frontend-readable cookies", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    cookie: "csrf_token=csrf-value; NEXT_LOCALE=en",
  } as Document;

  saveAuthSession("access-token", undefined, safeUser, true);

  assert.equal(document.cookie.includes("access-token"), false);
  assert.equal(document.cookie.includes("token=access-token"), false);

  globalThis.document = originalDocument;
});

test("API refresh uses credentials and CSRF instead of readable refresh-token body", () => {
  const apiSource = readFileSync(
    join(process.cwd(), "src", "services", "api.ts"),
    "utf8",
  );
  const coordinatorSource = readFileSync(
    join(process.cwd(), "src", "services", "authRefreshCoordinator.ts"),
    "utf8",
  );

  assert.match(apiSource, /withCredentials:\s*true/);
  assert.match(coordinatorSource, /X-CSRF-Token/);
  assert.match(apiSource, /isConfirmedRefreshAuthFailure\(refreshError\)/);
  assert.match(apiSource, /requestAuthRefresh\(\)/);
  assert.match(coordinatorSource, /let refreshRequest:\s*Promise<LoginSession>\s*\|\s*null\s*=\s*null/);
  assert.match(coordinatorSource, /if\s*\(refreshRequest\)\s*return refreshRequest/);
  assert.match(coordinatorSource, /axios\s*\.\s*post\(\s*`\$\{API_BASE_URL\}\/auth\/refresh`/);
  assert.match(apiSource, /originalRequest\._retry\s*=\s*true/);
  assert.doesNotMatch(apiSource, /getAuthItem\('refresh_token'\)/);
  assert.doesNotMatch(coordinatorSource, /refresh_token:\s*refreshToken/);
});

test("bootstrap and interceptor share the same refresh coordinator", () => {
  const apiSource = readFileSync(
    join(process.cwd(), "src", "services", "api.ts"),
    "utf8",
  );
  const authContextSource = readFileSync(
    join(process.cwd(), "src", "contexts", "AuthContext.tsx"),
    "utf8",
  );

  assert.match(apiSource, /import\s*\{[\s\S]*requestAuthRefresh[\s\S]*\}\s*from\s*['"]\.\/authRefreshCoordinator['"]/);
  assert.match(authContextSource, /import\s*\{[\s\S]*requestAuthRefresh[\s\S]*\}\s*from\s*['"]\.\.\/services\/authRefreshCoordinator['"]/);
  assert.match(authContextSource, /const session = await requestAuthRefresh\(\)/);
  assert.doesNotMatch(authContextSource, /api\.post\(\s*['"]\/auth\/refresh['"]/);
  assert.match(authContextSource, /AUTH_SESSION_REFRESHED_EVENT/);
});

test("refresh coordinator prevents same-tab and cross-tab refresh races", () => {
  const coordinatorSource = readFileSync(
    join(process.cwd(), "src", "services", "authRefreshCoordinator.ts"),
    "utf8",
  );

  assert.match(coordinatorSource, /const REFRESH_CHANNEL_NAME = ['"]gmao-auth-refresh['"]/);
  assert.match(coordinatorSource, /new BroadcastChannel\(REFRESH_CHANNEL_NAME\)/);
  assert.match(coordinatorSource, /const REFRESH_LOCK_KEY = ['"]gmao:auth-refresh-lock['"]/);
  assert.match(coordinatorSource, /if\s*\(!acquireRefreshLock\(\)\)\s*\{\s*return getOrCreateRemoteRefreshRequest\(\)/);
  assert.match(coordinatorSource, /type:\s*['"]refresh-started['"]/);
  assert.match(coordinatorSource, /type:\s*['"]refresh-success['"]/);
  assert.match(coordinatorSource, /type:\s*['"]refresh-failure['"]/);
  assert.match(coordinatorSource, /resolveRemoteRefresh\?\.\(message\.session\)/);
  assert.match(coordinatorSource, /rejectRemoteRefresh\?\.\(message\.error\)/);
});

test("silent refresh can cover a full working day with short access tokens", () => {
  const renderSource = readFileSync(join(process.cwd(), "..", "render.yaml"), "utf8");
  const envExampleSource = readFileSync(join(process.cwd(), "..", ".env.example"), "utf8");
  const controllerSource = readFileSync(
    join(process.cwd(), "..", "backend", "src", "auth", "auth.controller.ts"),
    "utf8",
  );

  assert.match(renderSource, /key:\s*JWT_EXPIRES_IN\s*\r?\n\s*value:\s*15m/);
  assert.match(renderSource, /key:\s*JWT_REFRESH_EXPIRES_IN\s*\r?\n\s*value:\s*1d/);
  assert.match(renderSource, /key:\s*JWT_REFRESH_COOKIE_MAX_AGE_MS\s*\r?\n\s*value:\s*"86400000"/);
  assert.match(envExampleSource, /JWT_EXPIRES_IN=15m/);
  assert.match(envExampleSource, /JWT_REFRESH_EXPIRES_IN=1d/);
  assert.match(envExampleSource, /JWT_REFRESH_COOKIE_MAX_AGE_MS=86400000/);
  assert.match(controllerSource, /process\.env\.JWT_REFRESH_COOKIE_MAX_AGE_MS/);
});

test("production API base URL must be the HTTPS Render backend URL", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const mutableEnv = process.env as Record<string, string | undefined>;

  mutableEnv.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://pfe-maintenaceindustrielle.onrender.com/";
  assert.equal(getApiBaseUrl(), "https://pfe-maintenaceindustrielle.onrender.com");

  process.env.NEXT_PUBLIC_API_BASE_URL = "http://pfe-maintenaceindustrielle.onrender.com";
  assert.throws(() => getApiBaseUrl(), /HTTPS Render API URL/);

  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";
  assert.throws(() => getApiBaseUrl(), /Render backend/);

  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:10000";
  assert.throws(() => getApiBaseUrl(), /HTTPS Render API URL/);

  process.env.NEXT_PUBLIC_API_BASE_URL = "https://other-service.onrender.com";
  assert.throws(
    () => getApiBaseUrl(),
    /pfe-maintenaceindustrielle\.onrender\.com/,
  );

  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }

  if (originalApiBaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  }
});

test("frontend auth requests explicitly use cookie credentials and CSRF where required", () => {
  const apiSource = readFileSync(
    join(process.cwd(), "src", "services", "api.ts"),
    "utf8",
  );
  const authContextSource = readFileSync(
    join(process.cwd(), "src", "contexts", "AuthContext.tsx"),
    "utf8",
  );
  const googleAuthSource = readFileSync(
    join(process.cwd(), "src", "services", "googleAuth.ts"),
    "utf8",
  );
  const authSessionEventsSource = readFileSync(
    join(process.cwd(), "src", "services", "authSessionEvents.ts"),
    "utf8",
  );

  assert.match(apiSource, /axios\.create\(\{[\s\S]*baseURL:\s*API_BASE_URL,[\s\S]*withCredentials:\s*true/);
  assert.equal(apiSource.includes("/\\/auth\\/(refresh|logout)/"), true);
  assert.match(apiSource, /config\.withCredentials\s*=\s*true/);
  assert.match(apiSource, /Object\.entries\(getCsrfHeaders\(\)\)/);
  assert.match(apiSource, /let sessionExpirationRedirectStarted\s*=\s*false/);
  assert.match(apiSource, /function redirectToLoginOnce\(error:\s*unknown\):\s*void/);
  assert.match(apiSource, /if\s*\(sessionExpirationRedirectStarted\)\s*return/);
  assert.match(apiSource, /dispatchSessionExpired\(\)/);

  for (const endpoint of [
    "/auth/login",
    "/auth/register",
    "/auth/logout",
  ]) {
    assert.match(authContextSource, new RegExp(endpoint.replace(/\//g, "\\/")));
  }

  assert.match(authContextSource, /withCredentials:\s*true/g);
  assert.match(authContextSource, /getCsrfHeaders\(\)/g);
  assert.match(authContextSource, /status:\s*AuthStatus/);
  assert.match(authContextSource, /setStatus\('error'\)/);
  assert.doesNotMatch(authContextSource, /clearAuthSession\(\);\s*setStatus\('error'\)/);
  assert.match(googleAuthSource, /\/auth\/google\/exchange/);
  assert.match(googleAuthSource, /withCredentials:\s*true/);
  assert.match(authContextSource, /SESSION_EXPIRED_EVENT/);
  assert.match(authContextSource, /setToken\(null\)/);
  assert.match(authContextSource, /setUser\(null\)/);
  assert.match(authSessionEventsSource, /app:auth-session-expired/);
});

test("unknown refresh errors fail closed to expired-session redirect", () => {
  assert.equal(getStableAuthFailureCode({ response: { data: {} } }), null);
  assert.equal(
    getLoginRedirectForAuthFailure("en", null),
    "/en/auth/login?session=expired",
  );
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}
