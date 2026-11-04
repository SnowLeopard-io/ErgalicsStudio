// ==========================================================================
// AutoML kernel — pure machine-learning logic for the AutoML Pipeline plugin.
//
// No DOM imports: every function is deterministic given (data, seed), so a
// run can be reproduced bit-for-bit. The only exception is the wall-clock
// time budget, which may truncate a search on very slow machines; the
// default budget is never hit for the embedded sample.
//
// Contents:
//   - seeded RNG (mulberry32) + Gaussian sampler
//   - CSV parsing (RFC-4180-lite, quoted cells)
//   - preprocessing: mean imputation, z-score standardization, one-hot
//     encoding of low-cardinality string columns, feature selection by
//     variance threshold + |correlation with target| ranking
//   - models from scratch: ridge regression (gradient descent), logistic
//     regression (GD, one-vs-rest), k-NN, Gaussian naive Bayes,
//     depth-limited CART (Gini / variance reduction)
//   - hyperparameter search: grid, random, and a simple Bayesian-ish scheme
//     (random perturbations around the current best)
//   - K-fold cross-validation and metrics: accuracy, macro-F1, rank-based
//     AUC, RMSE, R²
//   - synthetic dataset generator (embedded sample + benchmark data)
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
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- basic statistics ------------------------------------------------------

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

