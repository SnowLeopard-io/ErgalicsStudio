// ==========================================================================
// XAI kernel — pure explainable-AI logic for the Model Interpreter plugin.
//
// No DOM / host imports: every function is deterministic given (data, seed),
// so a run can be reproduced bit-for-bit. Contents:
//   - seeded RNG (mulberry32) + Gaussian sampler + small stats helpers
//   - CSV parsing (RFC-4180-lite, quoted cells)
//   - reference model: binary logistic regression / ridge regression fitted
//     by gradient descent on z-score standardized features, with a seeded
//     train/test split and held-out accuracy / R²
//   - explanations: permutation importance (metric drop over repeated
//     shuffles), partial dependence (grid over one feature, others at the
//     mean), LIME (local weighted ridge surrogate with an exponential
//     distance kernel), KernelSHAP (sampled coalitions with a fixed seed and
//     a local-accuracy additivity residual), coordinate counterfactual
//     search (minimal L1/L2 change that flips the prediction) and group
//     fairness metrics (demographic parity, equalized odds, disparate
//     impact) for a designated binary sensitive column
//   - deterministic "adult-like" synthetic data generator (sample + benchmark)
// ==========================================================================

export type Rng = () => number;

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box-Muller (two uniforms per call). */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function stdOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = meanOf(xs);
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.sqrt(s / xs.length);
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---- CSV -------------------------------------------------------------------

interface RawTable {
  columns: string[];
  rows: string[][];
}

/** Split one CSV line honouring double-quoted cells with escaped quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a numeric cell; `null` for empty / non-numeric (missing) values. */
function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t || !NUM_RE.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Parse CSV text into a header + string-cell table. `null` if too short. */
function parseTable(text: string): RawTable | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const raw = splitCsvLine(lines[0]!).map((c) => c.trim());
  const seen = new Set<string>();
  const columns = raw.map((h, i) => {
    let name = h || `col${i + 1}`;
    let k = 2;
    while (seen.has(name)) {
      name = `${h}_${k}`;
      k += 1;
    }
    seen.add(name);
    return name;
  });
  const rows = lines.slice(1).map((l) => splitCsvLine(l));
  return { columns, rows };
}

// ---- data ------------------------------------------------------------------

export type XaiTask = 'classification' | 'regression';

export interface XaiData {
  /** All original CSV column names, in file order. */
  columns: string[];
  targetName: string;
  targetIdx: number;
  /** Raw string cells of every kept row (rows with a non-empty target). */
  cells: string[][];
  /** Usable numeric feature names (non-numeric columns are dropped). */
  featureNames: string[];
  /** Raw feature matrix aligned with `cells` / `y`. */
  X: number[][];
  /** Target: 0/1 class codes (classification) or raw values (regression). */
  y: number[];
  task: XaiTask;
  rowCount: number;
  /** Feature columns dropped because they were empty / non-numeric. */
  dropped: string[];
}

/**
 * Parse CSV text for explanation tasks. The last column is the target;
 * a binary target (2 distinct values, numeric or not) yields binary
 * classification, otherwise a numeric target yields regression. Feature
 * columns must be at least half numeric; missing numeric cells are mean
 * imputed, fully non-numeric columns are dropped with a note.
 */
