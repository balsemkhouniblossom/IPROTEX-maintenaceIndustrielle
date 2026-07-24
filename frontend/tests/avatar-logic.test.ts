import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVATAR_SESSION_DISMISSAL_KEY,
  getAssistantAnimationClass,
  getAvatarFirstName,
  getSeason,
  getSleeveStyle,
  getTimeOfDay,
  isAvatarMessageDismissed,
  normalizeAvatarRole,
  ROLE_CONFIG,
  selectAvatarMessage,
  setAvatarMessageDismissed,
} from "../src/components/avatar/avatar-config.ts";

test("time-of-day boundaries use browser-local hours", () => {
  assert.equal(getTimeOfDay(8), "morning");
  assert.equal(getTimeOfDay(14), "afternoon");
  assert.equal(getTimeOfDay(19), "evening");
  assert.equal(getTimeOfDay(23), "night");
  assert.equal(getTimeOfDay(3), "night");
});

test("northern seasons select the intended clothing", () => {
  const summer = getSeason(6, "northern");
  const winter = getSeason(0, "northern");
  assert.equal(getSleeveStyle(summer), "short");
  assert.equal(getSleeveStyle(winter), "jacket");
});

test("roles resolve to their typed configurations", () => {
  assert.equal(normalizeAvatarRole("operator"), "OPERATOR");
  assert.equal(normalizeAvatarRole("technician"), "TECHNICIAN");
  assert.equal(normalizeAvatarRole("admin"), "ADMIN");
  assert.equal(normalizeAvatarRole("unknown"), "NEUTRAL");
  assert.equal(ROLE_CONFIG.OPERATOR.badge, "operator");
  assert.equal(ROLE_CONFIG.TECHNICIAN.badge, "maintenance");
  assert.equal(ROLE_CONFIG.ADMIN.badge, "admin");
});

test("context messages follow maintenance priority", () => {
  assert.deepEqual(
    selectAvatarMessage({ overdue: 2, dueToday: 4, assigned: 6 }),
    { messageKey: "overdue", actionKey: "reviewOverdue", count: 2 },
  );
  assert.deepEqual(
    selectAvatarMessage({ dueToday: 4, assigned: 6 }),
    { messageKey: "dueToday", actionKey: "startMaintenance", count: 4 },
  );
});

test("missing statistics and names stay neutral", () => {
  assert.deepEqual(selectAvatarMessage(undefined), { messageKey: "loading" });
  assert.equal(getAvatarFirstName(undefined), undefined);
  assert.equal(getAvatarFirstName("   "), undefined);
  assert.equal(String(getAvatarFirstName(undefined) ?? ""), "");
});

test("reduced motion disables nonessential animation", () => {
  assert.equal(getAssistantAnimationClass(true, true), "");
  assert.equal(getAssistantAnimationClass(true, false), "mini-avatar-animate");
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none\s*!important/);
});

test("speech-bubble dismissal uses the supplied session storage", () => {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(isAvatarMessageDismissed(sessionStorage), false);
  setAvatarMessageDismissed(sessionStorage, true);
  assert.equal(values.get(AVATAR_SESSION_DISMISSAL_KEY), "true");
  assert.equal(isAvatarMessageDismissed(sessionStorage), true);
  setAvatarMessageDismissed(sessionStorage, false);
  assert.equal(isAvatarMessageDismissed(sessionStorage), false);
});

test("all supported locales contain the complete miniAvatar contract", () => {
  const locales = ["en", "fr", "ar", "de", "es", "it"];
  const paths = [
    "greetings.hello", "greetings.helloName", "greetings.morning", "greetings.morningName",
    "greetings.afternoon", "greetings.afternoonName", "greetings.evening", "greetings.eveningName",
    "greetings.night", "greetings.nightName", "messages.loading", "messages.ready", "messages.overdue",
    "messages.dueToday", "messages.inProgress", "messages.waitingValidation", "messages.assigned", "messages.clear",
    "actions.reviewOverdue", "actions.startMaintenance", "actions.continueTask", "actions.viewReports",
    "actions.viewCalendar", "actions.openMessage", "actions.closeMessage", "accessibility.assistantRegion",
    "accessibility.operatorAvatar", "accessibility.technicianAvatar", "accessibility.adminAvatar", "accessibility.neutralAvatar",
  ];

  for (const locale of locales) {
    const messages = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
    for (const path of paths) {
      const value = path.split(".").reduce<unknown>((current, key) => (
        current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined
      ), messages.miniAvatar);
      assert.equal(typeof value, "string", `${locale} is missing miniAvatar.${path}`);
    }
  }
});

test("all supported locales contain email-verification messages", () => {
  const locales = ["en", "fr", "ar", "de", "es", "it"];
  const keys = [
    "registrationSuccess",
    "registrationPendingApproval",
    "emailAlreadyRegistered",
    "publicRoleNotAllowed",
    "emailVerified",
    "emailAlreadyVerified",
    "emailVerifiedPendingApproval",
    "emailVerifiedAccountRejected",
    "waitingForAdminApproval",
    "emailVerificationFailed",
    "invalidOrExpiredVerificationLink",
    "youMayCloseThisPage",
    "returnToLogin",
    "emailNotVerified",
    "verifyingEmail",
    "verificationPleaseWait",
  ];

  for (const locale of locales) {
    const messages = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
    for (const key of keys) {
      assert.equal(typeof messages.auth?.[key], "string", `${locale} is missing auth.${key}`);
    }
  }
});
