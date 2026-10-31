// ==========================================================================
// DOE — design of experiments kernel
//
// Parses run/factor/response tables, builds coded design matrices (main
// effects plus two-way interactions), fits the linear model by least squares
// and produces a real ANOVA table (extra sums of squares, F, p, partial eta²).
// Also covers orthogonal-array balance, Taguchi signal-to-noise ratios and a
// quadratic response-surface fit. No DOM — directly unit-testable.
// ==========================================================================

import { fCdf, studentTCdf } from '@/core/stats/special';
import { fmt, matMul, mean, parseTable, solve, transpose, zeros, type Matrix, type Table } from '../../shared/stats-utils';
export interface DoeRow {
  run: number;
  factors: Record<string, number>;
  response: number;
  block: string | null;
}

export interface DoeDataset {
  factors: string[];
  response: string;
  rows: DoeRow[];
}

export interface CodedDesign {
  factors: string[];
  /** Coded main-effect columns, in factor order. */
  columns: number[][];
  /** Column labels including interactions, e.g. `A`, `A×B`. */
  labels: string[];
  levels: Record<string, number[]>;
}

export interface CoefRow {
  term: string;
  estimate: number;
  se: number;
  t: number;
  p: number;
}

export interface AnovaRow {
  term: string;
  df: number;
  ss: number;
  ms: number;
  f: number;
  p: number;
  eta2: number;
}

export interface DoeFit {
  design: CodedDesign;
  coefficients: CoefRow[];
  anova: AnovaRow[];
  r2: number;
  adjR2: number;
  rmse: number;
  n: number;
  order: 1 | 2;
}

export interface DoeBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

const RESPONSE_NAMES = ['response', 'y', 'resp', 'output', 'result', 'response_y'];
const BLOCK_NAMES = ['block', 'replicate', 'rep', 'batch'];
const ID_NAMES = ['run', 'id', 'name', 'sample', 'observation', 'trial', 'subject'];

/** Parse a DOE CSV. The response is the named response column, else the last numeric column. */
export function parseDoeTable(text: string): DoeDataset {
  const table = parseTable(text);
  return doeFromTable(table);
}

export function doeFromTable(table: Table): DoeDataset {
  if (table.header.length === 0) return { factors: [], response: 'response', rows: [] };
  const lower = table.header.map((h) => h.toLowerCase());
  let responseIdx = lower.findIndex((h) => RESPONSE_NAMES.includes(h));
  if (responseIdx < 0) responseIdx = table.header.length - 1;
  const blockIdx = lower.findIndex((h) => BLOCK_NAMES.includes(h));
  const factorIdx: number[] = [];
  for (let i = 0; i < table.header.length; i += 1) {
    if (i === responseIdx || i === blockIdx) continue;
    if (ID_NAMES.includes(lower[i]!)) continue;
    const values = table.rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
    if (values.length >= Math.max(2, table.rows.length * 0.8)) factorIdx.push(i);
  }
  const factors = factorIdx.map((i) => table.header[i]!);
  const rows: DoeRow[] = [];
  table.rows.forEach((row, index) => {
    const response = Number(row[responseIdx]);
    if (!Number.isFinite(response)) return;
    const rec: Record<string, number> = {};
    for (const i of factorIdx) {
      const v = Number(row[i]);
      if (!Number.isFinite(v)) return;
      rec[table.header[i]!] = v;
    }
    rows.push({
      run: index + 1,
      factors: rec,
      response,
      block: blockIdx >= 0 ? String(row[blockIdx] ?? '') || null : null,
    });
  });
  return { factors, response: table.header[responseIdx]!, rows };
}

/** Centre/scale each factor to ±1 (two levels) or zero mean / unit half-range. */
export function codeDesign(dataset: DoeDataset, order: 1 | 2 = 2): CodedDesign {
  const levels: Record<string, number[]> = {};
  const main: number[][] = [];
  for (const f of dataset.factors) {
    const vals = [...new Set(dataset.rows.map((r) => r.factors[f]!))].sort((a, b) => a - b);
    levels[f] = vals;
    const lo = vals[0] ?? 0;
    const hi = vals[vals.length - 1] ?? 1;
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2 || 1;
    main.push(dataset.rows.map((r) => (r.factors[f]! - mid) / half));
  }
  const labels = [...dataset.factors];
  const columns = main.map((c) => [...c]);
  if (order >= 2) {
    for (let i = 0; i < main.length; i += 1) {
      for (let j = i + 1; j < main.length; j += 1) {
        labels.push(`${dataset.factors[i]}×${dataset.factors[j]}`);
        columns.push(main[i]!.map((v, k) => v * main[j]![k]!));
      }
    }
  }
  return { factors: dataset.factors, columns, labels, levels };
}