export function parseXaiData(text: string): XaiData {
  const table = parseTable(text);
  if (!table) throw new Error('could not parse CSV input (need a header row plus data rows)');
  const { columns } = table;
  const targetIdx = columns.length - 1;
  if (columns.length < 2) throw new Error('need at least one feature column plus the target column');

  const cells = table.rows.filter((r) => (r[targetIdx] ?? '').trim() !== '');
  if (cells.length < 8) throw new Error('need at least 8 rows with a non-empty target');

  const targetCells = cells.map((r) => (r[targetIdx] ?? '').trim());
  const numericTarget = targetCells.map((c) => parseNum(c));
  let task: XaiTask;
  let y: number[];
  if (numericTarget.every((v) => v !== null)) {
    const vals = numericTarget.map((v) => v!);
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    if (uniq.length === 1) throw new Error('target column has a single value');
    if (uniq.length === 2) {
      task = 'classification';
      const codeOf = new Map(uniq.map((v, i) => [v, i]));
      y = vals.map((v) => codeOf.get(v) ?? 0);
    } else {
      task = 'regression';
      y = vals;
    }
  } else {
    const uniq = [...new Set(targetCells)].sort();
    if (uniq.length !== 2) {
      throw new Error('target must be binary (2 distinct values) or numeric for regression');
    }
    task = 'classification';
    const codeOf = new Map(uniq.map((c, i) => [c, i]));
    y = targetCells.map((c) => codeOf.get(c) ?? 0);
  }

  const featureNames: string[] = [];
  const cols: number[][] = [];
  const dropped: string[] = [];
  for (let c = 0; c < columns.length; c += 1) {
    if (c === targetIdx) continue;
    const name = columns[c]!;
    const col = cells.map((r) => (r[c] ?? '').trim());
    const parsed = col.map((s) => parseNum(s));
    const present = parsed.filter((v): v is number => v !== null);
    if (present.length === 0 || present.length < col.length * 0.5) {
      dropped.push(name);
      continue;
    }
    const mean = meanOf(present);
    featureNames.push(name);
    cols.push(parsed.map((v) => (v === null ? mean : v)));
  }
  if (featureNames.length === 0) throw new Error('no usable numeric feature columns');

  const X: number[][] = Array.from({ length: cells.length }, (_, i) =>
    cols.map((column) => column[i] ?? 0),
  );
  return {
    columns,
    targetName: columns[targetIdx]!,
    targetIdx,
    cells,
    featureNames,
    X,
    y,
    task,
    rowCount: cells.length,
    dropped,
  };
}

export interface SensitiveColumn {
  /** 0/1 group code per data row (aligned with `XaiData.X`). */
  values: number[];
  /** Display names of group 0 and group 1 (sorted cell values). */
  groupNames: [string, string];
}

/**
 * Extract a binary sensitive attribute by column name. Returns `null` when
 * the column is unknown, is the target itself, or does not have exactly two
 * distinct non-empty values.
 */
export function sensitiveColumn(data: XaiData, name: string): SensitiveColumn | null {
  const idx = data.columns.indexOf(name);
  if (idx < 0 || idx === data.targetIdx) return null;
  const distinct = new Set<string>();
  for (const row of data.cells) {
    const v = (row[idx] ?? '').trim();
    if (v !== '') distinct.add(v);
  }
  if (distinct.size !== 2) return null;
  const groups = [...distinct].sort();
  const values = data.cells.map((row) => ((row[idx] ?? '').trim() === groups[1] ? 1 : 0));
  return { values, groupNames: [groups[0]!, groups[1]!] };
}

// ---- reference model -------------------------------------------------------

export interface ReferenceModel {
  task: XaiTask;
  featureNames: string[];
  /** Per-feature raw-space mean (training split), for standardization. */
  means: number[];
  /** Per-feature raw-space std (training split). */
  stds: number[];
  /** Weights in the standardized feature space. */
  weights: number[];
  bias: number;
  /** P(class 1) for classification, raw value for regression. */
  predict: (raw: number[]) => number;
  /** 0/1 class label for classification, predicted value for regression. */
  label: (raw: number[]) => number;
}

export interface TrainSplit {
  trainIdx: number[];
  testIdx: number[];
}

export interface TrainOutcome {
  model: ReferenceModel;
  split: TrainSplit;
  /** Held-out accuracy (classification) or R² (regression). */
  testMetric: number;
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Held-out metric of the model: accuracy for classification, R² otherwise. */
export function metricOf(model: ReferenceModel, X: number[][], y: number[]): number {
  const n = X.length;
  if (n === 0) return 0;
  if (model.task === 'classification') {
    let ok = 0;
    for (let i = 0; i < n; i += 1) {
      if (model.label(X[i]!) === (y[i] === 1 ? 1 : 0)) ok += 1;
    }
    return ok / n;
  }
  let meanY = 0;
  for (let i = 0; i < n; i += 1) meanY += y[i]!;
  meanY /= n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const p = model.predict(X[i]!);
    ssRes += (y[i]! - p) ** 2;
    ssTot += (y[i]! - meanY) ** 2;
  }
  return ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
}

