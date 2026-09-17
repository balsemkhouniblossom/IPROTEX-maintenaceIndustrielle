import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inferRequiredRoleFromPath } from '../src/services/sessionGuard.ts';
import {
  averageSavedValues,
  buildHistoricalMatrix,
  parseManualDefectCount,
  parseManualMttrMinutes,
  sumSavedDefectValues,
} from '../src/services/productQualityMttr.ts';

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

test('uses one numeric MTTR-minutes value with a single save action', () => {
  assert.match(page, /parseManualMttrMinutes/);
  assert.match(page, /saveManualProductQualityMttr/);
  assert.match(page, /saveChanges/);
  assert.match(page, /type="number"/);
  assert.match(page, /step="0.01"/);
  assert.match(page, /monthlyMinutesHeading/);
  assert.doesNotMatch(page, /resolvedDefects|totalResolutionMinutes|editingMonth/);
  assert.doesNotMatch(page, /hoursLabel|minutesLabel/);
});

test('empty cells remain null and are not converted to zero', () => {
  assert.equal(parseManualMttrMinutes(''), null);
  assert.equal(parseManualMttrMinutes('0'), 0);
  assert.match(page, /value === null \? ''/);
});

test('historical defect data is supporting context only', () => {
  assert.match(page, /monthlyDefectTitle/);
  assert.match(page, /officialImport/);
  assert.match(page, /defectReadOnly/);
});

test('manual defect counts preserve empty and explicit zero', () => {
  assert.equal(parseManualDefectCount(''), null);
  assert.equal(parseManualDefectCount('0'), 0);
  assert.equal(parseManualDefectCount('2'), 2);
  assert.equal(parseManualDefectCount('2.5'), undefined);
});

test('defect totals use saved values and ignore empty cells', () => {
  assert.equal(sumSavedDefectValues([2, null, 0, 3]), 5);
  assert.match(page, /savedDefectValues/);
  assert.match(page, /processDefectTotals/);
  assert.match(page, /monthlyDefectTotals/);
  assert.match(page, /finalDefectTotal/);
  assert.doesNotMatch(page, /sumSavedDefectValues\([^)]*draftDefectValues/);
});

test('one Save Changes action sends MTTR and defect drafts together', () => {
  assert.match(page, /defectEntries: changedDefectEntries/);
  assert.equal((page.match(/t\('saveChanges'\)/g) ?? []).length, 1);
  assert.doesNotMatch(page, /onBlur=/);
});

test('averages exclude empty cells and use saved numeric values', () => {
  assert.equal(averageSavedValues([5, 5, 4, null]), 14 / 3);
  assert.equal(averageSavedValues([null, null]), null);
  assert.equal(averageSavedValues([0, null, 2]), 1);
});

test('historical matrix calculates process, month, and final totals', () => {
  const matrix = buildHistoricalMatrix([
    { process: 'Braiding', month: 1, defectCount: 1, defectCodes: ['F108'] },
    { process: 'Braiding', month: 2, defectCount: 2, defectCodes: ['F205'] },
    { process: 'Cutting', month: 1, defectCount: 3, defectCodes: ['F201'] },
  ]);
  expectEqual(matrix.processes.find((row) => row.process === 'Braiding')?.total, 3);
  assert.equal(matrix.monthlyTotals[0], 4);
  assert.equal(matrix.monthlyTotals[1], 2);
  assert.equal(matrix.finalTotal, 6);
});

function expectEqual(actual: unknown, expected: unknown) {
  assert.equal(actual, expected);
}

test('saved summaries are derived from savedValues, not draftValues', () => {
  assert.match(page, /processAverages[\s\S]*savedMttr/);
  assert.match(page, /monthlyAverages[\s\S]*savedMttr/);
  assert.match(page, /overallAverage[\s\S]*savedMttr/);
  assert.doesNotMatch(page, /averageSavedValues\([^)]*draftValues/);
});

test('dirty year change requires explicit discard and save is the only persistence action', () => {
  assert.match(page, /if \(isDirty\) setPendingYear/);
  assert.match(page, /discardAndChangeYear/);
  assert.match(page, /unsavedChanges/);
  assert.doesNotMatch(page, /onBlur=/);
  assert.match(page, /onChange=.*setDraftValues/);
});

test('frontend calls the dedicated manual endpoints', () => {
  assert.match(api, /getManualProductQualityMttr/);
  assert.match(api, /saveManualProductQualityMttr/);
  assert.match(api, /quality\/product-mttr\/manual/);
});

test('all six locales include the simplified manual UI labels', () => {
  for (const locale of ['en', 'fr', 'ar', 'es', 'de', 'it']) {
    const messages = JSON.parse(fs.readFileSync(`messages/${locale}.json`, 'utf8'));
    for (const key of ['manualDescription', 'manualInputHelp', 'manualSaved', 'saveChanges', 'monthlyDefectTitle', 'monthlyDefectHelp', 'officialImport', 'defectCellLabel', 'finalTotalDefects']) {
      assert.ok(messages.productQualityMttr[key], `${locale}.${key}`);
    }
  }
});
