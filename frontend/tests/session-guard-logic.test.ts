import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateCompleteProfileAccess,
  evaluateProtectedRouteAccess,
  getAccountStateRedirect,
  getAuthenticatedAccountDestination,
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

test("protected route sends an anonymous missing session to plain login", () => {
  assert.deepEqual(
    evaluateProtectedRouteAccess({ user: null, pathname: "/en/operator" }),
    {
      status: "redirect",
      to: "/en/auth/login",
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

test("getAuthenticatedAccountDestination sends an incomplete Google profile to complete-profile", () => {
  assert.equal(
    getAuthenticatedAccountDestination("en", {
      role: "operator",
      is_active: false,
      is_verified: true,
      approval_status: "pending",
      profile_completed: false,
    }),
    "/en/auth/complete-profile",
  );
});

test("getAuthenticatedAccountDestination sends a completed-but-pending profile to the pending-approval destination, not the dashboard", () => {
  assert.equal(
    getAuthenticatedAccountDestination("en", {
      ...approvedOperator,
      approval_status: "pending",
    }),
    "/en/auth/login?error=pending-approval",
  );
});

test("getAuthenticatedAccountDestination sends an approved active account to its role dashboard", () => {
  assert.equal(
    getAuthenticatedAccountDestination("fr", approvedOperator),
    "/fr/operator",
  );
  assert.equal(
    getAuthenticatedAccountDestination("fr", {
      ...approvedOperator,
      role: "technician",
    }),
    "/fr/technician",
  );
});

test("evaluateCompleteProfileAccess stays in a stable loading state while auth is still resolving", () => {
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: true,
      token: null,
      user: null,
      locale: "en",
    }),
    { status: "loading" },
  );

  // Even a transient token=null/user=null must not be treated as "logged
  // out" while isLoading is still true - this transient state is exactly
  // what caused the redirect race back to login right after Google exchange.
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: true,
      token: undefined,
      user: undefined,
      locale: "en",
    }),
    { status: "loading" },
  );
});

test("evaluateCompleteProfileAccess redirects to login only once loading has finished and there is no session", () => {
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: false,
      token: null,
      user: null,
      locale: "en",
    }),
    { status: "redirect", to: "/en/auth/login" },
  );
});

test("evaluateCompleteProfileAccess keeps the form visible for an incomplete profile", () => {
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: false,
      token: "access-token",
      user: {
        role: "operator",
        is_active: false,
        is_verified: true,
        approval_status: "pending",
        profile_completed: false,
      },
      locale: "en",
    }),
    { status: "show-form" },
  );
});

test("evaluateCompleteProfileAccess redirects a completed pending profile to pending-approval, not login?error=pending-approval being confused with incomplete", () => {
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: false,
      token: "access-token",
      user: {
        role: "operator",
        is_active: false,
        is_verified: true,
        approval_status: "pending",
        profile_completed: true,
      },
      locale: "fr",
    }),
    { status: "redirect", to: "/fr/auth/login?error=pending-approval" },
  );
});

test("evaluateCompleteProfileAccess redirects an approved active user straight to their role dashboard", () => {
  assert.deepEqual(
    evaluateCompleteProfileAccess({
      isLoading: false,
      token: "access-token",
      user: approvedOperator,
      locale: "es",
    }),
    { status: "redirect", to: "/es/operator" },
  );
});
