import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inferRequiredRoleFromPath } from '../src/services/sessionGuard.ts';

const page = fs.readFileSync('src/app/[locale]/quality/product-mttr/page.tsx', 'utf8');
const api = fs.readFileSync('src/services/api.ts', 'utf8');

test('Product Quality route remains Admin-only', () => {
  assert.equal(inferRequiredRoleFromPath('/en/quality/product-mttr'), 'admin');
  assert.match(page, /ProtectedRoute requiredRole="admin"/);
});

test('renders dynamic machine-type rows and all 12 months', () => {
  assert.match(page, /data\?\.processes\.map/);
  assert.match(page, /Array\.from\(\{ length: 12 \}/);
  assert.doesNotMatch(page, /Winding|Cutting|Braiding|Rolling/);
});

test('uses direct manual MTTR values with a single save action', () => {
  assert.match(page, /parseInput/);
  assert.match(page, /saveManualProductQualityMttr/);
  assert.match(page, /saveChanges/);
  assert.doesNotMatch(page, /resolvedDefects|totalResolutionMinutes|editingMonth/);
});

test('empty cells remain null and are not converted to zero', () => {
  assert.match(page, /if \(!trimmed\) return null/);
  assert.match(page, /minutes === null \? ''/);
});

test('historical defect data is supporting context only', () => {
  assert.match(page, /data\?\.historical/);
  assert.match(page, /historicalContextHelp/);
});

test('frontend calls the dedicated manual endpoints', () => {
  assert.match(api, /getManualProductQualityMttr/);
  assert.match(api, /saveManualProductQualityMttr/);
  assert.match(api, /quality\/product-mttr\/manual/);
});

test('all six locales include the simplified manual UI labels', () => {
  for (const locale of ['en', 'fr', 'ar', 'es', 'de', 'it']) {
    const messages = JSON.parse(fs.readFileSync(`messages/${locale}.json`, 'utf8'));
    for (const key of ['manualDescription', 'manualInputHelp', 'manualSaved', 'saveChanges', 'historicalContextHelp']) {
      assert.ok(messages.productQualityMttr[key], `${locale}.${key}`);
    }
  }
});
