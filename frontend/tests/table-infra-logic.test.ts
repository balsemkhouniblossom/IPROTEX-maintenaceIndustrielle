import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const API = "src/services/api.ts";
const MODAL = "src/components/Modal.tsx";
const PAGINATION = "src/components/Pagination.tsx";
const VIRTUALIZED_TABLE = "src/components/VirtualizedDataTable.tsx";
const USE_SERVER_TABLE = "src/hooks/useServerTable.ts";
const USE_ONLINE_STATUS = "src/hooks/useOnlineStatus.ts";
const OFFLINE_BANNER = "src/components/OfflineBanner.tsx";
const DASHBOARD_LAYOUT = "src/components/DashboardLayout.tsx";
const STATUS_BADGE = "src/components/StatusBadge.tsx";
const USERS_PAGE = "src/app/[locale]/users/page.tsx";
const USERS_BULK_ACTIONS_HOOK = "src/app/[locale]/users/hooks/useBulkUserActions.ts";
const USERS_SAVED_VIEWS_HOOK = "src/app/[locale]/users/hooks/useSavedUserViews.ts";
const RESOURCE_CRUD_PAGE = "src/components/ResourceCrudPage.tsx";
const MACHINE_TYPES_PAGE = "src/app/[locale]/machine-types/page.tsx";
const MODULE_TYPES_PAGE = "src/app/[locale]/module-types/page.tsx";
const PACKAGE_JSON = "package.json";

test("dead unused components were removed, not just left unreferenced", () => {
  for (const removed of ["src/components/DataTable.tsx", "src/components/StatsCard.tsx", "src/components/ClientOnly.tsx"]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), removed)), false, `${removed} should have been deleted`);
  }
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "messages/_tmp_check.json")),
    false,
    "the stray empty _tmp_check.json should have been deleted",
  );
});

test("@tanstack/react-virtual is a real dependency and VirtualizedDataTable is built on it with ARIA table semantics", () => {
  const pkg = JSON.parse(readSource(PACKAGE_JSON));
  assert.ok(pkg.dependencies["@tanstack/react-virtual"], "package.json must depend on @tanstack/react-virtual");

  const source = readSource(VIRTUALIZED_TABLE);
  assert.match(source, /from '@tanstack\/react-virtual'/);
  assert.match(source, /useVirtualizer/);
  assert.match(source, /role="table"/);
  assert.match(source, /role="row"/);
  assert.match(source, /role="columnheader"/);
  assert.match(source, /role="cell"/);
  // Roving-tabindex keyboard navigation, not a single giant tab stop per row.
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /tabIndex=\{focusedIndex === virtualRow\.index \? 0 : -1\}/);
});

test("useServerTable cancels in-flight requests via AbortController and discards out-of-order responses", () => {
  const source = readSource(USE_SERVER_TABLE);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /abortRef\.current\?\.abort\(\)/, "must cancel the previous request before starting a new one");
  assert.match(
    source,
    /if \(seq !== requestSeq\.current\) return;/,
    "must discard a response that resolves after a newer request already landed",
  );
  assert.match(source, /searchDebounceMs/, "search input must be debounced, not fired on every keystroke");
  assert.match(source, /applyOptimistic/, "must expose an optimistic-update helper with rollback");
});

