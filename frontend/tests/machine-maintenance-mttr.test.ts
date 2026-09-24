import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('operator submits stop and restart timestamps only for Machine Stopped', () => {
  const source = read('src/app/[locale]/operator/corrective/page.tsx');
  assert.match(source, /urgency === "machineStopped"/);
  assert.match(source, /intervention_started_at/);
  assert.match(source, /intervention_ended_at/);
  assert.match(source, /new Date\(interventionEndedAt\) <= new Date\(interventionStartedAt\)/);
});

test('Admin Machine Maintenance MTTR is separate from Product Quality MTTR', () => {
  const page = read('src/app/[locale]/maintenance-mttr/page.tsx');
  const api = read('src/services/api.ts');
  assert.match(page, /ProtectedRoute requiredRole="admin"/);
  assert.match(page, /getMachineMaintenanceMttr/);
  assert.match(page, /createMachineMaintenanceMttr/);
  assert.match(page, /updateMachineMaintenanceMttr/);
  assert.match(page, /deleteMachineMaintenanceMttr/);
  assert.match(page, /dark:bg-slate-900/);
  assert.match(page, /const \[showForm, setShowForm\]/);
  assert.match(api, /\/machine-maintenance-mttr/);
  assert.doesNotMatch(page, /product-mttr/);
});

test('all locales provide matching Machine Maintenance MTTR and sidebar keys', () => {
  const locales = ['en', 'fr', 'ar', 'es', 'de', 'it'];
  const messages = locales.map((locale) => JSON.parse(read(`messages/${locale}.json`)));
  const keys = messages.map((current) => Object.keys(current.machineMaintenanceMttr).sort());
  for (const current of keys.slice(1)) assert.deepEqual(current, keys[0]);
  for (const current of messages) assert.equal(typeof current.sidebar.navigation.machineMaintenanceMttr, 'string');
});
