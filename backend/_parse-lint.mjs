import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const arr = Array.isArray(data) ? data : [data];
let grandTotal = 0;
for (const file of arr) {
  const msgs = file.messages || [];
  if (!msgs.length) continue;
  const rel = file.filePath.replace(/^.*[\\/]src/, 'src');
  console.log(`\n${rel} — ${msgs.length} problem(s)`);
  for (const m of msgs) {
    grandTotal++;
    const rule = m.ruleId || 'n/a';
    const fixable = m.fix ? ' [fixable]' : ' [manual]';
    console.log(`  ${m.line}:${m.column}  ${rule}  ${m.message}${fixable}`);
  }
}
console.log(`\nTOTAL problems reported (no-fix): ${grandTotal}`);
