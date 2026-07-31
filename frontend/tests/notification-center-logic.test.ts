import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("apiService exposes the shared /notifications endpoints for list/unread-count/read/clear", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const expectations: Array<[RegExp, string]> = [
    [/getNotifications:\s*\([^)]*\)\s*=>\s*api\.get\(["']\/notifications["']/, "getNotifications"],
    [
      /getUnreadNotificationCount:\s*\(\)\s*=>\s*api\.get\(["']\/notifications\/unread-count["']\)/,
      "getUnreadNotificationCount",
    ],
    [
      /markNotificationRead:\s*\(id:\s*string\)\s*=>\s*api\.patch\(`\/notifications\/\$\{id\}\/read`\)/,
      "markNotificationRead",
    ],
    [
      /markAllNotificationsRead:\s*\(\)\s*=>\s*api\.patch\(["']\/notifications\/read-all["']\)/,
      "markAllNotificationsRead",
    ],
    [
      /clearNotification:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/notifications\/\$\{id\}`\)/,
      "clearNotification",
    ],
    [
      /clearAllNotifications:\s*\(\)\s*=>\s*api\.delete\(["']\/notifications["']\)/,
      "clearAllNotifications",
    ],
    [
      /decidePartRequest:\s*\(id:\s*string,\s*action:[^)]*\)\s*=>\s*api\.patch\(`\/work-orders\/part-requests\/\$\{id\}\/decision`/,
      "decidePartRequest",
    ],
  ];

  for (const [pattern, name] of expectations) {
    assert.match(source, pattern, `apiService.${name} must call the expected scoped route`);
  }
});

test("NotificationBell polls the unread count and never derives it from other pages' data", () => {
  const relativePath = "src/components/NotificationBell.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.getUnreadNotificationCount\(/,
    `${relativePath} must fetch the unread count from apiService.getUnreadNotificationCount`,
  );
  assert.match(
    source,
    /apiService\.getNotifications\(/,
    `${relativePath} must fetch notifications from apiService.getNotifications`,
  );
  assert.match(
    source,
    /apiService\.markNotificationRead\(/,
    `${relativePath} must mark notifications as read through apiService.markNotificationRead`,
  );
  assert.match(
    source,
    /apiService\.markAllNotificationsRead\(/,
    `${relativePath} must support marking all as read through apiService.markAllNotificationsRead`,
  );
  assert.match(
    source,
    /apiService\.clearNotification\(/,
    `${relativePath} must clear a single notification through apiService.clearNotification`,
  );
  assert.match(
    source,
    /apiService\.clearAllNotifications\(/,
    `${relativePath} must support clearing all through apiService.clearAllNotifications`,
  );
  assert.match(
    source,
    /window\.setInterval\(/,
    `${relativePath} must poll for fresh unread counts on an interval for real-time refresh`,
  );
  assert.match(
    source,
    /useAuth\(\)/,
    `${relativePath} must read auth state before polling`,
  );
  assert.match(
    source,
    /if\s*\(isLoading\s*\|\|\s*!isAuthenticated\)\s*\{/,
    `${relativePath} must not start notification polling until session restoration succeeds`,
  );
});

test("DashboardLayout renders the shared NotificationBell for every role", () => {
  const relativePath = "src/components/DashboardLayout.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /import NotificationBell from ["']@\/components\/NotificationBell["']/,
    `${relativePath} must import the shared NotificationBell component`,
  );
  assert.match(
    source,
    /<NotificationBell\s*\/>/,
    `${relativePath} must render <NotificationBell /> in the shared header so every role gets it`,
  );
});

test("Operator dashboard no longer implements its own ad-hoc, client-derived notification bell", () => {
  const relativePath = "src/app/[locale]/operator/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.doesNotMatch(
    source,
    /notificationItems/,
    `${relativePath} must not compute its own client-derived notification list; real notifications come from the shared NotificationBell`,
  );
  assert.doesNotMatch(
    source,
    /BellAlertIcon/,
    `${relativePath} must not render its own bell icon; the shared DashboardLayout bell replaces it`,
  );
  assert.doesNotMatch(
    source,
    /headerActions=/,
    `${relativePath} must not pass a custom headerActions bell now that DashboardLayout renders the shared one`,
  );
});
