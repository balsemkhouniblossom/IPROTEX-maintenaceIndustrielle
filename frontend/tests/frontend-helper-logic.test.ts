import test from "node:test";
import assert from "node:assert/strict";

import {
  displayText,
  isRawTechnicalId,
  referenceDisplay,
} from "../src/services/displayValues.ts";
import {
  fetchAllPaginated,
  normalizeApiItems,
  readPaginationMeta,
} from "../src/services/pagination.ts";
import {
  DEFAULT_PHONE_COUNTRY,
  buildInternationalPhone,
  formatNationalPhone,
  getPhoneCountryOption,
  parseInternationalPhoneValue,
  validateNationalPhone,
} from "../src/services/phoneNumber.ts";
import {
  dateGroupLabel,
  groupKeyForDate,
  isTranslatableGroupKey,
} from "../src/components/machine-timeline/groupByDate.ts";
import { invalidateList, LIST_EVENTS } from "../src/services/listInvalidation.ts";

test("displayText hides raw technical identifiers and formats safe scalar values", () => {
  assert.equal(isRawTechnicalId("64f0d61b4e0f7c1b3c9a1234"), true);
  assert.equal(isRawTechnicalId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isRawTechnicalId("MCH-100"), false);

  assert.equal(displayText(null, "n/a"), "n/a");
  assert.equal(displayText("  Pump A  "), "Pump A");
  assert.equal(displayText(42), "42");
  assert.equal(displayText(false), "false");
  assert.equal(displayText("64f0d61b4e0f7c1b3c9a1234", "hidden"), "hidden");
});

test("displayText and referenceDisplay prefer readable object fields over ids", () => {
  assert.equal(displayText(new Date("2026-08-21T10:00:00.000Z")), "2026-08-21T10:00:00.000Z");
  assert.equal(
    displayText({
      _id: "64f0d61b4e0f7c1b3c9a1234",
      name: "Lubricant A",
    }),
    "Lubricant A",
  );
  assert.equal(referenceDisplay({ code: "MCH-100", label: "Main press" }, ["code", "label"]), "MCH-100");
  assert.equal(referenceDisplay({ _id: "64f0d61b4e0f7c1b3c9a1234" }, ["_id"], "fallback"), "fallback");
  assert.equal(referenceDisplay(undefined, ["name"], "fallback"), "fallback");
});

test("pagination helpers normalize common list payloads and clamp metadata", () => {
  assert.deepEqual(normalizeApiItems(["a", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeApiItems({ docs: [1, 2] }), [1, 2]);
  assert.deepEqual(normalizeApiItems({ machines: [{ id: "m1" }] }), [{ id: "m1" }]);
  assert.deepEqual(normalizeApiItems({ unknown: [] }), []);

  assert.deepEqual(readPaginationMeta({ page: 2.9, totalPages: 0 }), { page: 2, totalPages: 1 });
  assert.equal(readPaginationMeta({ page: "nope", totalPages: 3 }), null);
  assert.equal(readPaginationMeta(null), null);
});

test("fetchAllPaginated gathers every page when metadata says more pages exist", async () => {
  const calls: Array<{ page?: number; limit?: number }> = [];
  const pages: Record<number, unknown> = {
    1: { items: ["a"], page: 1, totalPages: 3 },
    2: { data: ["b"], page: 2, totalPages: 3 },
    3: { rows: ["c"], page: 3, totalPages: 3 },
  };

  const items = await fetchAllPaginated<string>(async (params) => {
    calls.push(params ?? {});
    return { data: pages[params?.page ?? 1] };
  }, 25);

  assert.deepEqual(items, ["a", "b", "c"]);
  assert.deepEqual(calls, [
    { page: 1, limit: 25 },
    { page: 2, limit: 25 },
    { page: 3, limit: 25 },
  ]);
});

test("phone helpers format, validate, build, and parse international values", () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, "TN");
  assert.equal(getPhoneCountryOption("FR").dialCode, "+33");
  assert.equal(formatNationalPhone("US", "4155552671"), "(415) 555-2671");
  assert.equal(validateNationalPhone("US", "4155552671"), true);
  assert.equal(validateNationalPhone("US", "12"), false);
  assert.equal(buildInternationalPhone("US", "(415) 555-2671"), "+14155552671");
  assert.deepEqual(parseInternationalPhoneValue("+14155552671"), {
    country: "US",
    nationalNumber: "4155552671",
  });
  assert.deepEqual(parseInternationalPhoneValue("not a phone"), {
    country: "TN",
    nationalNumber: "",
  });
  assert.deepEqual(parseInternationalPhoneValue(null), {
    country: "TN",
    nationalNumber: "",
  });
});

test("machine timeline date grouping handles relative buckets and month labels", () => {
  const now = new Date(2026, 7, 21, 15, 30);

  assert.equal(groupKeyForDate(new Date(2026, 7, 21, 0, 1), now, "en-US"), "today");
  assert.equal(groupKeyForDate(new Date(2026, 7, 20, 23, 59), now, "en-US"), "yesterday");
  assert.equal(groupKeyForDate(new Date(2026, 7, 15, 12), now, "en-US"), "last7Days");
  assert.equal(groupKeyForDate(new Date(2026, 7, 1, 12), now, "en-US"), "last30Days");

  const older = groupKeyForDate(new Date(2026, 5, 15, 12), now, "en-US");
  assert.deepEqual(older, { monthLabel: "June 2026" });
  assert.equal(dateGroupLabel(older), "June 2026");
  assert.equal(dateGroupLabel("today"), "today");
  assert.equal(isTranslatableGroupKey("last30Days"), true);
  assert.equal(isTranslatableGroupKey(older), false);
});

test("invalidateList dispatches known list events only when window exists", () => {
  const originalWindow = globalThis.window;
  const dispatched: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent(event: Event) {
        dispatched.push(event.type);
        return true;
      },
    },
  });

  try {
    invalidateList(LIST_EVENTS.workOrders);
    invalidateList(LIST_EVENTS.reports);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }

  assert.deepEqual(dispatched, ["work-orders:changed", "reports:changed"]);
});
