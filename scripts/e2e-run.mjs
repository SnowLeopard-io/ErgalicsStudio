// ==========================================================================
// E2E runner — replaces the old `a && b && c…` npm chain.
//
// Why: the chained `test:e2e` stopped at the FIRST failing script, so one
// flaky WebGL verify hid the results of every later script and forced a
// full re-run. This runner executes every requested script, keeps going
// after failures (--continue semantics), prints a pass/fail summary table,
// and exits 1 if any script failed.
//
// Usage:
//   node scripts/e2e-run.mjs                 # all scripts, sequential
//   node scripts/e2e-run.mjs smoke ui        # only the named scripts
//   node scripts/e2e-run.mjs --parallel 3    # run with concurrency 3
//
// Parallel mode is safe port-wise (the shared harness falls back to a free
// port when 4173 is taken) but heavier on browser memory — CI stays on the
// sequential default.
// ==========================================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** name → script file, in the canonical run order. */
const SCRIPTS = {
  smoke: 'smoke-test.mjs',
  ui: 'verify-ui.mjs',
  fixes: 'verify-fixes.mjs',
  '3d': 'verify-3d.mjs',
  plugins: 'verify-plugins.mjs',
  webgpu: 'verify-webgpu.mjs',
  block: 'verify-block-mode.mjs',
  code: 'verify-code-mode.mjs',
  'ai-samples': 'verify-ai-samples.mjs',
  'ai-training': 'verify-ai-training.mjs',
  research: 'verify-research.mjs',
};

/** Parse args: `[names...]` and `--parallel <n>`. Unknown names fail fast. */
function parseArgs(argv) {
  const names = [];
  let parallel = 1;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--parallel') {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 1) {
        console.error('--parallel expects a positive integer, got:', argv[i + 1]);
        process.exit(2);
      }
      parallel = n;
      i += 1;
    } else {
      const key = argv[i].replace(/\.mjs$/, '').replace(/^verify-/, '');
      if (!(key in SCRIPTS)) {
        console.error(`unknown e2e script "${argv[i]}". Known: ${Object.keys(SCRIPTS).join(', ')}`);
        process.exit(2);
      }
      names.push(key);
    }
  }
  return { names: names.length ? names : Object.keys(SCRIPTS), parallel };
}

/** Run one script as a child with inherited stdio; resolve to pass/fail. */
function runOne(key) {
  const file = SCRIPTS[key];
  return new Promise((resolve) => {
    const label = key === 'smoke' ? 'smoke-test.mjs' : file;
    console.log(`\n▶ ${label}`);
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, file)], { stdio: 'inherit' });
    child.on('exit', (code) => {
      const ok = code === 0;
      console.log(`${ok ? '✔' : '✘'} ${label} — ${ok ? 'pass' : `exit ${code}`} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      resolve(ok);
    });
  });
}

/** Simple concurrency pool preserving per-script results. */
async function runPool(keys, limit) {
  const results = new Map();
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next];
      next += 1;
      results.set(key, await runOne(key));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, keys.length) }, worker));
  return results;
}

const { names, parallel } = parseArgs(process.argv.slice(2));
console.log(`e2e runner: ${names.length} script(s), concurrency ${parallel}`);
const results = await runPool(names, parallel);

console.log('\n===== E2E SUMMARY =====');
let failed = 0;
for (const key of names) {
  const ok = results.get(key);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${SCRIPTS[key]}`);
}
console.log(`======================= ${names.length - failed}/${names.length} passed`);

if (failed > 0) process.exit(1);
