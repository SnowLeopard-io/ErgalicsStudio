// Release gate: fail when any L4 acceptance card is FAIL.
// Run after `npm run l4:report` has regenerated bench/l4-report.md.
import { readFileSync } from 'node:fs';

const path = 'bench/l4-report.md';
let report;
try {
  report = readFileSync(path, 'utf8');
} catch {
  console.error(`[l4-gate] missing ${path}; run npm run l4:report first`);
  process.exit(2);
}
const summary = report.split('\n').find((line) => line.startsWith('Plugins:'));
const failed = [...report.matchAll(/^## .+ — FAIL$/gm)].map((m) => m[0].replace(/^## /, ''));
if (failed.length > 0) {
  console.error(`[l4-gate] BLOCKED — ${failed.length} L4 cards failed`);
  for (const line of failed) console.error(`  - ${line}`);
  console.error(`[l4-gate] ${summary ?? ''}`);
  process.exit(1);
}
console.log(`[l4-gate] PASS — ${summary ?? 'all cards passed'}`);
