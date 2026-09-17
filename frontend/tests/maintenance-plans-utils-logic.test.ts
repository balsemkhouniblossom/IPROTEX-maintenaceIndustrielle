import test from "node:test";
import assert from "node:assert/strict";
import {
  getSelectValue,
  getNextFieldValue,
  mergeOptions,
  cleanInstruction,
  cleanResponsable,
  frequencyLabel,
  frequencyTranslationKey,
  maintenanceTypeLabel,
  STATUS_BADGE_CLASSES,
  CUSTOM_OPTION,
  MAINTENANCE_TYPE_OPTIONS,
} from "../src/app/[locale]/maintenance-plans/utils.ts";

test("getSelectValue returns value if in options", () => {
  assert.equal(getSelectValue(["a", "b", "c"], "b"), "b");
});

test("getSelectValue returns CUSTOM_OPTION when not found", () => {
  assert.equal(getSelectValue(["a", "b"], "c"), CUSTOM_OPTION);
});

test("getNextFieldValue returns selectedValue when not custom", () => {
  assert.equal(getNextFieldValue(["a", "b"], "a", "b"), "b");
});

test("getNextFieldValue returns empty when custom and currentValue in options", () => {
  assert.equal(getNextFieldValue(["a", "b"], "a", CUSTOM_OPTION), "");
});

test("getNextFieldValue returns currentValue when custom and not in options", () => {
  assert.equal(getNextFieldValue(["a", "b"], "c", CUSTOM_OPTION), "c");
});

test("mergeOptions combines and deduplicates", () => {
  assert.deepEqual(mergeOptions(["a", "b"], ["c"]), ["c", "a", "b"]);
});

test("mergeOptions handles empty dynamicValues", () => {
  assert.deepEqual(mergeOptions([], ["a", "b"]), ["a", "b"]);
});

test("mergeOptions trims and deduplicates", () => {
  assert.deepEqual(mergeOptions([" a ", "b"]), ["a", "b"]);
});

test("cleanInstruction removes Photo/Mode:N/A lines", () => {
  assert.equal(
    cleanInstruction("Photo: N/A\nValid line\nMode: N/A"),
    "Valid line",
  );
});

test("cleanInstruction trims whitespace", () => {
  assert.equal(cleanInstruction("  hello  "), "hello");
});

test("cleanInstruction returns empty for undefined", () => {
  assert.equal(cleanInstruction(undefined), "");
});

test("cleanResponsable normalizes technician to Maintenance", () => {
  assert.equal(cleanResponsable("Setup Technician John"), "Maintenance");
});

test("cleanResponsable leaves other values unchanged", () => {
  assert.equal(cleanResponsable("Operator Jane"), "Operator Jane");
});

test("frequencyLabel returns explicit label for loading", () => {
  assert.equal(frequencyLabel(1, "loading", "Custom"), "Custom");
});

test("frequencyLabel returns generic label for unknown unit", () => {
  assert.equal(frequencyLabel(5, "unknown"), "Every 5 unknown");
});

test("frequencyLabel returns singular for frequency 1", () => {
  assert.equal(frequencyLabel(1, "day"), "Every day");
});

test("frequencyLabel returns plural for frequency > 1", () => {
  assert.equal(frequencyLabel(2, "day"), "Every 2 days");
});

test("frequencyTranslationKey returns loading for loading unit", () => {
  assert.equal(frequencyTranslationKey(1, "loading"), "loading");
});

test("frequencyTranslationKey returns singular for 1", () => {
  assert.equal(frequencyTranslationKey(1, "day"), "day");
});

test("frequencyTranslationKey returns plural for > 1", () => {
  assert.equal(frequencyTranslationKey(2, "day"), "days");
});

test("frequencyTranslationKey returns null for invalid frequency", () => {
  assert.equal(frequencyTranslationKey(-1, "day"), null);
  assert.equal(frequencyTranslationKey(0, "day"), null);
});

test("maintenanceTypeLabel handles legacy corrective_history", () => {
  assert.equal(maintenanceTypeLabel("corrective_history"), "Corrective history (legacy)");
});

test("maintenanceTypeLabel capitalizes words", () => {
  assert.equal(maintenanceTypeLabel("preventive maintenance"), "Preventive Maintenance");
});

test("STATUS_BADGE_CLASSES maps all statuses", () => {
  assert.equal(STATUS_BADGE_CLASSES.draft, "bg-slate-100 text-slate-700 border-slate-200");
  assert.equal(STATUS_BADGE_CLASSES.active, "bg-green-100 text-green-800 border-green-200");
  assert.equal(STATUS_BADGE_CLASSES.paused, "bg-amber-100 text-amber-800 border-amber-200");
  assert.equal(STATUS_BADGE_CLASSES.archived, "bg-gray-200 text-gray-600 border-gray-300");
  assert.equal(STATUS_BADGE_CLASSES.completed, "bg-blue-100 text-blue-800 border-blue-200");
});

test("MAINTENANCE_TYPE_OPTIONS is defined", () => {
  assert.ok(MAINTENANCE_TYPE_OPTIONS.length > 0);
});