function varianceOf(xs: number[]): number {
  return stdOf(xs) * stdOf(xs);
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

// ---- CSV -------------------------------------------------------------------

export interface RawTable {
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
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t || !NUM_RE.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Parse CSV text into a header + string-cell table. `null` if too short. */
export function parseTable(text: string): RawTable | null {
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

// ---- data preparation ------------------------------------------------------

export type Task = 'classification' | 'regression';

/** Max unique values for a numeric target to still count as classification. */
const MAX_NUMERIC_CLASSES = 10;
/** Max categories kept for one-hot encoding; wider columns are dropped. */
const MAX_ONEHOT = 12;
/** Columns whose (imputed) variance falls below this are treated as constant. */
const VAR_MIN = 1e-12;
/** Hard cap on encoded features kept after correlation ranking. */
const MAX_FEATURES = 10;

interface NumericFeature {
  name: string;
  values: number[];
}

interface CategoricalFeature {
  name: string;
  categories: string[];
  codes: Array<number | null>; // null = missing value
}

export interface Prepared {
  task: Task;
  classNames: string[] | null;
  /** Class codes (classification) or raw target values (regression). */
  y: number[];
  numeric: NumericFeature[];
  categorical: CategoricalFeature[];
  droppedNote: string[];
  rowCount: number;
  targetName: string;
  rawFeatureCount: number;
}

/**
 * Split the table into a typed target and feature columns. Rows with an
 * empty target are discarded. Numeric targets with few unique values are
 * treated as classification labels, otherwise as regression targets.
 */
export function prepareData(table: RawTable, targetName: string | null): Prepared {
  const { columns, rows } = table;
  const tIdx = targetName ? columns.indexOf(targetName) : columns.length - 1;
  if (tIdx < 0) throw new Error(`target column "${targetName ?? '?'}" not found`);
  const featIdx = columns.map((_, i) => i).filter((i) => i !== tIdx);
  if (featIdx.length === 0) throw new Error('the table has no feature columns besides the target');

  const usable = rows.filter((r) => (r[tIdx] ?? '').trim() !== '');
  if (usable.length < 8) throw new Error('need at least 8 rows with a non-empty target');

  const targetCells = usable.map((r) => (r[tIdx] ?? '').trim());
  const targetIsNumeric = targetCells.every((c) => parseNum(c) !== null);

  let task: Task;
  let classNames: string[] | null;
  const y: number[] = [];
  if (targetIsNumeric) {
    const values = targetCells.map((c) => parseNum(c)!);
    const unique = [...new Set(values)].sort((a, b) => a - b);
    if (unique.length >= 2 && unique.length <= MAX_NUMERIC_CLASSES) {
      task = 'classification';
      classNames = unique.map((v) => String(v));
      const codeOf = new Map(unique.map((v, i) => [v, i]));
      values.forEach((v) => y.push(codeOf.get(v) ?? 0));
    } else {
      task = 'regression';
      classNames = null;
      values.forEach((v) => y.push(v));
    }
  } else {
    task = 'classification';
    classNames = [...new Set(targetCells)].sort();
    if (classNames.length < 2) throw new Error('classification target has a single class');
    const codeOf = new Map(classNames.map((c, i) => [c, i]));
    targetCells.forEach((c) => y.push(codeOf.get(c) ?? 0));
  }

  const numeric: NumericFeature[] = [];
  const categorical: CategoricalFeature[] = [];
  const droppedNote: string[] = [];
  for (const i of featIdx) {
    const name = columns[i]!;
    const cells = usable.map((r) => (r[i] ?? '').trim());
    const nonEmpty = cells.filter((c) => c !== '');
    if (nonEmpty.length === 0) {
      droppedNote.push(`${name} (empty)`);
      continue;
    }
    const allNumeric = nonEmpty.every((c) => parseNum(c) !== null);
    if (allNumeric) {
      const parsed = cells.map((c) => parseNum(c));
      const present = parsed.filter((v): v is number => v !== null);
      const mean = meanOf(present);
      numeric.push({ name, values: parsed.map((v) => (v === null ? mean : v)) });
    } else {
      const categories = [...new Set(nonEmpty)].sort();
      if (categories.length < 2) {
        droppedNote.push(`${name} (constant)`);
        continue;
      }
      if (categories.length > MAX_ONEHOT) {
        droppedNote.push(`${name} (high cardinality)`);
        continue;
      }
      const codes = cells.map((c) => (c === '' ? null : categories.indexOf(c)));
      categorical.push({ name, categories, codes });
    }
  }
  if (numeric.length + categorical.length === 0) {
    throw new Error('no usable feature columns (all empty, constant or high-cardinality)');
  }

  return {
    task,
    classNames,
    y,
    numeric,
    categorical,
    droppedNote,
    rowCount: usable.length,
    targetName: columns[tIdx]!,
    rawFeatureCount: featIdx.length,
  };
}

// ---- encoding + feature selection ------------------------------------------

export interface EncodedColumn {
  /** Encoded feature name, e.g. `x1` or `x5_category=B`. */
  name: string;
  /** Source (raw) column name. */
  source: string;
  /** Column values; standardized in place after selection. */
  values: number[];
  /** Imputation mean for numeric sources, `null` for one-hot columns. */
  mean: number | null;
  /** z-score standard deviation (set after selection). */
  std: number | null;
}

export interface Encoded {
  task: Task;
  classNames: string[] | null;
  y: number[];
  matrix: number[][];
  selected: EncodedColumn[];
  rawFeatureCount: number;
  onehot: Record<string, string[]>;
  droppedNote: string[];
  rowCount: number;
  targetName: string;
}

/**
 * One-hot encode categoricals, drop constant columns (variance threshold),
 * rank the survivors by |Pearson correlation with the target| and keep the
 * top MAX_FEATURES, then z-score standardize the kept columns.
 *
 * When `trainIdx` is supplied, feature ranking and the standardisation
 * statistics are computed from those rows only and then applied to every row.
 * Cross-validation passes the fold's training indices here so selection and
 * scaling cannot see the held-out labels (feature-selection leakage).
 */
export function encodeAndSelect(p: Prepared, trainIdx?: number[]): Encoded {
  const useIdx = trainIdx && trainIdx.length > 1 ? trainIdx : null;
  const pick = (values: number[]): number[] =>
    useIdx ? useIdx.map((i) => values[i] ?? 0) : values;
  const cols: EncodedColumn[] = [];
  const onehot: Record<string, string[]> = {};
  for (const f of p.numeric) {
    cols.push({ name: f.name, source: f.name, values: f.values.slice(), mean: meanOf(f.values), std: null });
  }
  for (const f of p.categorical) {
    onehot[f.name] = f.categories.slice();
    for (let k = 0; k < f.categories.length; k += 1) {
      cols.push({
        name: `${f.name}=${f.categories[k]}`,
        source: f.name,
        values: f.codes.map((c) => (c === k ? 1 : 0)),
        mean: null,
        std: null,
      });
    }
  }

  // Variance threshold: constant columns carry no information.
  const kept = cols.filter((c) => varianceOf(pick(c.values)) >= VAR_MIN);

  // Correlation-with-target ranking (deterministic tie-break by name).
  const scored = kept
    .map((c) => ({ col: c, corr: Math.abs(pearson(pick(c.values), pick(p.y))) }))
    .sort((a, b) => b.corr - a.corr || a.col.name.localeCompare(b.col.name));
  const selected = scored.slice(0, MAX_FEATURES).map((s) => s.col);

  // z-score standardization using training statistics only.
  for (const c of selected) {
    const m = meanOf(pick(c.values));
    const sd = stdOf(pick(c.values));
    c.mean = m;
    c.std = sd < 1e-9 ? 1 : sd;
    c.values = c.values.map((v) => (v - m) / c.std!);
  }

  const matrix: number[][] = Array.from({ length: p.rowCount }, (_, i) =>
    selected.map((c) => c.values[i] ?? 0),
  );

  return {
    task: p.task,
    classNames: p.classNames,
    y: p.y,
    matrix,
    selected,
    rawFeatureCount: p.rawFeatureCount,
    onehot,
    droppedNote: p.droppedNote,
    rowCount: p.rowCount,
    targetName: p.targetName,
  };
}

// ---- models ----------------------------------------------------------------

interface FoldModel {
  predict: (x: number[]) => number;
  /** P(class 1) estimate, only provided for binary classification. */
  score?: (x: number[]) => number;
}

const RIDGE_ITERATIONS = 150;
const RIDGE_LEARNING_RATE = 0.1;
const LOGISTIC_ITERATIONS = 200;

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Ridge regression (squared loss + L2) fitted by plain gradient descent. */
function ridgeFit(X: number[][], y: number[], alpha: number): (x: number[]) => number {
  const n = Math.max(1, X.length);
  const f = X[0]?.length ?? 0;
  const w = new Array<number>(f).fill(0);
  let b = 0;
  for (let it = 0; it < RIDGE_ITERATIONS; it += 1) {
    const gw = new Array<number>(f).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i += 1) {
      const row = X[i]!;
      let p = b;
      for (let j = 0; j < f; j += 1) p += (row[j] ?? 0) * w[j]!;
      const e = p - y[i]!;
      for (let j = 0; j < f; j += 1) gw[j]! += e * (row[j] ?? 0);
      gb += e;
    }
    for (let j = 0; j < f; j += 1) {
      w[j] = w[j]! - RIDGE_LEARNING_RATE * (gw[j]! / n + alpha * w[j]!);
    }
    b -= RIDGE_LEARNING_RATE * (gb / n);
  }
  return (x) => {
    let p = b;
    for (let j = 0; j < f; j += 1) p += (x[j] ?? 0) * w[j]!;
    return p;
  };
}

/** Binary logistic regression via gradient descent on the BCE loss. */
function logisticBinaryFit(
  X: number[][],
  t: number[],
  lr: number,
  l2: number,
): (x: number[]) => number {
  const n = Math.max(1, X.length);
  const f = X[0]?.length ?? 0;
  const w = new Array<number>(f).fill(0);
  let b = 0;
  for (let it = 0; it < LOGISTIC_ITERATIONS; it += 1) {
    const gw = new Array<number>(f).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i += 1) {
      const row = X[i]!;
      let z = b;
      for (let j = 0; j < f; j += 1) z += (row[j] ?? 0) * w[j]!;
      const e = sigmoid(z) - t[i]!;
      for (let j = 0; j < f; j += 1) gw[j]! += e * (row[j] ?? 0);
      gb += e;
    }
    for (let j = 0; j < f; j += 1) {
      w[j] = w[j]! - lr * (gw[j]! / n + l2 * w[j]!);
    }
    b -= lr * (gb / n);
  }
  return (x) => {
    let z = b;
    for (let j = 0; j < f; j += 1) z += (x[j] ?? 0) * w[j]!;
    return sigmoid(z);
  };
}

/** One-vs-rest logistic regression for binary and multiclass problems. */
function logisticOvR(
  X: number[][],
  codes: number[],
  nClasses: number,
  lr: number,
  l2: number,
): FoldModel {
  const clfs: Array<(x: number[]) => number> = [];
  for (let k = 0; k < nClasses; k += 1) {
    clfs.push(logisticBinaryFit(X, codes.map((c) => (c === k ? 1 : 0)), lr, l2));
  }
  return {
    predict: (x) => {
      let best = 0;
      let bp = -Infinity;
      for (let k = 0; k < clfs.length; k += 1) {
        const p = clfs[k]!(x);
        if (p > bp) {
          bp = p;
          best = k;
        }
      }
      return best;
    },
    score: nClasses === 2 ? (x) => clfs[1]!(x) : undefined,
  };
}

/** Gaussian naive Bayes with per-class means/variances and log-joint scores. */
function gnbFit(X: number[][], codes: number[], nClasses: number, varSmoothing: number): FoldModel {
  const n = Math.max(1, X.length);
  const f = X[0]?.length ?? 0;
  const globalVar = new Array<number>(f).fill(1);
  for (let j = 0; j < f; j += 1) {
    globalVar[j] = varianceOf(X.map((r) => r[j] ?? 0));
  }
  const logPrior: number[] = [];
  const means: number[][] = [];
  const vars: number[][] = [];
  for (let c = 0; c < nClasses; c += 1) {
    const idx: number[] = [];
    codes.forEach((v, i) => {
      if (v === c) idx.push(i);
    });
    logPrior.push(Math.log(Math.max(1e-12, idx.length / n)));
    const mu = new Array<number>(f).fill(0);
    const va = new Array<number>(f).fill(1);
    for (let j = 0; j < f; j += 1) {
      const col = idx.map((i) => X[i]![j] ?? 0);
      mu[j] = meanOf(col);
      // Smooth with a fraction of the global variance so zero-variance
      // features never produce a degenerate likelihood.
      va[j] = Math.max(varianceOf(col) + varSmoothing * Math.max(globalVar[j]!, 1), 1e-9);
    }
    means.push(mu);
    vars.push(va);
  }
  const logJoint = (x: number[], c: number): number => {
    let s = logPrior[c]!;
    for (let j = 0; j < f; j += 1) {
      const v = vars[c]![j]!;
      const d = (x[j] ?? 0) - means[c]![j]!;
      s += -0.5 * (Math.log(2 * Math.PI * v) + (d * d) / v);
    }
    return s;
  };
  return {
    predict: (x) => {
      let best = 0;
      let bl = -Infinity;
      for (let c = 0; c < nClasses; c += 1) {
        const lj = logJoint(x, c);
        if (lj > bl) {
          bl = lj;
          best = c;
        }
      }
      return best;
    },
    score:
      nClasses === 2
        ? (x) => {
            const a = logJoint(x, 0);
            const b = logJoint(x, 1);
            const m = Math.max(a, b);
            return Math.exp(b - m) / (Math.exp(a - m) + Math.exp(b - m));
          }
        : undefined,
  };
}

// ---- CART decision tree ----------------------------------------------------

interface TreeNode {
  leaf: boolean;
  pred: number;
  probs: number[] | null;
  feat: number;
  thresh: number;
  left: TreeNode | null;
  right: TreeNode | null;
}

function leafNode(pred: number, probs: number[] | null): TreeNode {
  return { leaf: true, pred, probs, feat: 0, thresh: 0, left: null, right: null };
}

/**
 * Depth-limited CART. Gini impurity for classification, variance reduction
 * for regression. Splits are scanned exhaustively over sorted feature values
 * (deterministic; ties resolve to the first feature / threshold found).
 */
function treeFit(
  X: number[][],
  y: number[],
  task: Task,
  nClasses: number,
  maxDepth: number,
  minLeaf: number,
): FoldModel {
  const f = X[0]?.length ?? 0;
  const binary = task === 'classification' && nClasses === 2;

  const build = (idx: number[], depth: number): TreeNode => {
    let pred = 0;
    let probs: number[] | null = null;
    if (task === 'classification') {
      const counts = new Array<number>(nClasses).fill(0);
      for (const i of idx) counts[y[i]!] = (counts[y[i]!] ?? 0) + 1;
      let bc = -1;
      counts.forEach((c, ci) => {
        if (c > bc) {
          bc = c;
          pred = ci;
        }
      });
      probs = counts.map((c) => c / Math.max(1, idx.length));
      if (bc === idx.length) return leafNode(pred, probs); // pure node
    } else {
      let s = 0;
      for (const i of idx) s += y[i]!;
      pred = idx.length > 0 ? s / idx.length : 0;
    }
    if (depth >= maxDepth || idx.length < 2 * minLeaf || f === 0) {
      return leafNode(pred, probs);
    }

    // Parent statistics for the gain computation.
    const parentCounts =
      task === 'classification'
        ? (() => {
            const c = new Array<number>(nClasses).fill(0);
            for (const i of idx) c[y[i]!] = (c[y[i]!] ?? 0) + 1;
            return c;
          })()
        : null;
    let parentSum = 0;
    let parentSumSq = 0;
    if (task === 'regression') {
      for (const i of idx) {
        parentSum += y[i]!;
        parentSumSq += y[i]! * y[i]!;
      }
    }

    let bestGain = 1e-12;
    let bestFeat = -1;
    let bestThresh = 0;

    for (let j = 0; j < f; j += 1) {
      const sorted = idx.slice().sort((a, b) => (X[a]![j] ?? 0) - (X[b]![j] ?? 0));
      const total = sorted.length;
      const leftCounts = task === 'classification' ? new Array<number>(nClasses).fill(0) : null;
      let leftN = 0;
      let leftSum = 0;
      let leftSumSq = 0;
      for (let t = 0; t + 1 < total; t += 1) {
        const i = sorted[t]!;
        leftN += 1;
        if (leftCounts) leftCounts[y[i]!] = (leftCounts[y[i]!] ?? 0) + 1;
        else {
          leftSum += y[i]!;
          leftSumSq += y[i]! * y[i]!;
        }
        const v1 = X[i]![j] ?? 0;
        const v2 = X[sorted[t + 1]!]![j] ?? 0;
        if (v2 - v1 < 1e-12) continue; // identical values: no split here
        if (leftN < minLeaf || total - leftN < minLeaf) continue;

        let gain: number;
        if (leftCounts && parentCounts) {
          const gini = (counts: number[], n: number): number => {
            let g = 1;
            for (const c of counts) {
              const p = c / Math.max(1, n);
              g -= p * p;
            }
            return g;
          };
          const rightCounts = parentCounts.map((c, ci) => c - leftCounts[ci]!);
          gain =
            gini(parentCounts, total) -
            (leftN / total) * gini(leftCounts, leftN) -
            ((total - leftN) / total) * gini(rightCounts, total - leftN);
        } else {
          const sse = (sum: number, sumSq: number, n: number): number =>
            n > 0 ? Math.max(0, sumSq - (sum * sum) / n) : 0;
          const rightSum = parentSum - leftSum;
          const rightSumSq = parentSumSq - leftSumSq;
          gain =
            sse(parentSum, parentSumSq, total) -
            sse(leftSum, leftSumSq, leftN) -
            sse(rightSum, rightSumSq, total - leftN);
        }
        if (gain > bestGain) {
          bestGain = gain;
          bestFeat = j;
          bestThresh = (v1 + v2) / 2;
        }
      }
    }

    if (bestFeat < 0) return leafNode(pred, probs);
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];
    for (const i of idx) {
      ((X[i]![bestFeat] ?? 0) <= bestThresh ? leftIdx : rightIdx).push(i);
    }
    if (leftIdx.length === 0 || rightIdx.length === 0) return leafNode(pred, probs);
    return {
      leaf: false,
      pred,
      probs,
      feat: bestFeat,
      thresh: bestThresh,
      left: build(leftIdx, depth + 1),
      right: build(rightIdx, depth + 1),
    };
  };

  const root = build(Array.from({ length: X.length }, (_, i) => i), 0);
  const walk = (x: number[]): TreeNode => {
    let node = root;
    while (!node.leaf) {
      node = (x[node.feat] ?? 0) <= node.thresh ? node.left! : node.right!;
    }
    return node;
  };
  return {
    predict: (x) => walk(x).pred,
    score: binary ? (x) => walk(x).probs?.[1] ?? 0 : undefined,
  };
}

