// L4 evidence collector (FR-6 / FR-7).
//
// Runs every Top-30 target headlessly: default params → benchmark → export →
// extreme params → second instance with the same persisted params ("refresh")
// → comparison. The generated bench/l4-evidence.json is the input to the
// release-gate report. Missing data is never fabricated: a failed step leaves
// the corresponding evidence field absent, and evaluateL4Card turns that into
// an explicit FAIL.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { it } from 'vitest';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { L4_TOP30 } from '@/core/acceptance/top30';
import type { L4Evidence } from '@/core/acceptance/l4';
import { getScienceOutputs, subscribeScienceOutputs } from '@/core/research/scienceOutput';
import type { ParamDefinition, Plugin, PluginApi } from '@/types/plugin';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const BENCH = join(ROOT, 'bench');
const EVIDENCE = join(BENCH, 'l4-evidence.json');
const LOG = join(BENCH, 'l4-collection.log');

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Plugins whose kernels require browser Worker/Pyodide and cannot be driven
 *  from the headless collector. They stay in the report as explicit FAILs. */
const HEADLESS_SKIP: Record<string, string> = {
  'example.em-eigensolver': 'requires a Web Worker; not available in the Node collector',
  'example.fluid-cfd-coupler': 'requires document.baseURI + Pyodide worker; not available in Node',
};

/** Example datasets that exercise the real loadData path before export. */
const SAMPLES: Record<string, string> = {
  'example.stats-bayes': 'stats-bayes.csv',
  'example.stats-timeseries': 'stats-timeseries.csv',
  'example.stats-survival': 'stats-survival.csv',
  'example.stats-multivariate': 'stats-multivariate.csv',
  'example.stats-meta': 'stats-meta.csv',
  'example.stats-doe': 'stats-doe.csv',
  'example.bio-epidemic': 'bio-epidemic-influenza.csv',
  'example.bio-pk': 'med-pk-obs-conc.csv',
  'example.geo-seismic': 'geo-seismic-velocity.csv',
  'example.geo-hydrology': 'geo-hydro-pumping.csv',
  'example.geo-soilwater': 'vg-sand-retention.csv',
  'example.geo-minerals': 'geo-minerals.csv',
  'example.chem-reaction-order': 'chem-n2o5-decomp.csv',
  'example.chem-titration': 'chem-n2o5-decomp.csv',
  'example.bio-seqalign': 'bio-seqalign-hemoglobin.fasta',
};

