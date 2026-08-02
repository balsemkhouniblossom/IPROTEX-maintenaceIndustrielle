#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const forbiddenPaths = [
  'backend/uploads',
  'backend/quarantine',
  'backend/logs',
  'backend/tmp',
  'backend/temp',
  'coverage',
  'frontend/coverage',
  'backend/coverage',
  'frontend/lighthouse-reports',
  'backups',
];

const output = execFileSync('git', ['ls-files', ...forbiddenPaths], {
  encoding: 'utf8',
});

const trackedArtifacts = output
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (trackedArtifacts.length > 0) {
  console.error('Tracked runtime/generated artifacts are forbidden:');
  for (const artifact of trackedArtifacts) {
    console.error(artifact);
  }
  process.exit(1);
}

console.log('No tracked runtime/generated artifacts found.');
