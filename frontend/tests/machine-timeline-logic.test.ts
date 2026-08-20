import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("apiService exposes the machine timeline endpoints with the expected routes", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getMachineTimelineSummary:\s*\([^)]*\)\s*=>\s*api\.get\(`\/machines\/\$\{machineId\}\/timeline\/summary`/,
    "apiService.getMachineTimelineSummary must call GET /machines/:id/timeline/summary",
  );
  assert.match(
    source,
    /getMachineTimeline:\s*\(\s*machineId:\s*string,[\s\S]*?=>\s*api\.get\(`\/machines\/\$\{machineId\}\/timeline`/,
    "apiService.getMachineTimeline must call GET /machines/:id/timeline",
  );
});

test("the machines/[id] route renders MachineDetailPage from the machine-timeline feature", () => {
  const source = readSource("src/app/[locale]/machines/[id]/page.tsx");

  assert.match(
    source,
    /import MachineDetailPage from ["']@\/components\/machine-timeline\/MachineDetailPage["']/,
    "route must render the machine-timeline feature's detail page",
  );
  assert.match(
    source,
    /params:\s*Promise<\{\s*id:\s*string\s*\}>/,
    "route must await the async Next.js params object, matching the existing [id] route convention",
  );
});

test("MachineDetailPage gates access to admin/technician/operator and wires header, stats, and feed", () => {
  const source = readSource("src/components/machine-timeline/MachineDetailPage.tsx");

  assert.match(
    source,
    /allowedRoles=\{\['admin',\s*'technician',\s*'operator'\]\}/,
    "MachineDetailPage must allow all three roles, each scoped server-side by DocumentAccessService",
  );
  assert.match(source, /apiService\.getMachineTimelineSummary\(/, "must fetch the machine summary");
  assert.match(source, /<MachineHeader\b/, "must render the machine header");
  assert.match(source, /<MachineStatsCards\b/, "must render the stats cards");
  assert.match(source, /<MachineTimelineFeed\b/, "must render the timeline feed");
});

test("MachineTimelineFeed implements infinite scroll via IntersectionObserver and windowed rendering via TanStack Virtual", () => {
  const source = readSource("src/components/machine-timeline/MachineTimelineFeed.tsx");

  assert.match(
    source,
    /from ['"]@tanstack\/react-virtual['"]/,
    "must reuse the same virtualization library as VirtualizedDataTable rather than adding a new one",
  );
  assert.match(source, /new IntersectionObserver\(/, "must use a sentinel + IntersectionObserver for infinite scroll");
  assert.match(source, /apiService\.getMachineTimeline\(/, "must fetch timeline pages through the shared apiService");
  assert.match(source, /search:\s*debouncedSearch/, "must debounce search input before querying the server");
  assert.match(source, /types:\s*activeCategory/, "must pass the active category filter as the `types` query param");
});

test("TimelineEventCard reuses the shared Modal + DocumentAttachmentViewer instead of a new document preview", () => {
  const source = readSource("src/components/machine-timeline/TimelineEventCard.tsx");

  assert.match(
    source,
    /import \{ Modal \} from ["']@\/components\/Modal["']/,
    "must reuse the shared Modal component",
  );
  assert.match(
    source,
    /import DocumentAttachmentViewer from ["']@\/components\/DocumentAttachmentViewer["']/,
    "must reuse the existing document viewer rather than building a new one",
  );
  assert.match(source, /apiService\.getDocument\(/, "must fetch the document through the existing documents API");
});

test("event metadata (icons/colors) covers every backend MachineTimelineEventType", () => {
  const metaSource = readSource("src/components/machine-timeline/eventMeta.ts");
  const typesSource = readSource("src/components/machine-timeline/types.ts");

  const eventTypeBlockMatch = typesSource.match(
    /export type MachineTimelineEventType =([\s\S]*?);/,
  );
  assert.ok(eventTypeBlockMatch, "types.ts must declare MachineTimelineEventType");
  const eventTypeMatches = [...eventTypeBlockMatch![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(eventTypeMatches.length > 25, "expected the full MachineTimelineEventType union to be listed");

  for (const eventType of eventTypeMatches) {
    assert.match(
      metaSource,
      new RegExp(`${eventType}:\\s*\\w+Icon`),
      `EVENT_ICONS must define an icon for "${eventType}"`,
    );
    assert.match(
      metaSource,
      new RegExp(`${eventType}:\\s*'bg-`),
      `EVENT_COLOR_CLASSES must define a color for "${eventType}"`,
    );
  }
});

test("groupByDate supports Today/Yesterday/Last 7 days/Last 30 days and falls back to month grouping", () => {
  const source = readSource("src/components/machine-timeline/groupByDate.ts");

  for (const key of ["today", "yesterday", "last7Days", "last30Days"]) {
    assert.match(source, new RegExp(`return ['"]${key}['"]`), `groupKeyForDate must return "${key}"`);
  }
  assert.match(
    source,
    /toLocaleDateString\(locale,\s*\{\s*month:\s*['"]long['"],\s*year:\s*['"]numeric['"]\s*\}\)/,
    "events older than 30 days must be grouped by month, per the 'also support grouping by month' requirement",
  );
});

test("the admin machines list and technician work order detail link into the new machine timeline route", () => {
  const machinesPageSource = readSource("src/app/[locale]/machines/page.tsx");
  assert.match(
    machinesPageSource,
    /router\.push\(`\/\$\{locale\}\/machines\/\$\{machine\._id\}`\)/,
    "admin machines list must link each row into /machines/:id",
  );

  const technicianDetailSource = readSource("src/components/technician/TechnicianWorkOrderDetail.tsx");
  assert.match(
    technicianDetailSource,
    /href=\{`\/\$\{locale\}\/machines\/\$\{machine\._id\}`\}/,
    "technician work order detail must link to the machine timeline for the work order's machine",
  );
});

test("machine timeline translation keys exist for every supported locale", () => {
  const locales = ["en", "fr", "es", "de", "it", "ar"];
  for (const locale of locales) {
    const messages = JSON.parse(readSource(`messages/${locale}.json`));
    assert.ok(messages.machineTimeline, `messages/${locale}.json must define a "machineTimeline" namespace`);
    const eventTypes = messages.machineTimeline.eventTypes;
    assert.ok(eventTypes, `messages/${locale}.json machineTimeline.eventTypes must be defined`);
    assert.ok(
      Object.keys(eventTypes).length > 25,
      `messages/${locale}.json machineTimeline.eventTypes must translate the full event vocabulary`,
    );
    assert.ok(
      messages.machineTimeline.filters?.categories,
      `messages/${locale}.json must translate the timeline filter categories`,
    );
    assert.ok(messages.machineTimeline.groups?.today, `messages/${locale}.json must translate groups.today`);
    assert.ok(
      messages.machineTimeline.groups?.last30Days,
      `messages/${locale}.json must translate groups.last30Days`,
    );
  }
});
