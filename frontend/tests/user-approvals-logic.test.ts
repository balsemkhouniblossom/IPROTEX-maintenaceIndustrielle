import test from "node:test";
import assert from "node:assert/strict";
import en from "../messages/en.json" with { type: "json" };
import fr from "../messages/fr.json" with { type: "json" };
import ar from "../messages/ar.json" with { type: "json" };
import de from "../messages/de.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import it from "../messages/it.json" with { type: "json" };
import {
  buildPendingApprovalsParams,
  buildRejectAccountPayload,
  buildUsersListParams,
  getApprovalErrorCode,
} from "../src/services/userApprovalLogic.ts";

test("pending-list request parameters preserve pagination and filters", () => {
  assert.deepEqual(
    buildPendingApprovalsParams({
      page: 2,
      limit: 50,
      search: "  user+test@example.com  ",
      role: "operator",
      emailVerified: "verified",
      sortOrder: "desc",
    }),
    {
      page: 2,
      limit: 50,
      search: "user+test@example.com",
      role: "operator",
      emailVerified: "verified",
      sortOrder: "desc",
    },
  );
});

test("role filters support operator and technician while all omits role", () => {
  assert.equal(buildPendingApprovalsParams({ role: "operator" }).role, "operator");
  assert.equal(buildPendingApprovalsParams({ role: "technician" }).role, "technician");
  assert.equal(buildPendingApprovalsParams({ role: "all" }).role, undefined);
});

test("users list request supports server-side approval filtering", () => {
  assert.deepEqual(
    buildUsersListParams({
      page: 1,
      limit: 20,
      search: " approved ",
      approvalStatus: "approved",
    }),
    {
      page: 1,
      limit: 20,
      search: "approved",
      approvalStatus: "approved",
    },
  );
});

test("reject request trims the reason and sends no approval metadata", () => {
  const payload = buildRejectAccountPayload("  Not eligible  ");
  assert.deepEqual(payload, { reason: "Not eligible" });
  assert.equal("approved_by" in payload, false);
  assert.equal("approval_status" in payload, false);
});

test("API errors preserve stable backend codes", () => {
  assert.equal(
    getApprovalErrorCode({
      response: { data: { code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL" } },
    }),
    "EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL",
  );
  assert.equal(
    getApprovalErrorCode({
      response: { data: { message: { code: "ADMIN_ACCESS_REQUIRED" } } },
    }),
    "ADMIN_ACCESS_REQUIRED",
  );
});

test("all approval translation keys exist in six locales", () => {
  const locales = [en, fr, ar, de, es, it] as Array<{
    users: { approvals: Record<string, unknown> };
  }>;
  const requiredTopLevel = [
    "tabs",
    "pendingCount",
    "emailVerified",
    "emailNotVerified",
    "mustVerifyBeforeApproval",
    "rejectionReason",
    "accessDenied",
    "empty",
    "errors",
  ];

  for (const locale of locales) {
    for (const key of requiredTopLevel) {
      assert.ok(locale.users.approvals[key], key);
    }
    assert.equal(
      (locale.users.approvals.tabs as Record<string, string>).pending.length > 0,
      true,
    );
    assert.ok(
      (locale.users.approvals.errors as Record<string, string>)
        .EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL,
    );
  }
});

test("Arabic approval translations are present for RTL rendering", () => {
  assert.equal(typeof ar.users.approvals.tabs.pending, "string");
  assert.equal(ar.users.approvals.tabs.pending.length > 0, true);
});