const GD_ITERATIONS = 320;

/**
 * Train the reference model: seeded 75/25 split, z-score standardization
 * from training statistics, then gradient descent on BCE (logistic) or
 * squared loss + L2 (ridge). Deterministic given (data, seed).
 */
export function trainReference(data: XaiData, seed: number): TrainOutcome {
  const n = data.rowCount;
  const d = data.featureNames.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const rng = mulberry32((Math.max(1, Math.round(seed))) >>> 0);
  for (let i = n - 1; i > 0; i -= 1) {
    const k = Math.floor(rng() * (i + 1));
    [idx[i], idx[k]] = [idx[k]!, idx[i]!];
  }
  const nTest = Math.max(2, Math.round(n * 0.25));
  const testIdx = idx.slice(0, nTest).sort((a, b) => a - b);
  const trainIdx = idx.slice(nTest).sort((a, b) => a - b);
  if (trainIdx.length < 4) throw new Error('too few rows for a train/test split');

  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j += 1) {
    const col = trainIdx.map((i) => data.X[i]![j] ?? 0);
    means[j] = meanOf(col);
    const sd = stdOf(col);
    stds[j] = sd < 1e-9 ? 1 : sd;
  }
  const zOf = (raw: number[]): number[] => raw.map((v, j) => (v - means[j]!) / stds[j]!);
  const Ztr = trainIdx.map((i) => zOf(data.X[i]!));

  const classification = data.task === 'classification';
  const lr = classification ? 0.25 : 0.15;
  const l2 = 1e-3;
  const w = new Array<number>(d).fill(0);
  let bias = 0;
  const m = Math.max(1, Ztr.length);
  for (let it = 0; it < GD_ITERATIONS; it += 1) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < Ztr.length; i += 1) {
      const z = Ztr[i]!;
      const target = data.y[trainIdx[i]!] ?? 0;
      let s = bias;
      for (let j = 0; j < d; j += 1) s += (z[j] ?? 0) * w[j]!;
      const err = (classification ? sigmoid(s) : s) - target;
      for (let j = 0; j < d; j += 1) gw[j] = gw[j]! + err * (z[j] ?? 0);
      gb += err;
    }
    for (let j = 0; j < d; j += 1) {
      w[j] = w[j]! - lr * (gw[j]! / m + l2 * w[j]!);
    }
    bias -= lr * (gb / m);
  }

  const predict = (raw: number[]): number => {
    const z = zOf(raw);
    let s = bias;
    for (let j = 0; j < d; j += 1) s += (z[j] ?? 0) * w[j]!;
    return classification ? sigmoid(s) : s;
  };
  const model: ReferenceModel = {
    task: data.task,
    featureNames: data.featureNames.slice(),
    means,
    stds,
    weights: w,
    bias,
    predict,
    label: (raw) => (classification ? (predict(raw) >= 0.5 ? 1 : 0) : predict(raw)),
  };
  const Xte = testIdx.map((i) => data.X[i]!);
  const yte = testIdx.map((i) => data.y[i]!);
  return { model, split: { trainIdx, testIdx }, testMetric: metricOf(model, Xte, yte) };
}

// ---- permutation importance -------------------------------------------------

export interface PermItem {
  feature: string;
  /** Mean baseline-metric drop when the column is shuffled. */
  meanDrop: number;
  /** Std of the drop across repeats. */
  std: number;
}

/**
 * Permutation importance: shuffle one column of the evaluation set
 * (repeats × Fisher-Yates with the seeded RNG) and measure how much the
 * held-out metric (accuracy / R²) degrades.
 */