test("useOnlineStatus listens to the real browser online/offline events, and OfflineBanner is mounted app-wide in DashboardLayout", () => {
  const hookSource = readSource(USE_ONLINE_STATUS);
  assert.match(hookSource, /navigator\.onLine/);
  assert.match(hookSource, /addEventListener\('online'/);
  assert.match(hookSource, /addEventListener\('offline'/);

  const bannerSource = readSource(OFFLINE_BANNER);
  assert.match(bannerSource, /useOnlineStatus/);
  assert.match(bannerSource, /role="status"/);

  const layoutSource = readSource(DASHBOARD_LAYOUT);
  assert.match(layoutSource, /import \{ OfflineBanner \} from '@\/components\/OfflineBanner';/);
  assert.match(layoutSource, /<OfflineBanner \/>/);
  // A skip-to-content link targeting the <main> landmark, for keyboard users.
  assert.match(layoutSource, /href="#main-content"/);
  assert.match(layoutSource, /id="main-content"/);
});

test("the root <html> gets a real lang/dir attribute, and the public auth pages expose a <main> landmark and labeled password-toggle buttons", () => {
  const rootLayout = readSource("src/app/layout.tsx");
  assert.match(rootLayout, /import \{ getLocale \} from "next-intl\/server";/);
  assert.match(rootLayout, /lang=\{locale\}/);
  assert.match(rootLayout, /dir=\{isRtlLocale\(locale\) \? 'rtl' : 'ltr'\}/);

  for (const page of [
    "src/app/[locale]/auth/login/page.tsx",
    "src/app/[locale]/auth/register/page.tsx",
    "src/app/[locale]/auth/forgot-password/page.tsx",
  ]) {
    const source = readSource(page);
    assert.match(source, /<main className="auth-side-panel/, `${page} must expose a <main> landmark`);
    assert.match(source, /<\/main>/, `${page}'s <main> must be properly closed`);
  }

  for (const page of ["src/app/[locale]/auth/login/page.tsx", "src/app/[locale]/auth/register/page.tsx"]) {
    const source = readSource(page);
    assert.match(source, /aria-label=\{show\w* \? t\('hidePassword'\) : t\('showPassword'\)\}/);
  }
});

test("Modal traps focus, exposes dialog ARIA semantics, and restores focus to the trigger on close", () => {
  const source = readSource(MODAL);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /previouslyFocused\.current = document\.activeElement/);
  assert.match(source, /previouslyFocused\.current\?\.focus\?\.\(\);/, "must restore focus to whatever triggered the modal");
  assert.match(source, /e\.key !== 'Tab'/, "must intercept Tab to keep the focus trap scoped to the dialog");
});

test("Pagination is a labeled <nav> landmark with per-page-number accessible names", () => {
  const source = readSource(PAGINATION);
  assert.match(source, /<nav\s/);
  assert.match(source, /aria-label="Pagination"/);
  assert.match(source, /aria-label=\{`Page \$\{currentPage\}`\}/);
});

test("StatusBadge is the single shared badge shell (no page redeclares the wrapper markup)", () => {
  const source = readSource(STATUS_BADGE);
  assert.match(source, /rounded-full border px-2 py-0\.5 text-xs font-semibold uppercase tracking-wide/);

  for (const page of [
    "src/app/[locale]/reports/page.tsx",
    "src/app/[locale]/maintenance-plans/page.tsx",
    "src/app/[locale]/knowledge-base/page.tsx",
    "src/app/[locale]/documents/page.tsx",
  ]) {
    const pageSource = readSource(page);
    assert.match(pageSource, /import \{ StatusBadge \} from ['"]@\/components\/StatusBadge['"];/, `${page} must use the shared StatusBadge`);
    assert.match(pageSource, /<StatusBadge/, `${page} must render <StatusBadge>`);
  }
});

test("simple admin CRUD pages are configuration-only wrappers around ResourceCrudPage", () => {
  const resourceSource = readSource(RESOURCE_CRUD_PAGE);
  assert.match(resourceSource, /DynamicSearchControls/, "ResourceCrudPage must own the repeated dynamic-search controls");
  assert.match(resourceSource, /matchesDynamicSearch/, "ResourceCrudPage must own client-side filtering for simple CRUD pages");
  assert.match(resourceSource, /<Pagination/, "ResourceCrudPage must own shared pagination rendering");
  assert.match(resourceSource, /<Modal/, "ResourceCrudPage must own shared create/edit dialog rendering");
  assert.match(resourceSource, /ProtectedRoute allowedRoles=\{\['admin'\]\}/, "ResourceCrudPage must keep admin permissions centralized");

  for (const page of [MACHINE_TYPES_PAGE, MODULE_TYPES_PAGE]) {
    const source = readSource(page);
    assert.match(source, /import ResourceCrudPage, \{ CrudField \} from '@\/components\/ResourceCrudPage';/);
    assert.match(source, /<ResourceCrudPage/);
    assert.doesNotMatch(source, /useState|useEffect|useMemo/, `${page} must not duplicate CRUD state hooks`);
    assert.doesNotMatch(source, /<table|<Modal|<Pagination|DynamicSearchControls/, `${page} must not duplicate table/dialog/search/pagination UI`);
  }
});

test("the Reports page lazy-loads BarChartCard via next/dynamic instead of a static import", () => {
  const source = readSource("src/app/[locale]/reports/page.tsx");
  assert.match(source, /import dynamic from 'next\/dynamic';/);
  assert.match(source, /const BarChartCard = dynamic\(/);
  assert.match(source, /\{ ssr: false/);
  assert.doesNotMatch(
    source,
    /import \{ BarChartCard[,}]/,
    "BarChartCard must not also be statically imported alongside the dynamic() call",
  );
});

test("apiService exposes saved-views CRUD and transactional bulk user approve/reject endpoints", () => {
  const source = readSource(API);

  assert.match(source, /getSavedViews:\s*\(pageKey: string\)\s*=>\s*api\.get\('\/saved-views',\s*\{\s*params:\s*\{\s*pageKey\s*\}\s*\}\)/);
  assert.match(source, /createSavedView:/);
  assert.match(source, /updateSavedView:/);
  assert.match(source, /deleteSavedView:\s*\(id: string\)\s*=>\s*api\.delete\(`\/saved-views\/\$\{id\}`\)/);

  assert.match(
    source,
    /bulkApproveUsers:\s*\(userIds: string\[\]\)\s*=>\s*api\.post\('\/users\/bulk-approve',\s*\{\s*userIds\s*\}\)/,
  );
  assert.match(
    source,
    /bulkRejectUsers:\s*\(userIds: string\[\], reason: string\)\s*=>\s*\n?\s*api\.post\('\/users\/bulk-reject',\s*\{\s*userIds,\s*reason\s*\}\)/,
  );
});

test("Users page wires bulk approve/reject with an optimistic update and a rollback on failure", () => {
  const hookSource = readSource(USERS_BULK_ACTIONS_HOOK);

  assert.match(hookSource, /apiService\.bulkApproveUsers\(ids\)/);
  assert.match(hookSource, /apiService\.bulkRejectUsers\(ids, trimmedReason\)/);
  // Optimistic removal before the request resolves...
  assert.match(
    hookSource,
    /setItems\(\(prev\) => prev\.filter\(\(user\) => !selectedIds\.has\(getActionId\(user\)\)\)\);/,
  );
  // ...and rollback to the pre-mutation snapshot in the catch block.
  assert.match(hookSource, /setItems\(previousItems\);/);
  // Bulk selection is scoped to the pending queue only (still rendered in the page shell).
  assert.match(readSource(USERS_PAGE), /selectable=\{isPending\}/);
});

test("Users page wires the SavedViewsBar to the users page-key and replays a saved query on apply", () => {
  const pageSource = readSource(USERS_PAGE);
  const hookSource = readSource(USERS_SAVED_VIEWS_HOOK);

  assert.match(pageSource, /import \{ SavedViewsBar \} from '@\/components\/SavedViewsBar';/);
  assert.match(hookSource, /apiService\.getSavedViews\('users'\)/);
  assert.match(hookSource, /pageKey: 'users'/);
  assert.match(hookSource, /function applySavedView\(view: SavedView\)/);
});

test("all supported locales define the new common accessibility keys and users.savedViews/users.bulk namespaces with matching keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return flatten(value as Record<string, unknown>, nextPrefix);
      }
      return [nextPrefix];
    });
  }

  const commonKeysByLocale: Record<string, Set<string>> = {};
  const usersKeysByLocale: Record<string, Set<string>> = {};

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));

    assert.ok(typeof messages.common?.skipToContent === "string" && messages.common.skipToContent.length > 0);
    assert.ok(typeof messages.common?.offlineBanner === "string" && messages.common.offlineBanner.length > 0);
    assert.ok(messages.users?.savedViews, `${locale}.json must have a users.savedViews namespace`);
    assert.ok(messages.users?.bulk, `${locale}.json must have a users.bulk namespace`);

    commonKeysByLocale[locale] = new Set(flatten(messages.common));
    usersKeysByLocale[locale] = new Set([
      ...flatten(messages.users.savedViews).map((k) => `savedViews.${k}`),
      ...flatten(messages.users.bulk).map((k) => `bulk.${k}`),
    ]);
  }

  const englishUsersKeys = usersKeysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishUsersKeys].filter((key) => !usersKeysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing users savedViews/bulk keys: ${missing.join(", ")}`);
  }
});
