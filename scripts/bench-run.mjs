// ==========================================================================
// FR-23 — benchmark runner.
//
// Loads the pure-TS benchmark core (src/core/bench) through Vite's SSR
// module loader (vite is already a devDependency — no new packages) and
// writes the structured result to bench-results.json.
//
//   npm run bench            → run + compare against bench/baseline.json
//   npm run bench:update     → run + overwrite the baseline
//
// --expose-gc (set in the npm script) lets the memory suite take a clean
// heap baseline, keeping the ±10% regression band meaningful.
// ==========================================================================

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'bench-results.json');

const cpuModel = os.cpus()[0]?.model ?? 'unknown';

const server = await createServer({
  root,
  // Minimal inline config: only the '@' alias matters for the bench modules.
  // Deliberately NOT loading vite.config.ts (its vendor plugins are heavy and
  // irrelevant here).
  configFile: false,
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
  // Bench modules are plain TS; skip Vite's dependency pre-bundling entirely
  // (otherwise the scanner crawls dist/ and pages-out/ build output).
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
});

let results;
try {
  const mod = await server.ssrLoadModule('/src/core/bench/index.ts');
  process.stdout.write(`[bench] running suites on ${os.platform()}/${os.arch()} (${process.version})\n`);
  const t0 = Date.now();
  results = mod.runAllBenchmarks(cpuModel);
  const total = Date.now() - t0;
  process.stdout.write(`[bench] done in ${(total / 1000).toFixed(1)}s\n`);
} finally {
  await server.close();
}

// Console summary so a human sees the numbers without opening the report.
for (const suite of results.suites) {
  process.stdout.write(`\n  ${suite.name} (${suite.duration_ms}ms)\n`);
  for (const m of suite.metrics) {
    process.stdout.write(`    ${m.id.padEnd(36)} ${String(m.value).padStart(12)} ${m.unit}\n`);
  }
}

const outDir = path.dirname(outFile);
if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify(results, null, 2), 'utf8');
process.stdout.write(`\n[bench] wrote ${path.relative(root, outFile)}\n`);
