const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.vercel',
  'artifacts',
  'backups',
  'coverage',
  'dist',
  'node_modules',
  'uploads',
  'quarantine',
]);

const roots = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (ignoredDirectories.has(entry.name)) continue;

    const child = join(directory, entry.name);
    if (existsSync(join(child, 'package.json'))) {
      roots.push(child);
      continue;
    }

    walk(child);
  }
}

if (existsSync('package.json')) {
  roots.push(process.cwd());
}
walk(process.cwd());

const missingLocks = roots.filter((root) => !existsSync(join(root, 'package-lock.json')));
if (missingLocks.length > 0) {
  console.error('Every committed Node project must include package-lock.json:');
  for (const root of missingLocks) console.error(`- ${root}`);
  process.exit(1);
}

for (const root of roots) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || lock.requires !== true) {
    console.error(`Invalid npm lock file format: ${join(root, 'package-lock.json')}`);
    process.exit(1);
  }
}

console.log(`Verified npm lock files for ${roots.length} Node project(s).`);