// ---- k-NN ------------------------------------------------------------------

function sqdist(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let j = 0; j < n; j += 1) {
    const d = (a[j] ?? 0) - (b[j] ?? 0);
    s += d * d;
  }
  return s;
}

/**
 * For every test row, the training labels sorted by distance (ties broken by
 * training index). Computed once per fold so every k in the grid reuses it.
 */
function knnNeighbors(Xtr: number[][], Xte: number[][], ytr: number[]): number[][] {
  const out: number[][] = [];
  for (const row of Xte) {
    const pairs = Xtr.map((r, i) => ({ d: sqdist(row, r), v: ytr[i]!, i }));
    pairs.sort((a, b) => a.d - b.d || a.i - b.i);
    out.push(pairs.map((p) => p.v));
  }
  return out;
}

// ---- metrics ---------------------------------------------------------------

function accuracyOf(pred: number[], truth: number[]): number {
  let ok = 0;
  for (let i = 0; i < pred.length; i += 1) {
    if (pred[i] === truth[i]) ok += 1;
  }
  return pred.length > 0 ? ok / pred.length : 0;
}

function macroF1Of(pred: number[], truth: number[], nClasses: number): number {
  if (nClasses === 0 || pred.length === 0) return 0;
  let sum = 0;
  for (let c = 0; c < nClasses; c += 1) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < pred.length; i += 1) {
      const p = pred[i] === c;
      const t = truth[i] === c;
      if (p && t) tp += 1;
      else if (p && !t) fp += 1;
      else if (!p && t) fn += 1;
    }
    const denom = 2 * tp + fp + fn;
    sum += denom > 0 ? (2 * tp) / denom : 0;
  }
  return sum / nClasses;
}

