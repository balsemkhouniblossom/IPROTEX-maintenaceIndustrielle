const fs = require('fs');
const path = require('path');

const lcovPath = 'backend/coverage/lcov.info';
const content = fs.readFileSync(lcovPath, 'utf8');

// Parse LCOV
const files = [];
let currentFile = null;
let currentLF = 0;
let currentLH = 0;
let currentLines = [];

for (const line of content.split('\n')) {
  if (line.startsWith('SF:')) {
    if (currentFile) {
      files.push({ file: currentFile, LF: currentLF, LH: currentLH, lines: currentLines });
    }
    currentFile = line.substring(3);
    currentLF = 0;
    currentLH = 0;
    currentLines = [];
  } else if (line.startsWith('LF:')) {
    currentLF = parseInt(line.substring(3), 10);
  } else if (line.startsWith('LH:')) {
    currentLH = parseInt(line.substring(3), 10);
  } else if (line.match(/^DA:(\d+),(\d+)$/)) {
    const match = line.match(/^DA:(\d+),(\d+)$/);
    currentLines.push({ lineNo: parseInt(match[1], 10), hitCount: parseInt(match[2], 10) });
  }
}
if (currentFile) {
  files.push({ file: currentFile, LF: currentLF, LH: currentLH, lines: currentLines });
}

// Sonar coverage exclusions - just use the patterns from sonar-project.properties
const sonarProps = fs.readFileSync('sonar-project.properties', 'utf8');
const coverageExclusions = [];
for (const line of sonarProps.split('\n')) {
  if (line.startsWith('sonar.coverage.exclusions=')) {
    const patterns = line.substring('sonar.coverage.exclusions='.length).split(',');
    for (const p of patterns) coverageExclusions.push(p.trim());
  }
}

function matchesExclusion(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);
  for (const pattern of coverageExclusions) {
    const np = pattern.replace(/\\/g, '/');
    // Simple glob matching: **/ matches any path segment
    if (np === '**/*') return true;
    if (np.startsWith('**/')) {
      const suffix = np.substring(3);
      if (normalized.endsWith(suffix) || basename === suffix || normalized.includes('/' + suffix)) return true;
    }
    if (np.endsWith('/**')) {
      const prefix = np.substring(0, np.length - 3);
      if (normalized.startsWith(prefix)) return true;
    }
    if (normalized.includes(np) || basename === np) return true;
  }
  return false;
}

let excludedFiles = [];
let includedFiles = [];
for (const f of files) {
  if (matchesExclusion(f.file)) {
    excludedFiles.push(f);
  } else {
    includedFiles.push(f);
  }
}

console.log('=== SUMMARY ===');
console.log(`Total files in LCOV: ${files.length}`);
console.log(`Excluded by Sonar: ${excludedFiles.length}`);
console.log(`Included by Sonar: ${includedFiles.length}`);

const totalLF = files.reduce((s, f) => s + f.LF, 0);
const totalLH = files.reduce((s, f) => s + f.LH, 0);
console.log(`Total LF: ${totalLF}, Total LH: ${totalLH}`);
console.log(`Overall coverage: ${((totalLH / totalLF) * 100).toFixed(2)}%`);

const exclLF = excludedFiles.reduce((s, f) => s + f.LF, 0);
const exclLH = excludedFiles.reduce((s, f) => s + f.LH, 0);
console.log(`Excluded LF: ${exclLF}, Excl LH: ${exclLH}`);

const incLF = includedFiles.reduce((s, f) => s + f.LF, 0);
const incLH = includedFiles.reduce((s, f) => s + f.LH, 0);
console.log(`Included LF: ${incLF}, Inc LH: ${incLH}`);
console.log(`Effective coverage: ${(incLH / incLF * 100).toFixed(2)}%`);

// Sort included files by uncovered lines descending
const sortedIncl = [...includedFiles].sort((a, b) => (b.LF - b.LH) - (a.LF - a.LH));

console.log('\n=== TOP 40 INCLUDED FILES BY UNCOVERED LINES ===');
let runningTotal = 0;
for (const f of sortedIncl.slice(0, 40)) {
  const uncovered = f.LF - f.LH;
  const pct = f.LF > 0 ? (f.LH / f.LF * 100).toFixed(1) : '0.0';
  runningTotal += uncovered;
  console.log(`${(f.LF - f.LH).toString().padStart(5)} uncovered | ${pct.padStart(6)}% | ${f.LF.toString().padStart(5)} LF | ${f.file}`);
}
console.log(`Top 40 total uncovered: ${runningTotal}`);

// Find spec files
const allSrcFiles = fs.readdirSync('backend/src', { recursive: true }).filter(f => typeof f === 'string' && f.endsWith('.ts'));
const specFiles = allSrcFiles.filter(f => f.includes('.spec.ts') || f.includes('.isolated.spec.ts'));
console.log(`\n=== SPEC FILES ===`);
console.log(`Total spec/isolated files: ${specFiles.length}`);

// Check which LCOV files have corresponding spec files
const withTests = [];
const withoutTests = [];
for (const f of files) {
  const dir = path.dirname(f.file);
  const basename = path.basename(f.file, path.extname(f.file));
  const specPath = path.join(dir, `${basename}.spec.ts`);
  const isolatedPath = path.join(dir, `${basename}.isolated.spec.ts`);
  const fullSpecPath = path.join('backend', specPath.replace(/\//g, '\\'));
  const fullIsoPath = path.join('backend', isolatedPath.replace(/\//g, '\\'));
  if (fs.existsSync(fullSpecPath) || fs.existsSync(fullIsoPath)) {
    withTests.push(f);
  } else {
    withoutTests.push(f);
  }
}
console.log(`Files with spec tests: ${withTests.length}`);
console.log(`Files without spec tests: ${withoutTests.length}`);

const withoutTestsSorted = [...withoutTests].sort((a, b) => b.LF - a.LF);
console.log('\n=== TOP 40 FILES WITHOUT TESTS (by line count) ===');
for (const f of withoutTestsSorted.slice(0, 40)) {
  console.log(`${f.LF.toString().padStart(5)} lines | ${f.file}`);
}

// Files with tests but low coverage (included)
console.log('\n=== LOW COVERAGE FILES WITH EXISTING TESTS (included, <50%) ===');
const lowCov = withTests.filter(f => !matchesExclusion(f.file) && f.LF > 0 && (f.LH / f.LF) < 0.5);
lowCov.sort((a, b) => (a.LH / a.LF) - (b.LH / b.LF));
for (const f of lowCov.slice(0, 30)) {
  console.log(`${((f.LH / f.LF) * 100).toFixed(1)}% | ${f.LH}/${f.LF} | ${f.file}`);
}
