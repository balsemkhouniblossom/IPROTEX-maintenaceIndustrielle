const fs = require('fs');
const path = require('path');

const lcovPath = 'coverage/lcov.info';
const content = fs.readFileSync(lcovPath, 'utf8');

const files = [];
let currentFile = null;
let currentLF = 0;
let currentLH = 0;

for (const line of content.split('\n')) {
  if (line.startsWith('SF:')) {
    if (currentFile) files.push({ file: currentFile, LF: currentLF, LH: currentLH });
    currentFile = line.substring(3).trim();
    currentLF = 0;
    currentLH = 0;
  } else if (line.startsWith('LF:')) {
    currentLF = parseInt(line.substring(3), 10);
  } else if (line.startsWith('LH:')) {
    currentLH = parseInt(line.substring(3), 10);
  }
}
if (currentFile) files.push({ file: currentFile, LF: currentLF, LH: currentLH });

// Read full sonar.coverage.exclusions value (may span multiple lines in file)
const sonarProps = fs.readFileSync('../sonar-project.properties', 'utf8');
let exclusionValue = '';
for (const line of sonarProps.split('\n')) {
  if (line.startsWith('sonar.coverage.exclusions=')) {
    exclusionValue = line.substring('sonar.coverage.exclusions='.length);
    break;
  }
}
// The value may be the full line (up to 2448 chars)
const allPatterns = exclusionValue.split(',').map(p => p.trim()).filter(p => p.length > 0);
console.log('Patterns: ' + allPatterns.length);

// Normalize LCOV paths and match against patterns
// LCOV paths use backslashes (e.g. src\app.controller.ts)
// Patterns use forward slashes (e.g. backend/src/**/*.ts)
function isExcluded(filePath, patterns) {
  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  for (const pattern of patterns) {
    const np = pattern.replace(/\\/g, '/').toLowerCase();

    // Extract filename from pattern (last segment after /)
    const patternBasename = np.split('/').pop();

    // Check if basename matches pattern basename (with wildcards)
    if (patternBasename.includes('*')) {
      // Convert wildcard basename to regex
      let regexStr = patternBasename
        .replace(/\./g, '\\.')
        .replace(/\*/g, '[^/]*');
      try {
        const regex = new RegExp('^' + regexStr + '$', 'i');
        if (regex.test(basename)) return true;
      } catch (e) { /* skip */ }
    } else {
      if (basename === patternBasename) return true;
    }

    // Check full path match for non-wildcard patterns
    if (!np.includes('*')) {
      if (fp === np || fp.endsWith('/' + np)) return true;
    }

    // **/wildcard: check if fp ends with pattern after **/
    if (np.includes('**/')) {
      const parts = np.split('**/');
      const before = parts[0]; // path before **/
      const after = parts[1]; // path after **/

      // Check if fp starts with before and ends with after (with **/ matching anything in between)
      const afterSegments = after ? after.split('/') : [];
      const fpSegments = fp.split('/');

      if (afterSegments.length > 0) {
        // Check if fp ends with the after pattern
        const lastFew = fpSegments.slice(-afterSegments.length);
        let match = true;
        for (let i = 0; i < afterSegments.length; i++) {
          if (afterSegments[i] === '*') continue;
          if (afterSegments[i] !== lastFew[i]) { match = false; break; }
        }
        if (match && fp.includes(before + (before ? '/' : ''))) return true;
      } else if (fp.includes(before + (before ? '/' : ''))) {
        return true;
      }
    }
  }
  return false;
}

let excludedFiles = [];
let includedFiles = [];
for (const f of files) {
  if (isExcluded(f.file, allPatterns)) {
    excludedFiles.push(f);
  } else {
    includedFiles.push(f);
  }
}

console.log('Total files: ' + files.length);
console.log('Excluded by Sonar: ' + excludedFiles.length);
console.log('Included by Sonar: ' + includedFiles.length);

const totalLF = files.reduce((s, f) => s + f.LF, 0);
const totalLH = files.reduce((s, f) => s + f.LH, 0);
console.log('Overall: ' + totalLH + '/' + totalLF + ' = ' + ((totalLH/totalLF)*100).toFixed(2) + '%');

if (includedFiles.length > 0) {
  const incLF = includedFiles.reduce((s, f) => s + f.LF, 0);
  const incLH = includedFiles.reduce((s, f) => s + f.LH, 0);
  console.log('Effective: ' + incLH + '/' + incLF + ' = ' + ((incLH/incLF)*100).toFixed(2) + '%');

  const sortedIncl = [...includedFiles].sort((a, b) => (b.LF - b.LH) - (a.LF - a.LH));
  console.log('\n=== TOP 40 INCLUDED FILES BY UNCOVERED LINES ===');
  let runningTotal = 0;
  for (const f of sortedIncl.slice(0, 40)) {
    const uncovered = f.LF - f.LH;
    const pct = f.LF > 0 ? ((f.LH / f.LF) * 100).toFixed(1) : '0.0';
    runningTotal += uncovered;
    console.log(f.uncovered.toString().padStart(5) + ' uncov | ' + pct.padStart(6) + '% | ' + f.LF.toString().padStart(5) + ' LF | ' + f.file);
  }
  console.log('Top 40 total uncovered: ' + runningTotal);

  const targetCoverage = 0.92;
  const targetCovered = Math.ceil(incLF * targetCoverage);
  const needCovered = targetCovered - incLH;
  console.log('\n=== TARGET ===');
  console.log('Current: ' + incLH + '/' + incLF + ' = ' + ((incLH/incLF)*100).toFixed(2) + '%');
  console.log('Target 92%: ' + targetCovered + '/' + incLF + ' = need +' + needCovered + ' lines');
}
