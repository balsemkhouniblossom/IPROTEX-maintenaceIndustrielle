import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAuthErrorCode,
  getLoginErrorMessageKey,
} from "../src/services/authErrors.ts";
import { getDashboardPath } from "../src/services/authRedirect.ts";
import { parseLocalLoginSession } from "../src/services/localLogin.ts";

const user = {
  _id: "user-id",
  user_id: "USER-001",
  nom_complet: "Test User",
  email: "user@example.com",
  role: "operator",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

test("local login errors are parsed from stable backend codes", () => {
  assert.equal(
    getAuthErrorCode({
      response: { data: { code: "ACCOUNT_PENDING_APPROVAL" } },
    }),
    "ACCOUNT_PENDING_APPROVAL",
  );
  assert.equal(
    getAuthErrorCode({
      response: {
        data: {
          message: {
            code: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email first",
          },
        },
      },
    }),
    "EMAIL_NOT_VERIFIED",
  );
});

test("local login parser does not infer codes from English messages", () => {
  assert.equal(
    getAuthErrorCode({
      response: {
        status: 403,
        data: { message: "Please verify your email first" },
      },
    }),
    null,
  );
});

test("login error codes map to auth translation keys", () => {
  assert.equal(
    getLoginErrorMessageKey("INVALID_CREDENTIALS"),
    "errors.invalidCredentials",
  );
  assert.equal(
    getLoginErrorMessageKey("ACCOUNT_REJECTED"),
    "errors.accountRejected",
  );
  assert.equal(
    getLoginErrorMessageKey("PROFILE_COMPLETION_REQUIRED"),
    "errors.profileCompletionRequired",
  );
  assert.equal(
    getLoginErrorMessageKey(null),
    "errors.authenticationFailed",
  );
});

test("dashboard routing is explicit for known roles only", () => {
  assert.equal(getDashboardPath("en", "admin"), "/en");
  assert.equal(getDashboardPath("en", "technician"), "/en/technician");
  assert.equal(getDashboardPath("en", "operator"), "/en/operator");
  assert.equal(getDashboardPath("en", "supervisor"), null);
  assert.equal(getDashboardPath("en", undefined), null);
});

test("successful login payload is validated before storage can occur", () => {
  assert.deepEqual(
    parseLocalLoginSession({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user,
    }),
    {
      authToken: "access-token",
      refreshToken: "refresh-token",
      user,
    },
  );

  assert.throws(
    () =>
      parseLocalLoginSession({
        access_token: "access-token",
        user: { ...user, role: "supervisor" },
      }),
    /ACCOUNT_ROLE_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      parseLocalLoginSession({
        user,
      }),
    /AUTHENTICATION_FAILED/,
  );
});

test("login page lets users choose whether to stay logged in", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "app", "[locale]", "auth", "login", "page.tsx"),
    "utf8",
  );

  assert.match(source, /const \[keepLoggedIn,\s*setKeepLoggedIn\] = useState\(true\)/);
  assert.match(source, /type="checkbox"[\s\S]*checked=\{keepLoggedIn\}/);
  assert.match(source, /onChange=\{\(e\) => setKeepLoggedIn\(e\.target\.checked\)\}/);
  assert.match(source, /login\(formData\.email,\s*formData\.password,\s*keepLoggedIn\)/);
  assert.match(source, /t\('keepLoggedIn'\)/);
});

test("login request sends keepLoggedIn to backend session cookie policy", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "contexts", "AuthContext.tsx"),
    "utf8",
  );

  assert.match(source, /login = useCallback\(async \(email: string, password: string, keepLoggedIn = true\)/);
  assert.match(source, /api\.post\(\s*['"]\/auth\/login['"],\s*\{ email, password, keepLoggedIn \}/);
});