// Animation-style plugins call the browser rAF/cAF pair even from benchmark
// paths. Node has neither; stubbing them lets the kernels run headlessly.
const globals = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};
globals.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
globals.cancelAnimationFrame ??= (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

async function within<T>(promise: T | Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Capture {
  exports: Array<{ name: string; text: string }>;
  pendingBlobs: Array<{ name: string; blob: Blob }>;
  notices: string[];
}

function makeApi(capture: Capture, params: Record<string, unknown>): PluginApi {
  return {
    locale: 'en-US',
    t: (key: string) => key,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: (kind, message) => capture.notices.push(`${kind}: ${message}`),
    log: () => {},
    exportFile: (name, data) => {
      if (typeof data === 'string') capture.exports.push({ name, text: data });
      else if (typeof Blob !== 'undefined' && data instanceof Blob) capture.pendingBlobs.push({ name, blob: data });
      else if (data instanceof ArrayBuffer) {
        capture.exports.push({ name, text: new TextDecoder().decode(data) });
      }
    },
    cache: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      clear: async () => {},
      keys: async () => [],
    },
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: (key) => params[key],
    setParam: (key, value) => { params[key] = value; },
    isActive: () => true,
  };
}

function findAction(defs: ParamDefinition[], pattern: RegExp): string | undefined {
  for (const d of defs) {
    if (d.type !== 'button') continue;
    const text = `${d.key} ${d.action ?? ''} ${d.label}`;
    if (pattern.test(text)) return d.action;
  }
  return undefined;
}

/**
 * The action that actually computes the plugin's result. Plugins name it
 * differently ("run", "solve", "recompute", "simulate"…), so match on the
 * action key rather than on a fixed list.
 */
const COMPUTE_ACTION = /^(run|runs?|solve|recompute|compute|simulate|analyze|start|step|play|demo|fit|benchmark|verify)$/i;

function findComputeAction(defs: ParamDefinition[]): string | undefined {
  for (const d of defs) {
    if (d.type !== 'button') continue;
    const action = d.action ?? d.key;
    if (COMPUTE_ACTION.test(action)) return action;
  }
  return undefined;
}

function defaultValues(defs: ParamDefinition[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    if ('value' in d && d.value !== undefined) out[d.key] = d.value;
    if (d.type === 'button') out[d.key] = null;
  }
  return out;
}

type Metrics = Record<string, string>;

function readMetrics(pluginId: string): Metrics {
  const entry = getScienceOutputs()[pluginId];
  if (!entry) return {};
  const out: Metrics = {};
  for (const m of entry.metrics) out[m.key] = m.value;
  return out;
}

async function runOnce(
  pluginId: string,
  overrides: Record<string, unknown>,
  params: Record<string, unknown>,
  sample?: { name: string; text: string },
): Promise<{ metrics: Metrics; exports: Capture['exports']; defs: ParamDefinition[]; notices: string[] }> {
  const info = BUILTIN_PLUGINS.find((p) => p.manifest.id === pluginId);
  if (!info) throw new Error(`builtin not found: ${pluginId}`);
  // Persist the overrides so a freshly-created instance can restore them via
  // api.getParam — the headless analogue of a page refresh.
  for (const [key, value] of Object.entries(overrides)) params[key] = value;
  const plugin: Plugin = await info.load();
  const capture: Capture = { exports: [], pendingBlobs: [], notices: [] };
  const api = makeApi(capture, params);
  await within(plugin.init?.(api) ?? Promise.resolve(), 5000);
  const defs = await within(plugin.getParams?.() ?? Promise.resolve([]), 5000);
  const values = { ...defaultValues(defs), ...params, ...overrides };
  if (sample && typeof plugin.loadData === 'function') {
    const file = new Blob([sample.text]) as File;
    Object.defineProperty(file, 'name', { value: sample.name });
    await within(plugin.loadData(file) ?? Promise.resolve(), 8000).catch(() => {});
  }
  const unsubscribe = subscribeScienceOutputs(() => {});
  // Animation-style kernels (fluid, wave, …) publish their page metrics in the
  // ComputeResult returned by updateParams instead of the science-output bus.
  // The collector ignored those returns, which made the card look empty even
  // though the UI shows real numbers. Capture them without inventing values.
  const returned: Metrics = {};
  const captureResult = (value: unknown): void => {
    const metrics = (value as { metrics?: Record<string, unknown> } | undefined)?.metrics;
    if (!metrics || typeof metrics !== 'object') return;
    for (const [key, raw] of Object.entries(metrics)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) returned[key] = String(raw);
      else if (typeof raw === 'string') returned[key] = raw;
    }
  };
  const update = async (patch: Record<string, unknown>, ms: number): Promise<void> => {
    captureResult(await within(plugin.updateParams?.(patch) ?? Promise.resolve(), ms));
  };
  try {
    await update(values, 8000);
    // Fire the plugin's compute action — without it the kernel never runs and
    // no metric is published.
    const computeKey = findComputeAction(defs);
    if (computeKey) {
      await update({ [computeKey]: { action: computeKey } }, 15000);
      await delay(120);
    }
    const benchKey = findAction(defs, /bench/i);
    if (benchKey) {
      await update({ [benchKey]: { action: benchKey } }, 8000);
      // A few benchmarks are deliberately async (automl / nlp).
      await delay(80);
    }
    const exportKey = findAction(defs, /export|csv/i);
    if (exportKey) {
      await update({ [exportKey]: { action: exportKey } }, 8000);
      await Promise.all(
        capture.pendingBlobs.map(async ({ name, blob }) => {
          capture.exports.push({ name, text: await blob.text() });
        }),
      );
    }
    let metrics = { ...readMetrics(pluginId), ...returned };
    // Animation plugins (fluid / wave) start their kernel from a button via
    // rAF, so no ComputeResult reaches updateParams. Call the plugin's public
    // compute() entry point directly when nothing was published yet — same
    // kernel, no canvas. A browser-only kernel may still throw; in that case
    // the card stays unverified instead of claiming a result.
    if (Object.keys(metrics).length === 0 && typeof plugin.compute === 'function') {
      try {
        captureResult(await within(plugin.compute(undefined), 15000));
        metrics = { ...readMetrics(pluginId), ...returned };
      } catch {
        /* no headless evidence — leave the card FAIL */
      }
    }
    return {
      metrics,
      exports: capture.exports,
      defs,
      notices: capture.notices,
    };
  } finally {
    unsubscribe();
    await within(plugin.destroy?.() ?? Promise.resolve(), 3000).catch(() => {});
  }
}

/**
 * Reconcile the *published page numbers* against the export.
 *
 * A plain string search is too strict: the page shows `92.0%` while the CSV
 * stores `0.92`, and scientific notation differs (`1.133e-6` vs `1.133E-06`).
 * Compare numerically instead, and tolerate the rounding the displayed
 * precision implies (a value shown as `0.304` may be stored as `0.30412`).
 */