export function permutationImportance(
  model: ReferenceModel,
  X: number[][],
  y: number[],
  repeats: number,
  rng: Rng,
): PermItem[] {
  const n = X.length;
  const d = model.featureNames.length;
  const base = metricOf(model, X, y);
  const reps = Math.max(1, Math.round(repeats));
  const items: PermItem[] = [];
  for (let j = 0; j < d; j += 1) {
    const drops: number[] = [];
    for (let r = 0; r < reps; r += 1) {
      const perm = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i -= 1) {
        const k = Math.floor(rng() * (i + 1));
        [perm[i], perm[k]] = [perm[k]!, perm[i]!];
      }
      const Xp = X.map((row, i) => {
        const cp = row.slice();
        cp[j] = X[perm[i]!]![j] ?? 0;
        return cp;
      });
      drops.push(base - metricOf(model, Xp, y));
    }
    items.push({ feature: model.featureNames[j] ?? `f${j}`, meanDrop: meanOf(drops), std: stdOf(drops) });
  }
  return items;
}

// ---- partial dependence -----------------------------------------------------

export interface PdpCurve {
  feature: string;
  grid: number[];
  preds: number[];
}

/**
 * Partial dependence: sweep the chosen feature over an even grid spanning
 * its observed range while every other feature is held at its (raw) mean,
 * recording the model output at each grid point.
 */
export function partialDependence(
  model: ReferenceModel,
  X: number[][],
  featureIdx: number,
  points: number,
): PdpCurve {
  const d = model.featureNames.length;
  const j = Math.min(Math.max(0, featureIdx), d - 1);
  const means = new Array<number>(d).fill(0);
  for (let c = 0; c < d; c += 1) {
    const col = X.map((r) => r[c] ?? 0);
    means[c] = meanOf(col);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of X) {
    const v = row[j] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-12) {
    lo = means[j]! - 1;
    hi = means[j]! + 1;
  }
  const p = Math.max(8, Math.min(80, Math.round(points)));
  const grid: number[] = [];
  const preds: number[] = [];
  for (let i = 0; i < p; i += 1) {
    const v = lo + ((hi - lo) * i) / (p - 1);
    const probe = means.slice();
    probe[j] = v;
    grid.push(v);
    preds.push(model.predict(probe));
  }
  return { feature: model.featureNames[j] ?? `f${j}`, grid, preds };
}

// ---- shared linear algebra --------------------------------------------------

/** Solve A·x = b by Gauss-Jordan with partial pivoting. `null` if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r]![col] ?? 0) > Math.abs(M[piv]![col] ?? 0)) piv = r;
    }
    if (Math.abs(M[piv]![col] ?? 0) < 1e-12) return null;
    if (piv !== col) {
      const tmp = M[piv]!;
      M[piv] = M[col]!;
      M[col] = tmp;
    }
    const prow = M[col]!;
    const pv = prow[col]!;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = (M[r]![col] ?? 0) / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) {
        M[r]![c] = (M[r]![c] ?? 0) - f * (prow[c] ?? 0);
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push((M[i]![n] ?? 0) / (M[i]![i] || 1));
  }
  return out;
}

/**
 * Weighted ridge regression via normal equations. `lambdaRel` scales the
 * Tikhonov term relative to the mean diagonal, keeping the solve stable when
 * the design matrix is rank-deficient (few effective coalitions, etc.).
 */
function weightedRidge(
  Z: number[][],
  target: number[],
  w: number[],
  lambdaRel: number,
): number[] | null {
  const p = Z[0]?.length ?? 0;
  if (p === 0) return null;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < Z.length; i += 1) {
    const wi = w[i] ?? 0;
    if (!(wi > 0)) continue;
    const z = Z[i]!;
    for (let a = 0; a < p; a += 1) {
      const za = z[a] ?? 0;
      if (za === 0) continue;
      for (let c = a; c < p; c += 1) {
        A[a]![c] = A[a]![c]! + wi * za * (z[c] ?? 0);
      }
      b[a] = b[a]! + wi * za * (target[i] ?? 0);
    }
  }
  for (let a = 0; a < p; a += 1) {
    for (let c = 0; c < a; c += 1) A[a]![c] = A[c]![a]!;
  }
  let trace = 0;
  for (let a = 0; a < p; a += 1) trace += A[a]![a]!;
  const lambda = 1e-12 + (lambdaRel * trace) / p;
  for (let a = 0; a < p; a += 1) A[a]![a] = A[a]![a]! + lambda;
  return solveLinear(A, b);
}

