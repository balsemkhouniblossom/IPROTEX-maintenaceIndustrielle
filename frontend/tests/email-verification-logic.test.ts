import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEmailVerificationRedirect,
  getEmailVerificationRedirectState,
} from "../src/services/emailVerification.ts";

test("successful pending verification redirects to pending approval state", () => {
  assert.equal(
    buildEmailVerificationRedirect("en", "EMAIL_VERIFIED_PENDING_APPROVAL"),
    "/en/auth/login?verified=pending-approval",
  );
  assert.equal(
    buildEmailVerificationRedirect("en", "EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL"),
    "/en/auth/login?verified=pending-approval",
  );
});

test("email verification redirect never includes the verification token", () => {
  const redirect = buildEmailVerificationRedirect(
    "fr",
    "EMAIL_VERIFIED_PENDING_APPROVAL",
  );

  assert.equal(redirect.includes("token="), false);
  assert.equal(redirect.includes("jwt"), false);
});

test("email verification helper stores no token or user session", () => {
  const writes: string[] = [];
  globalThis.localStorage = {
    setItem: (key: string) => writes.push(key),
  } as Storage;
  globalThis.sessionStorage = {
    setItem: (key: string) => writes.push(key),
  } as Storage;

  buildEmailVerificationRedirect("en", "EMAIL_VERIFIED");

  assert.deepEqual(writes, []);
});

test("email verification maps already verified, rejected, and failed states", () => {
  assert.equal(
    getEmailVerificationRedirectState("EMAIL_ALREADY_VERIFIED"),
    "already",
  );
  assert.equal(
    getEmailVerificationRedirectState("EMAIL_VERIFIED_ACCOUNT_REJECTED"),
    "rejected",
  );
  assert.equal(getEmailVerificationRedirectState("bad-code"), "failed");
  assert.equal(getEmailVerificationRedirectState(), "failed");
});

test("email verification never redirects to an authenticated dashboard", () => {
  const redirects = [
    buildEmailVerificationRedirect("en", "EMAIL_VERIFIED"),
    buildEmailVerificationRedirect("en", "EMAIL_VERIFIED_PENDING_APPROVAL"),
    buildEmailVerificationRedirect("en", "EMAIL_VERIFIED_ACCOUNT_REJECTED"),
  ];

  assert.equal(redirects.some((value) => value === "/en"), false);
  assert.equal(redirects.some((value) => value.includes("/operator")), false);
  assert.equal(redirects.some((value) => value.includes("/technician")), false);
});
