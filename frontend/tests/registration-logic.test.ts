import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicRegistrationPayload,
  getRegistrationErrorCode,
  getRegistrationSuccessRedirect,
  PUBLIC_REGISTRATION_ROLES,
} from "../src/services/publicRegistration.ts";

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

  assert.deepEqual(Object.keys(payload).sort(), [
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

test("duplicate-email and unsupported-role backend codes are extracted", () => {
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