// ---- LIME -------------------------------------------------------------------

export interface LimeWeight {
  feature: string;
  weight: number;
}

export interface LimeOutcome {
  /** Local surrogate weights, sorted by |weight| descending. */
  weights: LimeWeight[];
  intercept: number;
  /** Weighted R² of the surrogate against the model on the perturbations. */
  localR2: number;
  instancePred: number;
  /** Gaussian kernel width in std units (sqrt(d) × 0.75). */
  kernelWidth: number;
  samples: number;
}

/**
 * LIME: draw perturbations in the standardized feature space around the
 * instance (first sample = the instance itself), weight them with an
 * exponential kernel on the distance to the instance, and fit a weighted
 * ridge surrogate on the standardized features. The surrogate coefficients
 * are the signed local feature contributions.
 */
export function limeExplain(
  model: ReferenceModel,
  instance: number[],
  nSamples: number,
  rng: Rng,
): LimeOutcome {
  const d = model.featureNames.length;
  const zInst = instance.map((v, j) => (v - model.means[j]!) / model.stds[j]!);
  const kernelWidth = Math.sqrt(Math.max(1, d)) * 0.75;
  const n = Math.max(d + 4, Math.min(20000, Math.round(nSamples)));

  const Z1: number[][] = [];
  const preds: number[] = [];
  const ws: number[] = [];
  for (let s = 0; s < n; s += 1) {
    const z =
      s === 0
        ? zInst.slice()
        : Array.from({ length: d }, () => gaussian(rng));
    const raw = z.map((v, j) => v * model.stds[j]! + model.means[j]!);
    let dist = 0;
    for (let j = 0; j < d; j += 1) {
      const dd = (z[j] ?? 0) - (zInst[j] ?? 0);
      dist += dd * dd;
    }
    const wgt = Math.sqrt(Math.exp(-dist / (kernelWidth * kernelWidth)));
    Z1.push([1, ...z]);
    preds.push(model.predict(raw));
    ws.push(wgt);
  }

  const coef = weightedRidge(Z1, preds, ws, 1e-6);
  const weights: LimeWeight[] = [];
  let intercept = 0;
  if (coef) {
    intercept = coef[0] ?? 0;
    for (let j = 0; j < d; j += 1) {
      weights.push({ feature: model.featureNames[j] ?? `f${j}`, weight: coef[j + 1] ?? 0 });
    }
  } else {
    for (let j = 0; j < d; j += 1) {
      weights.push({ feature: model.featureNames[j] ?? `f${j}`, weight: 0 });
    }
  }

  // Weighted R² of the surrogate against the black-box predictions.
  let sw = 0;
  let wMean = 0;
  for (let i = 0; i < Z1.length; i += 1) {
    sw += ws[i]!;
    wMean += ws[i]! * preds[i]!;
  }
  wMean = sw > 1e-12 ? wMean / sw : 0;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < Z1.length; i += 1) {
    let phat = intercept;
    const z = Z1[i]!;
    for (let j = 0; j < d; j += 1) phat += (coef?.[j + 1] ?? 0) * (z[j + 1] ?? 0);
    ssRes += ws[i]! * (preds[i]! - phat) ** 2;
    ssTot += ws[i]! * (preds[i]! - wMean) ** 2;
  }
  const localR2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : ssRes < 1e-12 ? 1 : 0;

  weights.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    weights,
    intercept,
    localR2,
    instancePred: model.predict(instance),
    kernelWidth,
    samples: n,
  };
}

// ---- KernelSHAP -------------------------------------------------------------

export interface ShapAttribution {
  feature: string;
  phi: number;
}