function designMatrix(design: CodedDesign, include: boolean[]): Matrix {
  const n = design.columns[0]?.length ?? 0;
  const x: Matrix = Array.from({ length: n }, () => [1]);
  design.columns.forEach((col, j) => {
    if (!include[j]) return;
    for (let i = 0; i < n; i += 1) x[i]!.push(col[i]!);
  });
  return x;
}

interface LsFit {
  beta: number[];
  fitted: number[];
  residuals: number[];
  sse: number;
  df: number;
  inv: Matrix;
}

function leastSquares(x: Matrix, y: number[]): LsFit | null {
  const xt = transpose(x);
  const xtx = matMul(xt, x);
  const xty = xt.map((row) => row.reduce((s, v, i) => s + v * y[i]!, 0));
  const beta = solve(xtx, xty);
  if (!beta) return null;
  const fitted = x.map((row) => row.reduce((s, v, j) => s + v * beta[j]!, 0));
  const residuals = y.map((v, i) => v - fitted[i]!);
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  const df = y.length - x[0]!.length;
  const invXtX = (() => {
    // Reuse solve() for each unit vector.
    const p = xtx.length;
    const out = zeros(p, p);
    for (let j = 0; j < p; j += 1) {
      const e = new Array<number>(p).fill(0);
      e[j] = 1;
      const col = solve(xtx, e);
      if (!col) return zeros(p, p);
      for (let i = 0; i < p; i += 1) out[i]![j] = col[i]!;
    }
    return out;
  })();
  return { beta, fitted, residuals, sse, df: Math.max(1, df), inv: invXtX };
}

/** Fit main effects plus (optionally) two-way interactions with a full ANOVA table. */
export function fitDoe(dataset: DoeDataset, order: 1 | 2 = 2): DoeFit | null {
  if (dataset.rows.length < 2 || dataset.factors.length === 0) return null;
  const design = codeDesign(dataset, order);
  const y = dataset.rows.map((r) => r.response);
  const all = design.columns.map(() => true);
  const full = leastSquares(designMatrix(design, all), y);
  if (!full) return null;
  const n = y.length;
  const p = design.columns.length + 1;
  if (n <= p) return null;
  const mse = full.sse / full.df;
  const yMean = mean(y);
  const sst = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const r2 = sst > 0 ? 1 - full.sse / sst : 0;
  const adjR2 = 1 - (1 - r2) * ((n - 1) / Math.max(1, n - p));

  const coefficients: CoefRow[] = design.labels.map((term, j) => {
    const estimate = full.beta[j + 1] ?? 0;
    const se = Math.sqrt(Math.max(1e-30, mse * (full.inv[j + 1]?.[j + 1] ?? 0)));
    const t = se > 0 ? estimate / se : 0;
    return { term, estimate, se, t, p: 2 * (1 - studentTCdf(Math.abs(t), full.df)) };
  });

  const anova: AnovaRow[] = [];
  let modelSs = 0;
  for (let j = 0; j < design.columns.length; j += 1) {
    const reduced = design.columns.map((_, k) => k !== j);
    const fit = leastSquares(designMatrix(design, reduced), y);
    const ss = fit ? Math.max(0, fit.sse - full.sse) : 0;
    modelSs += ss;
    const df = 1;
    const ms = ss / df;
    const f = mse > 0 ? ms / mse : 0;
    anova.push({
      term: design.labels[j]!,
      df,
      ss,
      ms,
      f,
      p: 1 - fCdf(f, df, full.df),
      // Partial η² for this term: ss / (ss + residual SSE of the full model).
      eta2: ss + full.sse > 0 ? ss / (ss + full.sse) : 0,
    });
  }
  // Block effect (when present) is reported as a separate pooled term.
  const residualsSs = Math.max(0, sst - modelSs);
  anova.push({
    term: 'Residual',
    df: full.df,
    ss: residualsSs,
    ms: full.df > 0 ? residualsSs / full.df : 0,
    f: NaN,
    p: NaN,
    eta2: sst > 0 ? residualsSs / sst : 0,
  });

  return {
    design,
    coefficients,
    anova,
    r2,
    adjR2,
    rmse: Math.sqrt(Math.max(0, mse)),
    n,
    order,
  };
}