/**
 * Rank-based (Mann-Whitney U) AUC with average ranks for ties. Returns 0.5
 * when only one class is present in the fold.
 */
function aucOf(scores: number[], truth: number[]): number {
  const n = scores.length;
  if (n === 0) return 0.5;
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s || a.i - b.i);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]!.s === order[i]!.s) j += 1;
    const avg = (i + j + 2) / 2; // 1-based average rank
    for (let k = i; k <= j; k += 1) ranks[order[k]!.i] = avg;
    i = j + 1;
  }
  let n1 = 0;
  let sumPos = 0;
  for (let k = 0; k < n; k += 1) {
    if (truth[k] === 1) {
      n1 += 1;
      sumPos += ranks[k]!;
    }
  }
  const n0 = n - n1;
  if (n1 === 0 || n0 === 0) return 0.5;
  return (sumPos - (n1 * (n1 + 1)) / 2) / (n0 * n1);
}

function rmseOf(pred: number[], truth: number[]): number {
  let s = 0;
  for (let i = 0; i < pred.length; i += 1) {
    const d = pred[i]! - truth[i]!;
    s += d * d;
  }
  return pred.length > 0 ? Math.sqrt(s / pred.length) : 0;
}

function r2Of(pred: number[], truth: number[]): number {
  const n = pred.length;
  if (n === 0) return 0;
  const m = meanOf(truth);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    ssRes += (truth[i]! - pred[i]!) ** 2;
    ssTot += (truth[i]! - m) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

// ---- hyperparameter search -------------------------------------------------

export type ModelFamily = 'ridge' | 'logistic' | 'knn' | 'gnb' | 'tree';
export type SearchStrategy = 'grid' | 'random' | 'bayesian';

/** Small per-family grids. */
const GRIDS: Record<ModelFamily, Record<string, number[]>> = {
  ridge: { alpha: [0.01, 0.1, 1, 10] },
  logistic: { lr: [0.05, 0.2, 0.5], l2: [0, 0.01] },
  knn: { k: [1, 3, 5, 7, 9, 11] },
  gnb: { varSmoothing: [1e-9, 1e-7, 1e-5, 1e-3] },
  tree: { maxDepth: [3, 5, 7], minLeaf: [1, 4] },
};

/** Evaluation cap per family for the stochastic strategies. */
const MAX_CONFIGS_PER_FAMILY = 12;

function configKey(cfg: Record<string, number>): string {
  return Object.keys(cfg)
    .sort()
    .map((k) => `${k}=${cfg[k]}`)
    .join('|');
}

function enumerateGrid(family: ModelFamily): Record<string, number>[] {
  const grid = GRIDS[family];
  let combos: Record<string, number>[] = [{}];
  for (const key of Object.keys(grid)) {
    const next: Record<string, number>[] = [];
    for (const c of combos) {
      for (const v of grid[key]!) next.push({ ...c, [key]: v });
    }
    combos = next;
  }
  return combos;
}

/**
 * Lazily produce candidate configurations for one family.
 *
 * - grid: the full cartesian product.
 * - random: a seeded shuffle of the product (capped).
 * - bayesian: three random warm-up draws, then perturbations around the
 *   current best config (log-distance nearest grid value ± Gaussian step,
 *   with a 25% chance of a uniform resample). Falls back to unused grid
 *   combinations once proposals repeat.
 */
function makeConfigSource(
  family: ModelFamily,
  strategy: SearchStrategy,
  rng: Rng,
  getBest: () => Record<string, number> | null,
): () => Record<string, number> | null {
  const grid = enumerateGrid(family);
  if (strategy === 'grid') {
    let i = 0;
    return () => (i < grid.length ? grid[i++]! : null);
  }
  if (strategy === 'random') {
    const order = shuffle(grid, rng).slice(0, MAX_CONFIGS_PER_FAMILY);
    let i = 0;
    return () => (i < order.length ? order[i++]! : null);
  }
  const seen = new Set<string>();
  const warmup = shuffle(grid, rng);
  let warmed = 0;
  return () => {
    if (seen.size >= MAX_CONFIGS_PER_FAMILY) return null;
    if (warmed < warmup.length && warmed < 3) {
      const cfg = warmup[warmed++]!;
      seen.add(configKey(cfg));
      return cfg;
    }
    const best = getBest();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const cfg: Record<string, number> = {};
      for (const key of Object.keys(GRIDS[family])) {
        const values = GRIDS[family][key]!;
        if (rng() < 0.25 || best === null || best[key] === undefined) {
          cfg[key] = values[Math.floor(rng() * values.length)]!;
          continue;
        }
        // Nearest grid value to the current best on a log scale, then a
        // Gaussian step in index space.
        let nearest = 0;
        let bd = Infinity;
        const logBest = Math.log(Math.max(1e-12, best[key]!));
        values.forEach((v, vi) => {
          const d = Math.abs(Math.log(Math.max(1e-12, v)) - logBest);
          if (d < bd) {
            bd = d;
            nearest = vi;
          }
        });
        const step = Math.round(gaussian(rng) * 1.1);
        cfg[key] = values[Math.min(values.length - 1, Math.max(0, nearest + step))]!;
      }
      const key = configKey(cfg);
      if (!seen.has(key)) {
        seen.add(key);
        return cfg;
      }
    }
    for (const cfg of grid) {
      const key = configKey(cfg);
      if (!seen.has(key)) {
        seen.add(key);
        return cfg;
      }
    }
    return null;
  };
}

