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

test("auth storage never stores frontend-readable refresh tokens", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("access-token", "refresh-token", safeUser, true);
  assert.equal(local.getItem("token"), "access-token");
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);

  local.setItem("refresh_token", "legacy-refresh-token");
  updateStoredTokens("rotated-access-token", "new-refresh-token");
  assert.equal(local.getItem("token"), "rotated-access-token");
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);

  clearAuthSession();
  assert.equal(local.getItem("refresh_token"), null);
  assert.equal(session.getItem("refresh_token"), null);
});

test("remember-me sessions stay persistent across refresh recovery", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("access-token", undefined, safeUser, true);
  assert.equal(getAuthSessionPersistence(), true);
  saveAuthSession("rotated-access-token", undefined, safeUser, getAuthSessionPersistence());

  assert.equal(local.getItem("token"), "rotated-access-token");
  assert.equal(session.getItem("token"), null);
});

test("transient refresh failures can restore the cached session without clearing it", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("cached-access-token", undefined, safeUser, true);

  assert.deepEqual(getStoredAuthSession(), {
    token: "cached-access-token",
    user: safeUser,
    persistent: true,
  });
});

test("session-only logins stay in sessionStorage across refresh recovery", () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = {} as typeof window;
  globalThis.localStorage = local as unknown as Storage;
  globalThis.sessionStorage = session as unknown as Storage;

  saveAuthSession("access-token", undefined, safeUser, false);
  assert.equal(getAuthSessionPersistence(), false);
  saveAuthSession("rotated-access-token", undefined, safeUser, getAuthSessionPersistence());

  assert.equal(local.getItem("token"), null);
  assert.equal(session.getItem("token"), "rotated-access-token");
});

test("API refresh uses credentials and CSRF instead of readable refresh-token body", () => {
  const apiSource = readFileSync(
    join(process.cwd(), "src", "services", "api.ts"),
    "utf8",
  );

  assert.match(apiSource, /withCredentials:\s*true/);
  assert.match(apiSource, /X-CSRF-Token/);
  assert.match(apiSource, /isConfirmedRefreshAuthFailure\(refreshError\)/);
  assert.doesNotMatch(apiSource, /getAuthItem\('refresh_token'\)/);
  assert.doesNotMatch(apiSource, /refresh_token:\s*refreshToken/);
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

  assert.match(apiSource, /axios\.create\(\{[\s\S]*baseURL:\s*API_BASE_URL,[\s\S]*withCredentials:\s*true/);
  assert.equal(apiSource.includes("/\\/auth\\/(refresh|logout)/"), true);
  assert.match(apiSource, /config\.withCredentials\s*=\s*true/);
  assert.match(apiSource, /headers:\s*getCsrfHeaders\(\)/);

  for (const endpoint of [
    "/auth/refresh",
    "/auth/login",
    "/auth/register",
    "/auth/logout",
  ]) {
    assert.match(authContextSource, new RegExp(endpoint.replace(/\//g, "\\/")));
  }

  assert.match(authContextSource, /withCredentials:\s*true/g);
  assert.match(authContextSource, /getCsrfHeaders\(\)/g);
  assert.match(googleAuthSource, /\/auth\/google\/exchange/);
  assert.match(googleAuthSource, /withCredentials:\s*true/);
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
