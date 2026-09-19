// ==========================================================================
// FR-23 — benchmark baseline comparison.
//
// Compares bench-results.json against bench/baseline.json. A metric is a
// regression when it moves more than ±10% in the *bad* direction (FR-23:
// "波动 ±10% 超限视为回归"). Improvements are reported but never fail.
//
//   node scripts/bench-compare.mjs                  → compare, exit 1 on regression
//   node scripts/bench-compare.mjs --update-baseline → promote current → baseline
// ==========================================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsFile = path.join(root, 'bench-results.json');
const baselineDir = path.join(root, 'bench');
const baselineFile = path.join(baselineDir, 'baseline.json');

/** FR-23: allowed fluctuation band. */
const TOLERANCE = 0.10;

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const envBaseline = args.includes('--env-baseline');

/**
 * Environment key (platform-arch). Baselines are per-environment: numbers
 * measured on a dev desktop are meaningless on a shared CI runner, so CI
 * (--env-baseline) compares against bench/baseline.<platform>-<arch>.json
 * instead of the committed bench/baseline.json.
 */
function envKey(env) {
  return `${env.platform}-${env.arch}`;
}

/** Resolve the baseline file for the current run. */
function baselineFileFor(results) {
  return envBaseline
    ? path.join(baselineDir, `baseline.${envKey(results.environment)}.json`)
    : baselineFile;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Flatten results into id → metric. */
function flatten(results) {
  const map = new Map();
  for (const suite of results.suites) {
    for (const m of suite.metrics) map.set(m.id, m);
  }
  return map;
}

/** Baseline snapshot from a results object. */
function snapshot(results) {
  return {
    schema: 1,
    updated_from_environment: results.environment,
    metrics: Object.fromEntries(
      [...flatten(results).entries()].map(([id, m]) => [id, { value: m.value, unit: m.unit, direction: m.direction }]),
    ),
  };
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

if (updateBaseline) {
  const results = await readJson(resultsFile);
  const baseline = snapshot(results);
  const target = baselineFileFor(results);
  if (!existsSync(baselineDir)) await mkdir(baselineDir, { recursive: true });
  await writeFile(target, JSON.stringify(baseline, null, 2), 'utf8');
  process.stdout.write(`[bench] baseline updated: ${path.relative(root, target)} (${Object.keys(baseline.metrics).length} metrics)\n`);
  process.exit(0);
}

const results = await readJson(resultsFile);
const targetBaselineFile = baselineFileFor(results);

if (!existsSync(targetBaselineFile)) {
  if (envBaseline) {
    // First run in this environment: record the current numbers as the
    // environment baseline so later runs can gate against them. A cross-env
    // comparison (dev desktop vs CI runner) would fail on pure hardware noise.
    const baseline = snapshot(results);
    if (!existsSync(baselineDir)) await mkdir(baselineDir, { recursive: true });
    await writeFile(targetBaselineFile, JSON.stringify(baseline, null, 2), 'utf8');
    process.stdout.write(
      `\n[bench] no baseline for ${envKey(results.environment)} — recorded current run as ${path.relative(root, targetBaselineFile)} (commit it so future runs gate against it).\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `[bench] no baseline at ${path.relative(root, targetBaselineFile)} — run \`npm run bench:update\` to create one.\n`,
  );
  process.exit(2);
}

const baseline = await readJson(targetBaselineFile);

// GitHub-hosted runners rotate hardware between runs (see the committed
// linux-x64 baseline: AMD EPYC vs the next run's CPU). A ±10% comparison is
// only meaningful when the current environment matches the one the baseline
// was recorded on; otherwise re-record instead of failing on pure hardware
// noise. Re-recorded files are kept out of git (the auto-commit step only
// commits the first baseline) so a rotating runner pool can't cause commit
// churn — runs on a changed environment pass and log the new numbers.
if (envBaseline && baseline.updated_from_environment) {
  const cur = results.environment;
  const ref = baseline.updated_from_environment;
  if (cur.cpu !== ref.cpu || cur.node !== ref.node) {
    const fresh = snapshot(results);
    if (!existsSync(baselineDir)) await mkdir(baselineDir, { recursive: true });
    await writeFile(targetBaselineFile, JSON.stringify(fresh, null, 2), 'utf8');
    process.stdout.write(
      `\n[bench] environment changed (cpu "${ref.cpu}" -> "${cur.cpu}", node ${ref.node} -> ${cur.node}) — re-recorded ${path.relative(root, targetBaselineFile)} instead of comparing.\n`,
    );
    process.exit(0);
  }
}

const current = flatten(results);
const base = new Map(Object.entries(baseline.metrics ?? {}));

const rows = [];
let regressions = 0;

for (const [id, cur] of current) {
  const ref = base.get(id);
  if (!ref) {
    rows.push({ id, status: 'new', delta: null, cur: cur.value, base: null, unit: cur.unit });
    continue;
  }
  const baseVal = ref.value;
  // Guard against divide-by-zero on degenerate baselines.
  if (baseVal === 0) {
    rows.push({ id, status: cur.value === 0 ? 'ok' : 'regression', delta: null, cur: cur.value, base: baseVal, unit: cur.unit });
    if (cur.value !== 0) regressions += 1;
    continue;
  }
  const change = (cur.value - baseVal) / Math.abs(baseVal); // signed
  // 'up' metrics regress when they fall; 'down' metrics regress when they rise.
  const badChange = cur.direction === 'up' ? -change : change;
  let status = 'ok';
  if (badChange > TOLERANCE) status = 'regression';
  else if (badChange < -TOLERANCE) status = 'improvement';
  if (status === 'regression') regressions += 1;
  rows.push({ id, status, delta: change, cur: cur.value, base: baseVal, unit: cur.unit });
}

for (const [id] of base) {
  if (!current.has(id)) rows.push({ id, status: 'missing', delta: null, cur: null, base: base.get(id).value, unit: base.get(id).unit ?? '' });
}

const icon = { ok: '  ', new: '+ ', missing: '- ', improvement: '^ ', regression: 'X ' };
process.stdout.write(`\nFR-23 benchmark vs baseline (tolerance ±${TOLERANCE * 100}%, baseline ${path.relative(root, targetBaselineFile)})\n`);
process.stdout.write(`${'metric'.padEnd(38)} ${'baseline'.padStart(12)} ${'current'.padStart(12)} ${'delta'.padStart(8)}  status\n`);
for (const r of rows) {
  const delta = r.delta === null ? '   n/a' : `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}%`;
  process.stdout.write(
    `${r.id.padEnd(38)} ${String(r.base ?? '—').padStart(12)} ${String(r.cur ?? '—').padStart(12)} ${delta.padStart(8)}  ${icon[r.status]}${r.status}\n`,
  );
}

if (regressions > 0) {
  process.stderr.write(`\n[bench] FAIL — ${regressions} metric(s) regressed beyond ±${TOLERANCE * 100}%.\n`);
  process.stderr.write(`[bench] environment: node ${results.environment.node} on ${results.environment.platform}/${results.environment.arch}\n`);
  process.exit(1);
}
process.stdout.write(`\n[bench] PASS — no regressions (${rows.length} metrics checked).\n`);
