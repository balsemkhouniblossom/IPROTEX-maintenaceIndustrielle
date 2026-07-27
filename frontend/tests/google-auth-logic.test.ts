import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getGooglePostExchangeRedirect,
  isGoogleResultStatus,
} from "../src/services/googleAuth.ts";
import { parseLocalLoginSession } from "../src/services/localLogin.ts";

const requiredGoogleAuthKeys = [
  "googleSigninCompletingTitle",
  "googleSigninCompletingDescription",
  "googleDoNotClose",
  "googleSignInSuccessful",
  "googleAccountCreatedTitle",
  "googleAccountCreatedPendingApproval",
  "googlePendingTitle",
  "googleAccountPendingApproval",
  "googleRejectedTitle",
  "googleAccountRejected",
  "googleInactiveTitle",
  "googleAccountInactive",
  "googleFailedTitle",
  "googleSignInFailed",
  "googleLinkExpiredTitle",
  "googleLoginLinkExpired",
  "tryGoogleSignInAgain",
  "returnToLogin",
  "googleRoleNotSupported",
  "completeProfileTitle",
  "completeProfileDescription",
  "completeProfileSubmit",
  "completeProfileSaving",
  "completeProfileSaveFailed",
  "completeProfileLanguage",
  "completeProfileRequestedRole",
];

test("Google result statuses are stable and limited to safe public values", () => {
  for (const status of [
    "created-pending",
    "pending",
    "rejected",
    "inactive",
    "failed",
  ]) {
    assert.equal(isGoogleResultStatus(status), true);
  }

  assert.equal(isGoogleResultStatus("GOOGLE_ACCOUNT_REJECTED"), false);
  assert.equal(isGoogleResultStatus("user@example.com"), false);
  assert.equal(isGoogleResultStatus(null), false);
});

test("Google exchange session parser stores application tokens but not exchange codes", () => {
  const exchangeCode = "one-time-exchange-code";
  const session = parseLocalLoginSession({
    access_token: "access-token",
    refresh_token: "refresh-token",
    exchange: exchangeCode,
    user: {
      _id: "user-id",
      nom_complet: "Google User",
      email: "google@example.com",
      role: "operator",
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  });

  assert.equal(session.authToken, "access-token");
  assert.equal(session.refreshToken, "refresh-token");
  assert.equal("exchange" in session, false);
  assert.equal(JSON.stringify(session).includes(exchangeCode), false);
});

test("Google exchange redirects incomplete users to complete profile before dashboards", () => {
  const incomplete = {
    _id: "user-id",
    nom_complet: "Google User",
    email: "google@example.com",
    role: "operator",
    is_active: false,
    created_at: "2026-01-01T00:00:00.000Z",
    profile_completed: false,
  };

  assert.equal(
    getGooglePostExchangeRedirect("en", incomplete),
    "/en/auth/complete-profile",
  );
  assert.equal(
    parseLocalLoginSession({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: incomplete,
    }).user.profile_completed,
    false,
  );
});

test("Google exchange redirects approved completed users to selected role dashboards", () => {
  const base = {
    _id: "user-id",
    nom_complet: "Google User",
    email: "google@example.com",
    is_active: true,
    is_verified: true,
    approval_status: "approved",
    created_at: "2026-01-01T00:00:00.000Z",
    profile_completed: true,
  };

  assert.equal(
    getGooglePostExchangeRedirect("fr", { ...base, role: "operator" }),
    "/fr/operator",
  );
  assert.equal(
    getGooglePostExchangeRedirect("fr", { ...base, role: "technician" }),
    "/fr/technician",
  );
});

test("Google exchange redirects a completed-but-pending profile to the pending-approval destination", () => {
  const pendingCompleted = {
    _id: "user-id",
    nom_complet: "Google User",
    email: "google@example.com",
    role: "operator",
    is_active: false,
    is_verified: true,
    approval_status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    profile_completed: true,
  };

  assert.equal(
    getGooglePostExchangeRedirect("de", pendingCompleted),
    "/de/auth/login?error=pending-approval",
  );
});

test("Google auth translation keys exist in every supported locale", () => {
  for (const locale of ["en", "fr", "ar", "de", "es", "it"]) {
    const file = join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(readFileSync(file, "utf8"));

    for (const key of requiredGoogleAuthKeys) {
      assert.equal(typeof messages.auth[key], "string", `${locale}.${key}`);
      assert.notEqual(messages.auth[key].trim(), "", `${locale}.${key}`);
    }
    assert.equal(
      typeof messages.auth.errors.profileCompletionRequired,
      "string",
      `${locale}.errors.profileCompletionRequired`,
    );
  }
});

test("administrator Google auth management uses stable user API routes", () => {
  const apiServiceSource = readFileSync(
    join(process.cwd(), "src", "services", "api.ts"),
    "utf8",
  );

  assert.match(apiServiceSource, /relinkUserGoogleAuth/);
  assert.match(apiServiceSource, /patch\(`\/users\/\$\{id\}\/google-auth`, data\)/);
  assert.match(apiServiceSource, /unlinkUserGoogleAuth/);
  assert.match(apiServiceSource, /delete\(`\/users\/\$\{id\}\/google-auth`\)/);
});