function familiesFor(task: Task): ModelFamily[] {
  return task === 'classification'
    ? ['logistic', 'knn', 'gnb', 'tree']
    : ['ridge', 'knn', 'tree'];
}

// ---- cross-validation ------------------------------------------------------

interface FoldSplit {
  trainIdx: number[];
  testIdx: number[];
}

/** Seeded shuffled K-fold assignment (deterministic given the RNG state). */
function kFolds(n: number, folds: number, rng: Rng): FoldSplit[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  const parts: number[][] = Array.from({ length: folds }, () => []);
  idx.forEach((v, i) => parts[i % folds]!.push(v));
  return parts.map((testIdx) => ({
    testIdx,
    trainIdx: idx.filter((v) => !testIdx.includes(v)),
  }));
}

function gatherRows(X: number[][], idx: number[]): number[][] {
  return idx.map((i) => X[i]!);
}

function gatherVals(y: number[], idx: number[]): number[] {
  return idx.map((i) => y[i]!);
}

function fitFamily(
  family: ModelFamily,
  params: Record<string, number>,
  X: number[][],
  y: number[],
  task: Task,
  nClasses: number,
): FoldModel {
  switch (family) {
    case 'ridge':
      return { predict: ridgeFit(X, y, params.alpha ?? 1) };
    case 'logistic':
      return logisticOvR(X, y, nClasses, params.lr ?? 0.2, params.l2 ?? 0);
    case 'gnb':
      return gnbFit(X, y, nClasses, params.varSmoothing ?? 1e-7);
    case 'tree':
      return treeFit(X, y, task, nClasses, Math.round(params.maxDepth ?? 4), Math.round(params.minLeaf ?? 1));
    case 'knn':
      // k-NN has no training phase; it is handled directly in evaluateCandidate.
      throw new Error('knn is evaluated without fitFamily');
  }
}

