const fs = require('fs');
const path = require('path');

// Get all source files and their spec files
function findSource(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSource(full, results);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec') && !entry.name.includes('.isolated') && !entry.name.includes('.type-test')) {
      results.push(full);
    }
  }
  return results;
}

const sources = findSource('src');
const allSpecs = findSource('src').filter(f => f.endsWith('.spec.ts') || f.endsWith('.isolated.spec.ts'));

// Map source files to their spec files
const specMap = {};
for (const spec of allSpecs) {
  const dir = path.dirname(spec);
  const base = path.basename(spec);
  // Remove .spec.ts or .isolated.spec.ts
  let srcName;
  if (base.includes('.isolated.spec.ts')) {
    srcName = base.replace('.isolated.spec.ts', '.ts');
  } else {
    srcName = base.replace('.spec.ts', '.ts');
  }
  const srcPath = path.join(dir, srcName);
  specMap[srcPath] = spec;
}

let withSpec = 0, withoutSpec = 0;
let totalLines = 0;
let coveredLines = 0;

// Parse LCOV for coverage data
const lcovContent = fs.readFileSync('coverage/lcov.info', 'utf8');
const coverageMap = {};
let curFile = null, lf = 0, lh = 0;
for (const l of lcovContent.split('\n')) {
  if (l.startsWith('SF:')) {
    if (curFile) coverageMap[curFile] = {LF: lf, LH: lh};
    curFile = l.substring(3).trim();
    lf = 0; lh = 0;
  } else if (l.startsWith('LF:')) lf += parseInt(l.substring(3), 10);
  else if (l.startsWith('LH:')) lh += parseInt(l.substring(3), 10);
}
if (curFile) coverageMap[curFile] = {LF: lf, LH: lh};

for (const src of sources) {
  const rel = src.replace(/\\/g, '/').substring(3); // Remove backend/ prefix for LCOV matching
  // LCOV uses backslashes but relative path
  const lcovPaths = Object.keys(coverageMap);
  // Match by basename
  const srcBase = path.basename(src);
  let cov = null;
  for (const [k, v] of Object.entries(coverageMap)) {
    if (k.endsWith(srcBase)) { cov = v; break; }
  }

  const hasSpec = !!specMap[src];
  if (hasSpec) withSpec++;
  else withoutSpec++;

  if (cov && srcBase.endsWith('.ts') && !srcBase.includes('.spec')) {
    totalLines += cov.LF;
    coveredLines += cov.LH;
  }
}

console.log('Sources: ' + sources.length);
console.log('With spec: ' + withSpec);
console.log('Without spec: ' + withoutSpec);

// Now check: of sources without spec, how many are excluded services?
const excludedServices = [
  'backend/src/email/email.service.ts',
  'backend/src/storage/file-storage.service.ts',
  'backend/src/storage/local-file-storage.provider.ts',
  'backend/src/storage/supabase-storage.provider.ts',
  'backend/src/automation/**/*.ts',
  'backend/src/notifications/notifications.facade.ts',
  'backend/src/notifications/notifications.listener.ts',
];

let noSpecIncluded = 0;
let noSpecExcluded = 0;
for (const src of sources) {
  const rel = src.replace(/\\/g, '/');
  const spec = specMap[src];
  if (spec) continue;
  // Check if excluded
  const isExcl = excludedServices.some(e => rel.includes(e.replace(/backend\//, '').replace(/\*\*.*\*/, '.*')));
  if (isExcl) noSpecExcluded++;
  else noSpecIncluded++;
}
console.log('No spec - excluded: ' + noSpecExcluded);
console.log('No spec - included (need testing): ' + noSpecIncluded);

// Service files specifically without spec
const serviceNoSpec = [];
for (const src of sources) {
  const rel = src.replace(/\\/g, '/');
  if (rel.endsWith('.service.ts')) {
    const spec = specMap[src];
    if (!spec) {
      serviceNoSpec.push(rel);
    }
  }
}
console.log('\nService .ts files without matching spec: ' + serviceNoSpec.length);
for (const s of serviceNoSpec) console.log('  ' + s);