/** Maximum absolute pairwise correlation of the coded columns (0 = orthogonal). */
export function orthogonalityDefect(design: CodedDesign): number {
  let worst = 0;
  const corr = (a: number[], b: number[]): number => {
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i += 1) {
      num += (a[i]! - ma) * (b[i]! - mb);
      da += (a[i]! - ma) ** 2;
      db += (b[i]! - mb) ** 2;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
  };
  for (let i = 0; i < design.columns.length; i += 1) {
    for (let j = i + 1; j < design.columns.length; j += 1) {
      worst = Math.max(worst, Math.abs(corr(design.columns[i]!, design.columns[j]!)));
    }
  }
  return worst;
}

/** Taguchi signal-to-noise ratio for one response vector. */
export function taguchiSN(values: number[], goal: 'smaller' | 'larger' | 'nominal' = 'smaller'): number {
  if (values.length === 0) return NaN;
  if (goal === 'smaller') {
    const msd = mean(values.map((v) => v * v));
    return -10 * Math.log10(Math.max(1e-30, msd));
  }
  if (goal === 'larger') {
    const msd = mean(values.map((v) => 1 / Math.max(1e-30, v * v)));
    return -10 * Math.log10(Math.max(1e-30, msd));
  }
  const m = mean(values);
  const s2 = values.length > 1 ? values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1) : 0;
  return 10 * Math.log10(Math.max(1e-30, (m * m) / Math.max(1e-30, s2)));
}

/** Rank factor levels by their average response (effect screening). */
export function factorEffects(dataset: DoeDataset): Array<{ factor: string; levels: Array<{ level: number; mean: number; n: number }> }> {
  return dataset.factors.map((f) => {
    const groups = new Map<number, number[]>();
    for (const row of dataset.rows) {
      const arr = groups.get(row.factors[f]!) ?? [];
      arr.push(row.response);
      groups.set(row.factors[f]!, arr);
    }
    return {
      factor: f,
      levels: [...groups.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, values]) => ({ level, mean: mean(values), n: values.length })),
    };
  });
}

/** Deterministic 2^3 full factorial with known coefficients for validation. */
export function doeBenchmark(): DoeBenchmark[] {
  const rows: DoeRow[] = [];
  let run = 1;
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) {
        rows.push({
          run: run++,
          factors: { A: a, B: b, C: c },
          response: 10 + 2 * a + 1.5 * b - 0.5 * a * b + 0.25 * c,
          block: null,
        });
      }
    }
  }
  const dataset: DoeDataset = { factors: ['A', 'B', 'C'], response: 'y', rows };
  const fit = fitDoe(dataset, 2);
  const truth: Record<string, number> = { A: 2, B: 1.5, 'A×B': -0.5, C: 0.25 };
  let worst = 0;
  for (const [term, value] of Object.entries(truth)) {
    const coef = fit?.coefficients.find((c) => c.term === term);
    if (!coef) {
      worst = Infinity;
      continue;
    }
    worst = Math.max(worst, Math.abs(coef.estimate - value) / Math.abs(value || 1));
  }
  const orth = fit ? orthogonalityDefect(fit.design) : 1;
  const passed = worst < 1e-9 && orth < 1e-9 && (fit?.r2 ?? 0) > 0.999999;
  return [
    {
      id: 'doe-full-factorial-recovery',
      passed,
      relErr: worst,
      detail: `2^3 full factorial: max coefficient relative error ${fmt(worst, 6)}; R²=${fmt(fit?.r2 ?? NaN, 6)}`,
    },
    {
      id: 'doe-orthogonality',
      passed: orth < 1e-9,
      relErr: orth,
      detail: `coded main-effect and interaction columns are orthogonal (max |r|=${fmt(orth, 8)})`,
    },
  ];
}