export interface ShapOutcome {
  /** Shapley values in feature order (additive decomposition of f(x)). */
  phis: ShapAttribution[];
  /** Base value E[f(background)] — the background is the training mean. */
  base: number;
  /** Model output at the explained instance. */
  fX: number;
  /** Local-accuracy residual: f(x) − (base + Σφ). */
  residual: number;
  /** Number of distinct coalitions evaluated (incl. empty + full). */
  coalitions: number;
}

/** ln C(d, k) computed by running products of logs (overflow-safe). */
function logBinom(d: number, k: number): number {
  let s = 0;
  for (let i = k + 1; i <= d; i += 1) s += Math.log(i);
  for (let i = 1; i <= d - k; i += 1) s -= Math.log(i);
  return s;
}

/**
 * KernelSHAP approximation with sampled coalitions under an independence
 * background (out-of-coalition features take the training mean). The empty
 * and full coalitions are always anchored with a large weight so the local
 * accuracy property f(x) = base + Σφ holds up to a small residual, which is
 * returned for verification. Fully deterministic given (data, seed).
 */
export function kernelShap(
  model: ReferenceModel,
  background: number[],
  instance: number[],
  nCoalitions: number,
  rng: Rng,
): ShapOutcome {
  const d = model.featureNames.length;
  const base = model.predict(background);
  const fX = model.predict(instance);

  const masks = new Map<string, number[]>();
  const addMask = (m: number[]): void => {
    masks.set(m.join(''), m);
  };
  addMask(new Array<number>(d).fill(0));
  addMask(new Array<number>(d).fill(1));
  const cap = Math.min(Math.max(4, Math.round(nCoalitions)), 2 ** Math.min(d, 30));
  let guard = 0;
  while (masks.size < cap && guard < cap * 20) {
    guard += 1;
    addMask(Array.from({ length: d }, () => (rng() < 0.5 ? 1 : 0)));
  }

  const Z1: number[][] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (const m of masks.values()) {
    let k = 0;
    for (const bit of m) k += bit;
    const raw = m.map((bit, j) => (bit ? instance[j] ?? 0 : background[j] ?? 0));
    const f = model.predict(raw);
    let wgt: number;
    if (k === 0 || k === d) {
      wgt = 1e8; // anchor the local-accuracy property (effectively hard constraint)
    } else {
      const logW = Math.log(d - 1) - logBinom(d, k) - Math.log(k) - Math.log(d - k);
      wgt = Math.exp(logW);
      if (!Number.isFinite(wgt) || wgt < 1e-12) continue;
    }
    Z1.push([1, ...m]);
    ys.push(f);
    ws.push(wgt);
  }

  const coef = weightedRidge(Z1, ys, ws, 1e-9);
  const phis: ShapAttribution[] = [];
  let sum = 0;
  for (let j = 0; j < d; j += 1) {
    const phi = coef?.[j + 1] ?? 0;
    sum += phi;
    phis.push({ feature: model.featureNames[j] ?? `f${j}`, phi });
  }
  return {
    phis,
    base,
    fX,
    residual: fX - (base + sum),
    coalitions: masks.size,
  };
}

// ---- counterfactual search --------------------------------------------------

export interface CounterfactualOutcome {
  featureNames: string[];
  original: number[];
  /** Counterfactual feature vector (raw units). */
  cf: number[];
  /** Per-feature flags of whether the value changed. */
  changed: boolean[];
  predOriginal: number;
  predCf: number;
  costL1: number;
  costL2: number;
  /** Whether the prediction actually flipped to the other side. */
  flipped: boolean;
  /** Decision threshold: 0.5 (classification) or the median prediction. */
  threshold: number;
}

/**
 * Counterfactual search: find a minimal change (L1/L2 in raw units) that
 * moves the prediction to the other side of the decision threshold
 * (0.5 for classification, the median training prediction for regression).
 * Strategy: a single-feature step ladder first (the linear model makes the
 * effect direction of each feature known from its weight sign), a greedy
 * multi-feature fallback if no single feature can flip the prediction, then
 * coordinate descent that shrinks the perturbation while keeping the flip.
 */