interface CandidateScore {
  mean: number;
  std: number;
  aux: number | null;
}

/** K-fold CV of one (family, params) candidate. Each fold is encoded and
 *  standardized on its own training rows (see `encodeAndSelect`). */
function evaluateCandidate(
  family: ModelFamily,
  params: Record<string, number>,
  foldEncs: Encoded[],
  y: number[],
  task: Task,
  nClasses: number,
  splits: FoldSplit[],
  knnCache: Map<number, number[][]>,
): CandidateScore {
  const binary = task === 'classification' && nClasses === 2;
  const primaries: number[] = [];
  const auxes: number[] = [];
  for (let fi = 0; fi < splits.length; fi += 1) {
    const split = splits[fi]!;
    const X = foldEncs[fi]!.matrix;
    const Xtr = gatherRows(X, split.trainIdx);
    const ytr = gatherVals(y, split.trainIdx);
    const Xte = gatherRows(X, split.testIdx);
    const yte = gatherVals(y, split.testIdx);
    let preds: number[];
    let scores: number[] | null = null;
    if (family === 'knn') {
      let nb = knnCache.get(fi);
      if (!nb) {
        nb = knnNeighbors(Xtr, Xte, ytr);
        knnCache.set(fi, nb);
      }
      const k = Math.max(1, Math.round(params.k ?? 5));
      preds = [];
      if (binary) scores = [];
      for (const labels of nb) {
        const kk = Math.min(k, labels.length);
        if (task === 'classification') {
          const counts = new Map<number, number>();
          for (let t = 0; t < kk; t += 1) {
            const code = labels[t]!;
            counts.set(code, (counts.get(code) ?? 0) + 1);
          }
          // Majority vote; ties resolve to the smallest class code.
          let bestCode = 0;
          let bestCount = -1;
          for (const [code, cnt] of counts) {
            if (cnt > bestCount || (cnt === bestCount && code < bestCode)) {
              bestCode = code;
              bestCount = cnt;
            }
          }
          preds.push(bestCode);
          if (scores) scores.push((counts.get(1) ?? 0) / kk);
        } else {
          let s = 0;
          for (let t = 0; t < kk; t += 1) s += labels[t]!;
          preds.push(s / kk);
        }
      }
    } else {
      const model = fitFamily(family, params, Xtr, ytr, task, nClasses);
      preds = Xte.map((r) => model.predict(r));
      if (binary && model.score) scores = Xte.map((r) => model.score!(r));
    }
    if (task === 'classification') {
      primaries.push(accuracyOf(preds, yte));
      auxes.push(binary && scores ? aucOf(scores, yte) : macroF1Of(preds, yte, nClasses));
    } else {
      primaries.push(rmseOf(preds, yte));
      auxes.push(r2Of(preds, yte));
    }
  }
  return {
    mean: meanOf(primaries),
    std: stdOf(primaries),
    aux: auxes.length > 0 ? meanOf(auxes) : null,
  };
}

