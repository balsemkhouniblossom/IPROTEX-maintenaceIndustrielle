import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const DEVICES_PAGE = "src/app/[locale]/devices/page.tsx";
const HOOK = "src/hooks/useLiveMonitoring.ts";
const BADGE = "src/components/device-monitoring/LiveStatusBadge.tsx";

test("apiService exposes device registration/management and role-scoped live-monitoring endpoints", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getDevices:\s*\(\)\s*=>\s*api\.get\('\/devices'\)/,
    "apiService.getDevices must GET /devices",
  );
  assert.match(
    source,
    /registerDevice:\s*\(data:\s*AnyObject\)\s*=>\s*api\.post\('\/devices',\s*data\)/,
    "apiService.registerDevice must POST /devices",
  );
  assert.match(
    source,
    /rotateDeviceKey:\s*\(id:\s*string\)\s*=>\s*api\.post\(`\/devices\/\$\{id\}\/rotate-key`\)/,
    "apiService.rotateDeviceKey must POST /devices/:id/rotate-key",
  );
  assert.match(
    source,
    /deleteDevice:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/devices\/\$\{id\}`\)/,
    "apiService.deleteDevice must DELETE /devices/:id",
  );
  assert.match(
    source,
    /getLiveMonitoringSummary:\s*\(\)\s*=>\s*api\.get\('\/live-monitoring\/machines'\)/,
    "apiService.getLiveMonitoringSummary must GET /live-monitoring/machines",
  );
  assert.match(
    source,
    /getMachineLiveStatus:\s*\(machineId:\s*string\)\s*=>\s*api\.get\(`\/live-monitoring\/machines\/\$\{machineId\}`\)/,
    "apiService.getMachineLiveStatus must GET /live-monitoring/machines/:machineId",
  );
  assert.match(
    source,
    /resolveFaultEvent:\s*\(id:\s*string\)\s*=>\s*api\.patch\(`\/live-monitoring\/faults\/\$\{id\}\/resolve`\)/,
    "apiService.resolveFaultEvent must PATCH /live-monitoring/faults/:id/resolve",
  );
});

test("useLiveMonitoring always does an initial REST fetch and keeps polling as a resilient fallback", () => {
  const source = readSource(HOOK);

  assert.match(
    source,
    /apiService\.getLiveMonitoringSummary\(\)/,
    "the hook must fetch the bulk live-status summary via REST",
  );
  assert.match(
    source,
    /const POLL_INTERVAL_MS = 30000;/,
    "the hook must poll on the same 30s cadence as the rest of the app (NotificationBell)",
  );
  assert.match(
    source,
    /window\.setInterval\(\(\) => void refresh\(\), POLL_INTERVAL_MS\)/,
    "the hook must keep re-polling regardless of WebSocket connection state",
  );
});

test("useLiveMonitoring authenticates its WebSocket connection with the in-memory JWT, matching the gateway's expected handshake shape", () => {
  const source = readSource(HOOK);

  assert.match(
    source,
    /io\(`\$\{getApiBaseUrl\(\)\}\/live`,\s*\{\s*auth:\s*\{\s*token\s*\}/,
    "the socket.io client must connect to the /live namespace with { auth: { token } }",
  );
  assert.match(
    source,
    /getAuthToken\(\)/,
    "the hook must read the same in-memory auth token apiService's interceptor uses",
  );
  assert.match(
    source,
    /socket\.io\.on\("reconnect_attempt",\s*\(\)\s*=>\s*\{[\s\S]*?socket!\.auth = \{ token: getAuthToken\(\) \};/,
    "a reconnect must use the latest in-memory access token after API refresh",
  );
  assert.doesNotMatch(
    source,
    /query:\s*\{[\s\S]*token/,
    "the socket token must not be sent through URL query parameters",
  );
});

test("useLiveMonitoring only subscribes to a machine room once and re-subscribes after a reconnect", () => {
  const source = readSource(HOOK);

  assert.match(
    source,
    /subscribedMachineIds\.current\.has\(machineId\)/,
    "subscribeToMachine must be idempotent per machine id",
  );
  assert.match(
    source,
    /socket\.on\("connect",\s*\(\)\s*=>\s*\{[\s\S]*?subscribedMachineIds\.current\.forEach/,
    "the hook must re-join every previously-subscribed machine room after a reconnect",
  );
});

test("LiveStatusBadge takes status/onSubscribe as props instead of calling the hook itself, so one page render opens exactly one socket", () => {
  const source = readSource(BADGE);

  assert.doesNotMatch(
    source,
    /=\s*useLiveMonitoring\(\)/,
    "LiveStatusBadge must not call useLiveMonitoring() directly — that would open one WebSocket connection per rendered badge",
  );
  assert.match(
    source,
    /import type \{ LiveMachineStatus \} from "@\/hooks\/useLiveMonitoring";/,
    "LiveStatusBadge should only import the hook's type, not the hook function itself",
  );
  assert.match(
    source,
    /status:\s*LiveMachineStatus \| undefined;\s*\n\s*onSubscribe:\s*\(machineId:\s*string\)\s*=>\s*void;/,
    "LiveStatusBadge must accept status and onSubscribe as props",
  );
});

test("LiveStatusBadge renders nothing for a machine with no registered device, preserving the manual-only workflow", () => {
  const source = readSource(BADGE);

  assert.match(
    source,
    /if \(!status \|\| !status\.hasDevice\) return null;/,
    "the badge must render nothing when the machine has no device, not a placeholder or a disabled state",
  );
});

test("Machines and Operator Machines pages call useLiveMonitoring exactly once and pass the shared state down to each row's badge", () => {
  const machinesPage = readSource("src/app/[locale]/machines/page.tsx");
  const operatorMachinesPage = readSource("src/app/[locale]/operator/machines/page.tsx");

  for (const [label, source] of [
    ["admin machines page", machinesPage],
    ["operator machines page", operatorMachinesPage],
  ] as const) {
    const hookCalls = source.match(/useLiveMonitoring\(\)/g) ?? [];
    assert.equal(hookCalls.length, 1, `${label} must call useLiveMonitoring() exactly once`);
    assert.match(
      source,
      /<LiveStatusBadge\s+machineId=\{machine\._id\}\s+status=\{statusByMachine\[machine\._id\]\}\s+onSubscribe=\{subscribeToMachine\}/,
      `${label} must pass status/onSubscribe down to LiveStatusBadge`,
    );
  }
});

test("the Devices admin page reveals a newly registered or rotated API key exactly once and never re-displays it", () => {
  const source = readSource(DEVICES_PAGE);

  assert.match(
    source,
    /setRevealedKey\(\{ deviceId: response\.data\.device\.device_id, apiKey: response\.data\.apiKey \}\)/,
    "registering a device must show the raw key from the registration response",
  );
  assert.match(
    source,
    /setRevealedKey\(\{ deviceId: device\.device_id, apiKey: response\.data\.apiKey \}\)/,
    "rotating a device's key must show the new raw key from the rotation response",
  );
  assert.doesNotMatch(
    source,
    /device\.api_key|device\.apiKey/,
    "the page must never read/display an api key back off a stored Device record — only off a fresh registration/rotation response",
  );
});

test("the Devices admin page shows a translated confirmation before rotating a key or deleting a device", () => {
  const source = readSource(DEVICES_PAGE);

  assert.match(
    source,
    /confirm\(t\("notifications\.confirmRotate"\)\)/,
    "must confirm before rotating a device's key (invalidates the old one immediately)",
  );
  assert.match(
    source,
    /confirm\(t\("notifications\.confirmDelete"\)\)/,
    "must confirm before deleting a device registration",
  );
});

test("corrective/preventive knowledge suggestions and technician machine detail surface the live status badge alongside existing content", () => {
  const technicianDetail = readSource("src/components/technician/TechnicianWorkOrderDetail.tsx");

  assert.match(
    technicianDetail,
    /<LiveStatusBadge[\s\S]*?machineId=\{machine\._id\}/,
    "the technician work-order detail page must surface live status for the work order's machine",
  );
});

test("all supported locales define the deviceMonitoring translation namespace with matching keys, and the sidebar Devices link", () => {
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

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(messages.deviceMonitoring, `${locale}.json must have a deviceMonitoring namespace`);
    assert.ok(
      typeof messages.sidebar?.navigation?.devices === "string" &&
        messages.sidebar.navigation.devices.length > 0,
      `${locale}.json sidebar.navigation.devices must be a non-empty string`,
    );
    keysByLocale[locale] = new Set(flatten(messages.deviceMonitoring));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing deviceMonitoring keys: ${missing.join(", ")}`);
  }
});