export function counterfactualSearch(
  model: ReferenceModel,
  X: number[][],
  instance: number[],
): CounterfactualOutcome {
  const d = model.featureNames.length;
  const original = instance.slice();
  const predOriginal = model.predict(original);
  const threshold =
    model.task === 'classification' ? 0.5 : medianOf(X.map((r) => model.predict(r)));
  const startSide = predOriginal >= threshold;
  const flippedPred = (p: number): boolean => p >= threshold !== startSide;

  // Sign of the raw-feature change that raises the prediction (linear model).
  const raiseSign = model.weights.map((w) => (w >= 0 ? 1 : -1));
  const sign = raiseSign.map((s) => (startSide ? -s : s));

  const predOf = (deltas: number[]): number =>
    model.predict(original.map((v, j) => v + (deltas[j] ?? 0)));
  const costOf = (deltas: number[]): { l1: number; l2: number } => {
    let l1 = 0;
    let sq = 0;
    for (let j = 0; j < d; j += 1) {
      const a = Math.abs(deltas[j] ?? 0);
      l1 += a;
      sq += a * a;
    }
    return { l1, l2: Math.sqrt(sq) };
  };

  // Phase 1: single-feature step ladder (in std units of each feature).
  const LADDER = [0.05, 0.1, 0.2, 0.35, 0.6, 1, 1.6, 2.5, 4, 6, 10];
  let best: number[] | null = null;
  let bestL2 = Infinity;
  for (let j = 0; j < d; j += 1) {
    for (const s of LADDER) {
      const cand = new Array<number>(d).fill(0);
      cand[j] = sign[j]! * s * model.stds[j]!;
      if (flippedPred(predOf(cand))) {
        const { l2 } = costOf(cand);
        if (l2 < bestL2) {
          bestL2 = l2;
          best = cand;
        }
        break; // larger steps of the same feature are strictly costlier
      }
    }
  }

  // Phase 2: greedy multi-feature fill when no single feature can flip.
  if (!best) {
    const order = model.weights
      .map((w, j) => ({ w: Math.abs(w), j }))
      .sort((a, b) => b.w - a.w)
      .map((o) => o.j);
    const cand = new Array<number>(d).fill(0);
    outer: for (let sweep = 0; sweep < 60; sweep += 1) {
      for (const j of order) {
        cand[j] = (cand[j] ?? 0) + sign[j]! * 0.5 * model.stds[j]!;
        if (flippedPred(predOf(cand))) {
          best = cand.slice();
          break outer;
        }
      }
    }
  }

  // Phase 3: coordinate descent — shrink deltas while keeping the flip.
  if (best) {
    let cur = best;
    const SHRINK = [0.9, 0.7, 0.4, 0];
    for (let iter = 0; iter < 80; iter += 1) {
      let improved = false;
      const curCost = costOf(cur).l2;
      for (let j = 0; j < d; j += 1) {
        for (const f of SHRINK) {
          const cand = cur.slice();
          cand[j] = (cand[j] ?? 0) * f;
          if (flippedPred(predOf(cand)) && costOf(cand).l2 < curCost - 1e-15) {
            cur = cand;
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
    best = cur;
  }

  if (!best) {
    return {
      featureNames: model.featureNames.slice(),
      original,
      cf: original.slice(),
      changed: original.map(() => false),
      predOriginal,
      predCf: predOriginal,
      costL1: 0,
      costL2: 0,
      flipped: false,
      threshold,
    };
  }

  const cf = original.map((v, j) => v + (best![j] ?? 0));
  const predCf = model.predict(cf);
  const cost = costOf(best!);
  return {
    featureNames: model.featureNames.slice(),
    original,
    cf,
    changed: original.map((_, j) => Math.abs(best![j] ?? 0) > 1e-9),
    predOriginal,
    predCf,
    costL1: cost.l1,
    costL2: cost.l2,
    flipped: true,
    threshold,
  };
}

// ---- fairness ---------------------------------------------------------------

export interface FairnessGroup {
  name: string;
  support: number;
  /** P(ŷ=1 | group) — demographic parity rate. */
  rate: number;
  /** True-positive rate within the group (NaN when no positives). */
  tpr: number;
  /** False-positive rate within the group (NaN when no negatives). */
  fpr: number;
}

export interface FairnessOutcome {
  groups: [FairnessGroup, FairnessGroup];
  /** Demographic parity difference: rate(G1) − rate(G0). */
  dpDiff: number;
  /** Equalized-odds gaps: |TPR(G1) − TPR(G0)| and |FPR(G1) − FPR(G0)|. */
  tprGap: number;
  fprGap: number;
  /** Disparate impact ratio min(rate)/max(rate) (NaN when undefined). */
  diRatio: number;
}

/**
 * Group fairness of the reference model over an evaluation set for a
 * designated binary sensitive attribute (0/1 values aligned with X / y).
 */
export function fairnessMetrics(
  model: ReferenceModel,
  X: number[][],
  y: number[],
  sensitive: number[],
  groupNames: [string, string],
): FairnessOutcome {
  const n = X.length;
  const build = (g: number): FairnessGroup => {
    let support = 0;
    let pos = 0;
    let positives = 0;
    let negatives = 0;
    let tp = 0;
    let fp = 0;
    for (let i = 0; i < n; i += 1) {
      if (sensitive[i] !== g) continue;
      support += 1;
      const yhat = model.label(X[i]!);
      if (yhat === 1) pos += 1;
      if (y[i] === 1) {
        positives += 1;
        if (yhat === 1) tp += 1;
      } else {
        negatives += 1;
        if (yhat === 1) fp += 1;
      }
    }
    return {
      name: groupNames[g] ?? `group ${g}`,
      support,
      rate: support > 0 ? pos / support : NaN,
      tpr: positives > 0 ? tp / positives : NaN,
      fpr: negatives > 0 ? fp / negatives : NaN,
    };
  };
  const g0 = build(0);
  const g1 = build(1);
  const hi = Math.max(g0.rate, g1.rate);
  const lo = Math.min(g0.rate, g1.rate);
  return {
    groups: [g0, g1],
    dpDiff: g1.rate - g0.rate,
    tprGap: Math.abs(g1.tpr - g0.tpr),
    fprGap: Math.abs(g1.fpr - g0.fpr),
    diRatio: hi > 0 ? lo / hi : NaN,
  };
}

// ---- synthetic "adult-like" data --------------------------------------------

/**
 * Deterministic synthetic "adult-like" census rows: age, weekly hours,
 * education years, spiky capital gains, a binary sensitive attribute (sex,
 * 1 = male majority like the original dataset) and a binary >50K-style
 * target. The target carries real signal in every feature — including a
 * sex-correlated term — so permutation importance, SHAP and the fairness
 * metrics are all non-degenerate.
 */
export function generateAdultLikeSample(rows: number, seed: number): string {
  const rng = mulberry32(seed >>> 0);
  const lines: string[] = ['age,hours,education-years,capital-gain,sex,target'];
  for (let i = 0; i < rows; i += 1) {
    const age = Math.round(18 + 60 * Math.pow(rng(), 1.7));
    const hours = Math.round(clampNum(gaussian(rng) * 8 + 41, 15, 75));
    const edu = Math.round(clampNum(gaussian(rng) * 2.4 + 11.3, 6, 18));
    const gain = rng() < 0.88 ? 0 : Math.round(400 + 24000 * rng() * rng());
    const sex = rng() < 0.67 ? 1 : 0;
    const logit =
      0.045 * (age - 39) +
      0.055 * (hours - 41) +
      0.36 * (edu - 11.3) +
      0.00007 * gain +
      0.85 * sex -
      0.9 +
      gaussian(rng) * 0.6;
    const target = logit > 0 ? 1 : 0;
    lines.push(`${age},${hours},${edu},${gain},${sex},${target}`);
  }
  return lines.join('\n');
}
