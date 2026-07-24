import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = "src/app/[locale]/stocks/page.tsx";

function readPage(): string {
  return fs.readFileSync(path.join(process.cwd(), PAGE_PATH), "utf8");
}

test("apiService exposes a version-safe adjustment endpoint and a movement history endpoint for stocks", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /adjustStock:\s*\(\s*id:\s*string,\s*data:\s*\{\s*delta:\s*number;\s*reason:\s*string;\s*expected_version\?:\s*number;?\s*\}\s*,?\s*\)\s*=>\s*api\.post\(`\/stocks\/\$\{id\}\/adjustment`/,
    "apiService.adjustStock must POST /stocks/:id/adjustment with delta, reason, and an optional expected_version",
  );
  assert.match(
    source,
    /getStockMovements:\s*\([^)]*\)\s*=>\s*api\.get\(`\/stocks\/\$\{id\}\/movements`/,
    "apiService.getStockMovements must GET /stocks/:id/movements",
  );
});

test("Stocks page computes available quantity as stock minus reserved, never storing it separately", () => {
  const source = readPage();

  assert.match(
    source,
    /function available\(item: StockItem\): number \{\s*return \(item\.quantite_en_stock \?\? 0\) - \(item\.quantite_reservee \?\? 0\);/,
    `${PAGE_PATH} must derive available quantity from quantite_en_stock - quantite_reservee`,
  );
});

test("Stocks page only offers Delete once a stock record is fully depleted and has no active reservation", () => {
  const source = readPage();

  assert.match(
    source,
    /function canDelete\(item: StockItem\): boolean \{\s*return \(item\.quantite_en_stock \?\? 0\) === 0 && \(item\.quantite_reservee \?\? 0\) === 0;/,
    `${PAGE_PATH} must only allow deletion when both quantite_en_stock and quantite_reservee are zero`,
  );
  assert.match(
    source,
    /isDeletable\s*\?\s*\(\s*<button\s*\n\s*className="btn-danger p-2"/,
    `${PAGE_PATH} must only render the Delete button when the stock record is deletable`,
  );
});

test("Stocks page sends the currently-loaded version on every adjustment for optimistic concurrency", () => {
  const source = readPage();

  assert.match(
    source,
    /apiService\.adjustStock\(adjustingStock\._id,\s*\{\s*delta,\s*reason:\s*adjustReason\.trim\(\),\s*expected_version:\s*adjustingStock\.version,?\s*\}\)/,
    `${PAGE_PATH} must send expected_version alongside delta and reason when adjusting stock`,
  );
});

test("Stocks page shows a translated confirmation before applying a stock adjustment, and reloads on a version conflict", () => {
  const source = readPage();

  assert.match(
    source,
    /confirm\(\s*t\("notifications\.confirmAdjust",\s*\{\s*delta:\s*formatDelta\(delta\),\s*part:\s*partLabel\(adjustingStock\.part_id\),?\s*\}\),?\s*\)/,
    `${PAGE_PATH} must show a translated confirmation naming the part and the delta before adjusting stock`,
  );
  assert.match(
    source,
    /status === 409/,
    `${PAGE_PATH} must detect a 409 conflict response from a stale adjustment`,
  );
  assert.match(
    source,
    /t\("notifications\.versionConflict"\)/,
    `${PAGE_PATH} must show a translated version-conflict message and reload the latest state`,
  );
});

test("Stocks page shows a translated confirmation before deleting a stock record", () => {
  const source = readPage();

  assert.match(
    source,
    /confirm\(t\("notifications\.confirmDelete"\)\)/,
    `${PAGE_PATH} must show a translated confirmation before deleting a stock record`,
  );
});

test("Stocks page never exposes quantite_en_stock or quantite_reservee through the metadata edit form", () => {
  const source = readPage();

  const updateCallMatch = source.match(/apiService\.updateStock\(editingStock\._id,\s*\{([\s\S]*?)\}\);/);
  assert.ok(updateCallMatch, "apiService.updateStock call must be present");
  const updatePayload = updateCallMatch![1];
  assert.doesNotMatch(
    updatePayload,
    /quantite_en_stock|quantite_reservee/,
    "The metadata update payload must never include quantite_en_stock or quantite_reservee",
  );
});

test("Stocks page offers a movement history view backed by getStockMovements", () => {
  const source = readPage();

  assert.match(
    source,
    /apiService\.getStockMovements\(stock\._id,\s*\{\s*page:\s*1,\s*limit:\s*50\s*\}\)/,
    `${PAGE_PATH} must fetch movement history via apiService.getStockMovements`,
  );
  assert.match(
    source,
    /MOVEMENT_BADGE_CLASSES/,
    `${PAGE_PATH} must render a badge per movement type`,
  );
});

test("all supported locales contain the new stocks translation keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];
  const requiredTableKeys = ["part", "quantity", "reserved", "available", "threshold", "location"];
  const requiredActionKeys = ["edit", "delete", "cancel", "create", "update", "adjust", "history", "apply"];
  const requiredNotificationKeys = [
    "loadFailed",
    "stockCodeRequired",
    "partRequired",
    "quantityNonNegative",
    "confirmDelete",
    "deleteSuccess",
    "deleteFailed",
    "createSuccess",
    "updateSuccess",
    "saveFailed",
    "deltaRequired",
    "reasonRequired",
    "confirmAdjust",
    "adjustSuccess",
    "adjustFailed",
    "versionConflict",
    "historyLoadFailed",
  ];
  const requiredMovementTypeKeys = ["reservation", "consumption", "return", "adjustment", "cancellation"];

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const stocks = messages.stocks;
    assert.ok(stocks, `${locale}.json must have a stocks namespace`);

    for (const key of requiredTableKeys) {
      assert.ok(
        typeof stocks.table?.[key] === "string" && stocks.table[key].length > 0,
        `${locale}.json stocks.table.${key} must be a non-empty string`,
      );
    }
    for (const key of requiredActionKeys) {
      assert.ok(
        typeof stocks.actions?.[key] === "string" && stocks.actions[key].length > 0,
        `${locale}.json stocks.actions.${key} must be a non-empty string`,
      );
    }
    for (const key of requiredNotificationKeys) {
      assert.ok(
        typeof stocks.notifications?.[key] === "string" && stocks.notifications[key].length > 0,
        `${locale}.json stocks.notifications.${key} must be a non-empty string`,
      );
    }
    for (const key of requiredMovementTypeKeys) {
      assert.ok(
        typeof stocks.movementTypes?.[key] === "string" && stocks.movementTypes[key].length > 0,
        `${locale}.json stocks.movementTypes.${key} must be a non-empty string`,
      );
    }
    assert.match(
      stocks.notifications.confirmAdjust,
      /\{delta\}/,
      `${locale}.json stocks.notifications.confirmAdjust must interpolate {delta}`,
    );
    assert.match(
      stocks.notifications.confirmAdjust,
      /\{part\}/,
      `${locale}.json stocks.notifications.confirmAdjust must interpolate {part}`,
    );
  }
});
