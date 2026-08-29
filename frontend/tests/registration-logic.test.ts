import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPublicRegistrationPayload,
  getRegistrationErrorCode,
  getRegistrationSuccessRedirect,
  PUBLIC_REGISTRATION_ROLES,
} from "../src/services/publicRegistration.ts";

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

test("admin is not available in the public role selector source", () => {
  assert.equal(PUBLIC_REGISTRATION_ROLES.includes("admin" as never), false);
});

test("operator and technician are available public registration roles", () => {
  assert.deepEqual([...PUBLIC_REGISTRATION_ROLES], ["operator", "technician"]);
});

test("registration sends only allowed public fields", () => {
  const payload = buildPublicRegistrationPayload({
    nom_complet: "User",
    email: "user@example.com",
    phone: "+21612345678",
    password: "P@ssword123!",
    role: "operator",
    department: "Maintenance",
    is_active: true,
    approval_status: "approved",
  } as never);

  assert.deepEqual(Object.keys(payload).sort(compareStrings), [
    "department",
    "email",
    "nom_complet",
    "password",
    "phone",
    "role",
  ]);
});

test("successful registration redirect uses pending-approval status", () => {
  assert.equal(
    getRegistrationSuccessRedirect("en"),
    "/en/auth/login?registered=pending-approval",
  );
});

test("registration helper stores no token or user session", () => {
  const writes: string[] = [];
  globalThis.localStorage = {
    setItem: (key: string) => writes.push(key),
  } as unknown as Storage;
  globalThis.sessionStorage = {
    setItem: (key: string) => writes.push(key),
  } as unknown as Storage;

  buildPublicRegistrationPayload({
    nom_complet: "User",
    email: "user@example.com",
    password: "P@ssword123!",
    role: "technician",
  });

  assert.deepEqual(writes, []);
});

test("registration backend error codes are extracted", () => {
  assert.equal(
    getRegistrationErrorCode({
      response: { data: { code: "EMAIL_ALREADY_REGISTERED" } },
    }),
    "EMAIL_ALREADY_REGISTERED",
  );
  assert.equal(
    getRegistrationErrorCode({
      response: {
        data: {
          message: {
            code: "PUBLIC_ROLE_NOT_ALLOWED",
            message: "Role not allowed",
          },
        },
      },
    }),
    "PUBLIC_ROLE_NOT_ALLOWED",
  );
  assert.equal(
    getRegistrationErrorCode({
      response: { data: { code: "REGISTRATION_EMAIL_DELIVERY_FAILED" } },
    }),
    "REGISTRATION_EMAIL_DELIVERY_FAILED",
  );
});

test("registration page maps email delivery failure and quiets expected API logging", () => {
  const pageSource = readFileSync(
    join(process.cwd(), "src", "app", "[locale]", "auth", "register", "page.tsx"),
    "utf8",
  );
  const authContextSource = readFileSync(
    join(process.cwd(), "src", "contexts", "AuthContext.tsx"),
    "utf8",
  );

  assert.match(pageSource, /REGISTRATION_EMAIL_DELIVERY_FAILED/);
  assert.match(pageSource, /registrationEmailDeliveryFailed/);
  assert.match(authContextSource, /api\.post\(["']\/auth\/register["'],\s*userData,\s*quiet\(/);
});

test("unsupported public role is rejected before payload submission", () => {
  assert.throws(
    () =>
      buildPublicRegistrationPayload({
        nom_complet: "Admin",
        email: "admin@example.com",
        password: "P@ssword123!",
        role: "admin",
      }),
    /PUBLIC_ROLE_NOT_ALLOWED/,
  );
});
