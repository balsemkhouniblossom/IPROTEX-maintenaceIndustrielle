import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_FIELDS_TOKEN,
  getSearchableFields,
  matchesDynamicSearch,
} from "../src/services/dynamicSearch.ts";

const machines = [
  {
    _id: "64f0d61b4e0f7c1b3c9a1234",
    code: "MCH-100",
    name: "D\u00e9coupeuse Alpha",
    status: "active",
    machine_id: "hidden-foreign-key",
    details: {
      serialNumber: "SN-001",
      token: "never-index-me",
    },
    modules: [
      { name: "Convoyeur", reference: "MOD-77" },
      { imageUrl: "https://example.test/photo.png" },
    ],
  },
  {
    _id: "64f0d61b4e0f7c1b3c9a5678",
    code: "MCH-200",
    name: "Presse Beta",
    status: "maintenance",
    details: {
      serialNumber: "SN-002",
    },
  },
];

test("getSearchableFields prioritizes human labels and keeps explicitly included machine code fields", () => {
  const fields = getSearchableFields(machines, {
    include: ["code"],
    maxFields: 6,
  });

  assert.equal(fields[0], "code");
  assert.ok(fields.includes("name"));
  assert.ok(fields.includes("status"));
  assert.ok(fields.includes("details.serialNumber"));
  assert.ok(!fields.includes("_id"));
  assert.ok(!fields.includes("machine_id"));
  assert.ok(!fields.includes("details.token"));
  assert.ok(!fields.includes("modules.imageUrl"));
});

test("getSearchableFields accepts common paginated API payload shapes", () => {
  assert.deepEqual(getSearchableFields({ items: machines }, { maxFields: 3 }), [
    "details.serialNumber",
    "name",
    "modules.name",
  ]);
  assert.deepEqual(getSearchableFields({ data: machines }, { include: ["code"], maxFields: 1 }), ["code"]);
});

test("getSearchableFields returns an empty list for empty or invalid input shapes", () => {
  const originalError = console.error;
  const messages: unknown[] = [];
  console.error = (...args: unknown[]) => messages.push(args);
  try {
    assert.deepEqual(getSearchableFields([], { maxFields: 3 }), []);
    assert.deepEqual(getSearchableFields({ rows: machines }, { maxFields: 3 }), []);
  } finally {
    console.error = originalError;
  }

  assert.equal(messages.length, 1);
  assert.match(String((messages[0] as unknown[])[0]), /invalid input shape/);
});

test("matchesDynamicSearch normalizes case and diacritics across selected fields", () => {
  assert.equal(matchesDynamicSearch(machines[0], "decoupeuse", "name"), true);
  assert.equal(matchesDynamicSearch(machines[0], "D\u00e9coupeuse", "name"), true);
  assert.equal(matchesDynamicSearch(machines[0], "beta", "name"), false);
});

test("matchesDynamicSearch searches selected nested fields and all searchable fields", () => {
  assert.equal(matchesDynamicSearch(machines[0], "SN-001", "details.serialNumber"), true);
  assert.equal(matchesDynamicSearch(machines[0], "alpha", ALL_FIELDS_TOKEN), true);
  assert.equal(matchesDynamicSearch({ tags: ["Critical", "Safety"] }, "safety", "tags"), true);
  assert.equal(matchesDynamicSearch(machines[0], "hidden-foreign-key", ALL_FIELDS_TOKEN), false);
  assert.equal(matchesDynamicSearch(machines[0], "anything"), false);
  assert.equal(matchesDynamicSearch(machines[0], "  "), true);
});
