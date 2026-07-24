import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateProtectedRouteAccess,
  getAccountStateRedirect,
  inferRequiredRoleFromPath,
} from "../src/services/sessionGuard.ts";

const approvedOperator = {
  role: "operator",
  is_active: true,
  is_verified: true,
  profile_completed: true,
  approval_status: "approved",
};
const localeFiles = ["ar", "de", "en", "es", "fr", "it"];

test("protected route denies forged role access to another role dashboard", () => {
  assert.deepEqual(
    evaluateProtectedRouteAccess({
      user: approvedOperator,
      pathname: "/en/technician",
    }),
    {
      status: "deny",
      to: "/en/operator",
      reason: "required-role-mismatch",
    },
  );
});

test("protected route rejects stale or missing sessions", () => {
  assert.deepEqual(
    evaluateProtectedRouteAccess({ user: null, pathname: "/en/operator" }),
    {
      status: "redirect",
      to: "/en/auth/login?session=expired",
      reason: "missing-session",
    },
  );
});

test("revoked or inactive accounts are redirected before rendering", () => {
  assert.deepEqual(
    getAccountStateRedirect("en", { ...approvedOperator, is_active: false }),
    {
      to: "/en/auth/login?error=inactive",
      reason: "inactive",
    },
  );
});

test("incomplete Google profiles are sent to profile completion", () => {
  assert.deepEqual(
    getAccountStateRedirect("fr", {
      ...approvedOperator,
      profile_completed: false,
      approval_status: "pending",
    }),
    {
      to: "/fr/auth/complete-profile",
      reason: "profile-incomplete",
    },
  );
});

test("pending and rejected users are blocked from dashboards", () => {
  assert.deepEqual(
    getAccountStateRedirect("de", {
      ...approvedOperator,
      approval_status: "pending",
    }),
    {
      to: "/de/auth/login?error=pending-approval",
      reason: "approval-pending",
    },
  );
  assert.deepEqual(
    getAccountStateRedirect("it", {
      ...approvedOperator,
      approval_status: "rejected",
    }),
    {
      to: "/it/auth/login?error=rejected",
      reason: "approval-rejected",
    },
  );
});

test("valid role access is allowed using current backend user role", () => {
  assert.deepEqual(
    evaluateProtectedRouteAccess({
      user: approvedOperator,
      pathname: "/es/operator/preventive",
    }),
    { status: "allow" },
  );
  assert.deepEqual(
    evaluateProtectedRouteAccess({
      user: { ...approvedOperator, role: "technician" },
      pathname: "/es/preventive-task-checklist",
      allowedRoles: ["admin", "technician"],
    }),
    { status: "allow" },
  );
});

test("route role inference protects dashboards without explicit props", () => {
  assert.equal(inferRequiredRoleFromPath("/en/operator/machines"), "operator");
  assert.equal(inferRequiredRoleFromPath("/en/technician/work-orders"), "technician");
  assert.equal(inferRequiredRoleFromPath("/en/documents"), null);
});

test("refresh-session recovery depends on backend-returned user state", () => {
  const refreshedUser = {
    ...approvedOperator,
    role: "technician",
  };

  assert.deepEqual(
    evaluateProtectedRouteAccess({
      user: refreshedUser,
      pathname: "/en/operator",
    }),
    {
      status: "deny",
      to: "/en/technician",
      reason: "required-role-mismatch",
    },
  );
});

test("protected route status messages are translated in every supported locale", () => {
  for (const locale of localeFiles) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "messages", `${locale}.json`),
        "utf8",
      ),
    );

    assert.equal(typeof messages.auth.protected.loading, "string");
    assert.equal(typeof messages.auth.protected.redirectingTitle, "string");
    assert.equal(typeof messages.auth.protected.redirectingDescription, "string");
    assert.equal(typeof messages.auth.protected.accessDeniedTitle, "string");
    assert.equal(typeof messages.auth.protected.accessDeniedDescription, "string");
  }
});
