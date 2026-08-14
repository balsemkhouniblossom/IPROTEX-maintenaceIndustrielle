#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');

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

const gitExecutable = [
  '/usr/bin/git',
  '/bin/git',
  String.raw`C:\Program Files\Git\cmd\git.exe`,
  String.raw`C:\Program Files\Git\bin\git.exe`,
  String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
  String.raw`C:\Program Files (x86)\Git\bin\git.exe`,
].find((candidate) => existsSync(candidate));

if (!gitExecutable) {
  console.error('Unable to locate git in a fixed system install directory.');
  process.exit(1);
}

const output = execFileSync(gitExecutable, ['ls-files', ...forbiddenPaths], {
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