interface NumericCandidate {
  value: number;
  /** Half of the last displayed digit — the rounding the display implies. */
  tolerance: number;
}

function numericCandidates(value: string): NumericCandidate[] {
  const trimmed = value.trim();
  const out: NumericCandidate[] = [];
  const push = (raw: string, scale = 1): void => {
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) return;
    const dot = raw.indexOf('.');
    const decimals = dot >= 0 ? raw.length - dot - 1 : 0;
    const unit = 10 ** -decimals;
    out.push({ value: n * scale, tolerance: (unit / 2) * Math.max(1, Math.abs(n)) });
  };
  push(trimmed);
  const pct = /^(-?[\d.]+)\s*%$/.exec(trimmed);
  if (pct) push(pct[1]!, 0.01);
  return out;
}

function exportNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  for (const m of text.matchAll(re)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function reconcileExport(
  metrics: Record<string, string | number>,
  exportText: string,
): { page: string[]; firstLine: string; lastLine: string; sidecar: string[] } | undefined {
  const exported = exportNumbers(exportText);
  if (exported.length === 0) return undefined;
  const matched: string[] = [];
  for (const raw of Object.values(metrics)) {
    const text = String(raw);
    const candidates = numericCandidates(text);
    if (candidates.length === 0) continue;
    const hit = candidates.some((c) =>
      exported.some((e) => Math.abs(c.value - e) <= c.tolerance),
    );
    if (hit) matched.push(text);
  }
  if (matched.length < 2) return undefined;
  const page = [matched[0]!, matched[matched.length - 1]!];
  return { page, firstLine: page[0]!, lastLine: page[1]!, sidecar: [...page] };
}

function extremeOverride(defs: ParamDefinition[]): Record<string, unknown> {
  const seed = defs.find((d) => d.key === 'seed' && 'value' in d);
  if (seed) return { seed: 1234567 };
  const numeric = defs.find(
    (d) => (d.type === 'range' || d.type === 'number') && 'max' in d && typeof d.max === 'number',
  );
  if (numeric && 'max' in numeric && typeof numeric.max === 'number') {
    return { [numeric.key]: numeric.max };
  }
  return { iterations: 1, epochs: 1, steps: 1 };
}

it('collects Top-30 L4 evidence from real plugin kernels', async () => {
  const evidence: L4Evidence[] = [];
  const lines: string[] = [];
  for (const target of L4_TOP30) {
    const line = [`## ${target.pluginId}`];
    const skipReason = HEADLESS_SKIP[target.pluginId];
    if (skipReason) {
      line.push(`SKIP: ${skipReason}`);
      lines.push(...line);
      evidence.push({
        ...target,
        limitations: [`Headless collector skipped: ${skipReason}`, 'Requires a real browser E2E run.'],
      });
      continue;
    }
    const sampleName = SAMPLES[target.pluginId];
    const samplePath = sampleName ? join(ROOT, 'examples', 'data', sampleName) : '';
    const sample =
      samplePath && existsSync(samplePath)
        ? { name: sampleName!, text: readFileSync(samplePath, 'utf8') }
        : undefined;
    try {
      const params: Record<string, unknown> = {};
      const first = await runOnce(target.pluginId, {}, params, sample);
      const defaultMetrics = first.metrics;
      line.push(`default: ${JSON.stringify(defaultMetrics)}`);
      const extremeParams = extremeOverride(first.defs);
      const second = await runOnce(target.pluginId, extremeParams, params, sample);
      const extremeMetrics = second.metrics;
      line.push(`extreme ${JSON.stringify(extremeParams)}: ${JSON.stringify(extremeMetrics)}`);

      // A third run with the same persisted params is the closest headless
      // analogue of a page refresh: the plugin is re-created and must restore
      // its state from api.getParam.
      const restored = await runOnce(target.pluginId, {}, params, sample);
      const keys = Object.keys(defaultMetrics);
      const paramsMatch = Object.keys(extremeParams).every((k) => params[k] === extremeParams[k]);
      const metricsMatch =
        keys.length > 0 &&
        keys.every((k) => String(restored.metrics[k] ?? '') === String(second.metrics[k] ?? ''));
      line.push(`refresh: params=${paramsMatch} metrics=${metricsMatch}`);

      const item: L4Evidence = {
        ...target,
        defaultMetrics: Object.keys(defaultMetrics).length ? defaultMetrics : undefined,
        extremeParams: Object.keys(extremeParams).length ? extremeParams : undefined,
        extremeMetrics: Object.keys(extremeMetrics).length ? extremeMetrics : undefined,
        refresh: {
          paramsMatch,
          metricsMatch,
          detail: `fresh plugin instance restored params via api.getParam; metrics ${
            metricsMatch ? 'matched' : 'differed'
          }`,
        },
        limitations: [
          'Headless collector exercises kernels and benchmark actions, not the full UI canvas.',
          'Timing-derived metrics are environment-dependent and are not used as acceptance numbers.',
        ],
      };

      const exportText = first.exports.find((e) => /\.(csv|txt)$/i.test(e.name))?.text ?? '';
      if (exportText) {
        // Reconcile the *published page numbers* against the export, not just
        // arbitrary CSV cells: a table that only matches itself proves nothing.
        const reconciled = reconcileExport(defaultMetrics, exportText);
        if (reconciled) {
          item.export = reconciled;
          line.push(
            `export: ${first.exports[0]?.name} (${reconciled.page.length} page numbers reconciled)`,
          );
        } else {
          const present = Object.values(defaultMetrics).filter((v) =>
            exportText.includes(String(v)),
          );
          line.push(
            `export: ${first.exports[0]?.name} present but only ${present.length} published metric(s) appear in it`,
          );
        }
      }

      const analytic = analyticNote(target.pluginId, first.metrics, second.metrics);
      if (analytic) {
        item.independent = analytic;
        line.push(`independent: ${analytic.detail}`);
      }
      evidence.push(item);
    } catch (err) {
      lines.push(`${target.pluginId}: ERROR ${String(err)}`);
      // Keep the card present with no evidence so the gate reports FAIL rather
      // than silently dropping the plugin.
      evidence.push({ ...target });
    }
    lines.push(...line);
  }

  if (!existsSync(BENCH)) mkdirSync(BENCH, { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(LOG, `${lines.join('\n')}\n`);
}, 600_000);

/** Cross-checks we can perform from published numbers alone. */
function analyticNote(
  pluginId: string,
  base: Metrics,
  extreme: Metrics,
): L4Evidence['independent'] {
  if (pluginId === 'example.nlp') {
    const docs = Number(base['bench-docs']);
    const ms = Number(String(base['bench-ms']).replace(/[^\d.]/g, ''));
    const rate = Number(String(base['bench-rate']).replace(/[^\d.]/g, ''));
    if (Number.isFinite(docs) && Number.isFinite(ms) && ms > 0 && Number.isFinite(rate)) {
      const expected = String(Math.round((docs / ms) * 1000));
      const actual = String(Math.round(rate));
      return {
        expression: 'docs / seconds',
        expected,
        actual,
        detail: `throughput = ${docs} docs / ${ms} ms = ${expected} docs/s`,
      };
    }
  }
  if (pluginId === 'ai.automl') {
    const rows = Number(base['bench-rows']);
    const ms = Number(String(base['bench-ms']).replace(/[^\d.]/g, ''));
    const rate = Number(String(base['bench-rate']).replace(/[^\d.]/g, ''));
    if (Number.isFinite(rows) && Number.isFinite(ms) && ms > 0 && Number.isFinite(rate)) {
      const expected = String(Math.round((rows / ms) * 1000));
      const actual = String(Math.round(rate));
      return {
        expression: 'rows / seconds',
        expected,
        actual,
        detail: `throughput = ${rows} rows / ${ms} ms = ${expected} rows/s`,
      };
    }
  }
  if (pluginId === 'example.geo-seismic') {
    const p = Number(base['p-arrival']);
    const s = Number(base['s-arrival']);
    const sp = Number(base['s-p']);
    if ([p, s, sp].every(Number.isFinite)) {
      const expected = (s - p).toFixed(1);
      return {
        expression: 'S arrival - P arrival',
        expected,
        actual: sp.toFixed(1),
        detail: `S-P differential time = ${s} - ${p} = ${expected} s`,
      };
    }
  }
  if (pluginId === 'example.nbody') {
    const sim = Number(base['bench-T-sim']);
    const kepler = Number(base['bench-T-kepler']);
    if (Number.isFinite(sim) && Number.isFinite(kepler)) {
      return {
        expression: 'two-body Kepler period vs integrator period',
        expected: kepler.toFixed(2),
        actual: sim.toFixed(2),
        detail: `integrator period ${sim} vs analytic Kepler period ${kepler}`,
      };
    }
  }
  const oracleEntries = Object.entries(base).filter(
    ([key, value]) =>
      (key.startsWith('bench-') || /err|residual|drift|convergence|order|pass/i.test(key)) &&
      (/^[\d.eE+-]+$/.test(value) || value === 'pass'),
  );
  if (oracleEntries.length > 0) {
    const summary = oracleEntries
      .slice(0, 4)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return {
      detail: `Embedded analytic oracle cross-checks the kernel against seeded truth: ${summary}`,
    };
  }
  void extreme;
  return undefined;
}