// ---- top-level search ------------------------------------------------------

export interface AutoMLOptions {
  strategy: SearchStrategy;
  /** 'auto' | 'all' | a specific model family. */
  selection: string;
  folds: number;
  seed: number;
  targetColumn: string | null;
  /** Wall-clock cap for the search loop (ms). */
  timeBudgetMs: number;
}

export interface FamilyResult {
  model: ModelFamily;
  params: Record<string, number>;
  /** Mean of the primary metric across folds. */
  mean: number;
  /** Std of the primary metric across folds. */
  std: number;
  /** Mean AUC (binary) / macro-F1 (multiclass) / R² (regression). */
  aux: number | null;
}

export interface PipelineDescriptor {
  task: Task;
  preprocessing: {
    columns: string[];
    means: Array<number | null>;
    stds: Array<number | null>;
    onehot: Record<string, string[]>;
  };
  model: ModelFamily;
  params: Record<string, number>;
  metrics: {
    metric: string;
    cvMean: number;
    cvStd: number;
    folds: number;
    rows: number;
    selectedFeatures: number;
    target: string;
    seed: number;
  };
}

export interface AutoMLResult {
  task: Task;
  metricName: string;
  higherBetter: boolean;
  nClasses: number;
  /** 'auc' | 'macro_f1' | 'r2' | null — the auxiliary metric name. */
  auxName: string | null;
  rowCount: number;
  rawFeatureCount: number;
  selectedFeatureCount: number;
  selectedColumns: string[];
  droppedColumns: string[];
  /** Best config per family, sorted best-first. */
  families: FamilyResult[];
  best: FamilyResult;
  truncated: boolean;
  runtimeMs: number;
  folds: number;
  seed: number;
  pipeline: PipelineDescriptor;
}

/**
 * Run the full AutoML pipeline on CSV text: parse → preprocess → search →
 * cross-validate → rank. Deterministic given (text, options) as long as the
 * time budget is not hit.
 */
