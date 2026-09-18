const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('coverage/lcov.info', 'utf8');
const files = [];
let cur = null, lf = 0, lh = 0;
for (const l of content.split('\n')) {
  if (l.startsWith('SF:')) { if (cur) files.push({file: cur, LF: lf, LH: lh}); cur = l.substring(3).trim(); lf = 0; lh = 0; }
  else if (l.startsWith('LF:')) lf = parseInt(l.substring(3), 10);
  else if (l.startsWith('LH:')) lh = parseInt(l.substring(3), 10);
}
if (cur) files.push({file: cur, LF: lf, LH: lh});

// Read exclusions from sonar-project.properties
const props = fs.readFileSync('../sonar-project.properties', 'utf8');
const exclLine = props.split('\n').find(l => l.startsWith('sonar.coverage.exclusions='));
const patterns = exclLine.substring('sonar.coverage.exclusions='.length).split(',').map(p => p.trim());

function normalize(p) {
  return p.replace(/\\/g, '/');
}

function isExcluded(filePath) {
  const fp = normalize(filePath);
  for (const pattern of patterns) {
    const np = normalize(pattern);
    // Direct match
    if (fp === np) return true;
    if (fp.endsWith('/' + np)) return true;
    // **/ wildcard - convert to regex
    if (np.includes('**/')) {
      const afterStarStar = np.split('**/');
      const before = afterStarStar[0];
      const afterParts = afterStarStar[1] ? afterStarStar[1].split('/') : [];
      const fpParts = fp.split('/');
      let matched = true;
      // Check if fp ends with after pattern
      if (afterParts.length > 0) {
        for (let i = 0; i < afterParts.length; i++) {
          const patternPart = afterParts[i];
          const fpIdx = fpParts.length - afterParts.length + i;
          if (fpIdx < 0) { matched = false; break; }
          if (patternPart === '*') continue;
          if (patternPart !== fpParts[fpIdx]) { matched = false; break; }
        }
        if (matched && (fp === before || fp.startsWith(before + '/'))) return true;
      } else if (fp === before || fp.startsWith(before + '/')) {
        return true;
      }
    }
    // Single * wildcard
    if (np.includes('*') && !np.includes('**')) {
      const npParts = np.split('/');
      const fpParts = fp.split('/');
      if (npParts.length !== fpParts.length) continue;
      let matched = true;
      for (let i = 0; i < npParts.length; i++) {
        if (npParts[i] === '*') continue;
        if (npParts[i] !== fpParts[i]) { matched = false; break; }
      }
      if (matched) return true;
    }
    // Exact match (no wildcards)
    if (!np.includes('*') && !np.includes('**')) {
      if (fp === np || fp.endsWith('/' + np)) return true;
    }
  }
  return false;
}

let excluded = [], included = [];
for (const f of files) {
  if (isExcluded(f.file)) excluded.push(f); else included.push(f);
}

console.log('Total files: ' + files.length);
console.log('Excluded: ' + excluded.length + ' lines: ' + excluded.reduce((s, f) => s + f.LF, 0));
console.log('Included: ' + included.length + ' lines: ' + included.reduce((s, f) => s + f.LF, 0));

const incLF = included.reduce((s, f) => s + f.LF, 0);
const incLH = included.reduce((s, f) => s + f.LH, 0);
console.log('Effective coverage: ' + incLH + '/' + incLF + ' = ' + ((incLH/incLF)*100).toFixed(2) + '%');

const sortedIncl = [...included].sort((a, b) => (b.LF - b.LH) - (a.LF - a.LH));
console.log('\n=== TOP 50 UNCOVERED INCLUDED ===');
let rt = 0;
for (const f of sortedIncl.slice(0, 50)) {
  const u = f.LF - f.LH;
  if (u === 0) continue;
  const pct = f.LF > 0 ? ((f.LH/f.LF)*100).toFixed(1) : '0.0';
  rt += u;
  console.log(u.toString().padStart(5) + ' | ' + pct.padStart(6) + '% | ' + f.LF.toString().padStart(5) + ' | ' + f.file.replace(/\\/g, '/'));
}
console.log('Top 50 uncovered total: ' + rt);

const target = Math.ceil(incLF * 0.92);
console.log('\nTarget 92%: ' + target + ' (current ' + incLH + ', need +' + (target - incLH) + ')');

// Also check which service files have specs
const allServiceFiles = [];
function findServices(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findServices(full);
    else if (entry.name.endsWith('.service.ts') && !entry.name.includes('.spec') && !entry.name.includes('.isolated')) {
      allServiceFiles.push(full);
    }
  }
}
findServices('src');
console.log('\nTotal service .ts files: ' + allServiceFiles.length);
let svcWithSpec = 0, svcWithoutSpec = 0;
for (const svc of allServiceFiles) {
  const rel = normalize(svc);
  const spec = rel.replace(/\.ts$/, '.spec.ts');
  const isoSpec = rel.replace(/\.ts$/, '.isolated.spec.ts');
  if (fs.existsSync('src/' + path.basename(path.dirname(svc)) + '/' + path.basename(spec)) || fs.existsSync('src/' + path.basename(path.dirname(svc)) + '/' + path.basename(isoSpec))) {
    svcWithSpec++;
  } else {
    svcWithoutSpec++;
    console.log('No spec: ' + rel);
  }
}
console.log('Services with spec: ' + svcWithSpec + ', without: ' + svcWithoutSpec);