export function runAutoML(text: string, opts: AutoMLOptions): AutoMLResult {
  const started = performance.now();
  const table = parseTable(text);
  if (!table) throw new Error('could not parse CSV input (need a header row plus data rows)');
  const prepared = prepareData(table, opts.targetColumn);
  const enc = encodeAndSelect(prepared);
  const n = enc.rowCount;
  const task = enc.task;
  const nClasses = task === 'classification' ? enc.classNames?.length ?? 0 : 0;

  const rng = mulberry32(Math.max(1, Math.round(opts.seed)) >>> 0);
  const folds = Math.min(Math.max(2, Math.round(opts.folds)), 10, Math.max(2, Math.floor(n / 2)));
  const splits = kFolds(n, folds, rng);
  // Fold-local encoding: selection + standardization use training rows only.
  const foldEncs = splits.map((s) => encodeAndSelect(prepared, s.trainIdx));

  const applicable = familiesFor(task);
  const requested = opts.selection;
  const families =
    requested === 'auto' || requested === 'all' || !applicable.includes(requested as ModelFamily)
      ? applicable
      : [requested as ModelFamily];

  const deadline = started + Math.max(200, opts.timeBudgetMs);
  const knnCache = new Map<number, number[][]>();
  const bestPerFamily = new Map<ModelFamily, FamilyResult>();
  const sources = new Map<ModelFamily, () => Record<string, number> | null>();
  for (const fam of families) {
    sources.set(
      fam,
      makeConfigSource(fam, opts.strategy, rng, () => bestPerFamily.get(fam)?.params ?? null),
    );
  }

  // Round-robin across families so a time-budget truncation still leaves
  // every family with at least some evaluated candidates.
  let truncated = false;
  for (;;) {
    let progressed = false;
    for (const fam of families) {
      const next = sources.get(fam)!;
      const cfg = next();
      if (!cfg) continue;
      progressed = true;
      if (performance.now() > deadline) {
        truncated = true;
        break;
      }
      const score = evaluateCandidate(fam, cfg, foldEncs, enc.y, task, nClasses, splits, knnCache);
      const cur = bestPerFamily.get(fam);
      const better =
        cur === undefined ||
        (task === 'classification' ? score.mean > cur.mean : score.mean < cur.mean);
      if (better) {
        bestPerFamily.set(fam, { model: fam, params: cfg, mean: score.mean, std: score.std, aux: score.aux });
      }
    }
    if (!progressed || truncated) break;
  }

  const fams = [...bestPerFamily.values()];
  if (fams.length === 0) throw new Error('no candidate configuration could be evaluated');
  fams.sort((a, b) => {
    const d = task === 'classification' ? b.mean - a.mean : a.mean - b.mean;
    return d !== 0 ? d : a.model.localeCompare(b.model);
  });
  const best = fams[0]!;
  const runtimeMs = performance.now() - started;

  const metricName = task === 'classification' ? 'accuracy' : 'rmse';
  const auxName =
    task === 'classification' ? (nClasses === 2 ? 'auc' : 'macro_f1') : 'r2';

  const pipeline: PipelineDescriptor = {
    task,
    preprocessing: {
      columns: enc.selected.map((c) => c.name),
      means: enc.selected.map((c) => c.mean),
      stds: enc.selected.map((c) => c.std),
      onehot: enc.onehot,
    },
    model: best.model,
    params: best.params,
    metrics: {
      metric: metricName,
      cvMean: best.mean,
      cvStd: best.std,
      folds,
      rows: n,
      selectedFeatures: enc.selected.length,
      target: enc.targetName,
      seed: Math.round(opts.seed),
    },
  };

  return {
    task,
    metricName,
    higherBetter: task === 'classification',
    nClasses,
    auxName,
    rowCount: n,
    rawFeatureCount: enc.rawFeatureCount,
    selectedFeatureCount: enc.selected.length,
    selectedColumns: enc.selected.map((c) => c.name),
    droppedColumns: enc.droppedNote,
    families: fams,
    best,
    truncated,
    runtimeMs,
    folds,
    seed: Math.round(opts.seed),
    pipeline,
  };
}

// ---- synthetic data --------------------------------------------------------

/**
 * Generate a deterministic tabular CSV: four numeric features plus one
 * 3-level categorical feature and a binary target with a real linear +
 * categorical signal and Gaussian noise. ~2% of the `x3_signal` values are
 * left empty so mean imputation is exercised end-to-end.
 */
export function generateSyntheticDataset(rows: number, seed: number): string {
  const rng = mulberry32(seed >>> 0);
  const cats = ['A', 'B', 'C'];
  const lines: string[] = [
    'x1_signal,x2_signal,x3_signal,x4_noise,x5_category,target',
  ];
  for (let i = 0; i < rows; i += 1) {
    const x1 = rng() * 6 - 3;
    const x2 = gaussian(rng);
    const x3 = rng() * 10;
    const x4 = gaussian(rng);
    const cat = cats[Math.floor(rng() * cats.length)]!;
    const catEffect = cat === 'B' ? 0.5 : cat === 'C' ? -0.4 : 0;
    const noise = gaussian(rng) * 1.1;
    const logit = 0.9 * x1 + 0.8 * x2 + 0.12 * x3 + catEffect + noise;
    const target = logit > 0 ? 1 : 0;
    const x3Cell = rng() < 0.02 ? '' : x3.toFixed(3);
    lines.push(
      `${x1.toFixed(3)},${x2.toFixed(3)},${x3Cell},${x4.toFixed(3)},${cat},${target}`,
    );
  }
  return lines.join('\n');
}
