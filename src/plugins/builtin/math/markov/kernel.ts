// ==========================================================================
// stats-markov — Markov-chain numerics (pure, dependency-free, testable)
//
// Row-stochastic transition matrix convention: (P)[i][j] = Pr(next = j | now
// = i), distributions are row vectors, so the stationary law solves pi P = pi
// and one update is pi_{k+1} = pi_k · P.
//
// Everything is implemented from scratch: power iteration to an L1 residual
// below 1e-12, strong-connectivity BFS (irreducibility), BFS-depth gcd period
// detection, Gauss-Jordan inversion with partial pivoting for the absorbing-
// chain fundamental matrix N = (I-Q)^-1, seeded trajectory simulation, and a
// damped PageRank power iteration (Google matrix G = d·P + (1-d)/N).
//
// Embedded benchmarks compare against closed-form ground truth: the weather
// chain's stationary law (9/11, 2/11), the uniform law of doubly stochastic
// matrices, the gambler's-ruin absorption times (2 steps) and ruin
// probability (2/3), and the PageRank fixed-point residual. No DOM anywhere.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

// ---- matrix parsing ---------------------------------------------------------

export interface ParsedMatrix {
  rows: number[][];
  labels: string[] | null;
}

/**
 * Parse a square transition matrix from CSV / TSV / whitespace text.
 * `;` acts as a row separator too (single-line editing). Lines starting with
 * `#` are comments; `# labels: A,B,...` supplies optional state labels.
 * Returns null when fewer than 2 rows survive, rows are ragged / non-square,
 * or a negative entry appears.
 */
export function parseMatrixText(text: string): ParsedMatrix | null {
  const lines = text.replace(/;/g, '\n').split(/\r?\n/);
  let labels: string[] | null = null;
  const rows: number[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*labels\s*:\s*(.+)$/i.exec(line);
      if (m && m[1]) {
        const parts = m[1]
          .split(/[,\s;]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (parts.length >= 2) labels = parts;
      }
      continue;
    }
    const cells = line.split(/[\s,\t]+/).filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    const vals: number[] = [];
    let ok = true;
    for (const c of cells) {
      const v = Number(c);
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      vals.push(v < -1e-9 ? NaN : Math.max(0, v));
    }
    if (!ok || vals.some((v) => !Number.isFinite(v))) continue;
    rows.push(vals);
  }
  if (rows.length < 2) return null;
  const n = rows[0]!.length;
  if (n < 2 || rows.length !== n) return null;
  for (const r of rows) {
    if (r.length !== n) return null;
  }
  return { rows, labels };
}

/** Serialize rows back to the single-line editor form "a,b ; c,d". */
export function serializeMatrix(rows: number[][]): string {
  return rows.map((r) => r.map((v) => String(Number(v.toFixed(6)))).join(',')).join(' ; ');
}

export interface Stochasticized {
  P: number[][];
  /** Largest |row sum - 1| of the input before normalisation. */
  maxDeviation: number;
  /** Number of all-zero (dangling) rows replaced by the uniform row. */
  danglingRows: number;
}

/**
 * Validate + repair a transition matrix: clamp negatives to 0, replace
 * dangling rows (sum 0) by the uniform row, and normalise every row to sum
 * exactly 1. Returns null when a non-dangling row has a non-positive sum
 * (cannot happen for clamped non-negative entries) — kept for safety.
 */
export function stochasticize(P: number[][]): Stochasticized | null {
  const n = P.length;
  let maxDeviation = 0;
  let danglingRows = 0;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = P[i]!.slice();
    for (let j = 0; j < n; j += 1) row[j] = Math.max(0, row[j] ?? 0);
    const s = row.reduce((a, v) => a + v, 0);
    if (s <= 1e-12) {
      danglingRows += 1;
      out.push(new Array<number>(n).fill(1 / n));
      continue;
    }
    maxDeviation = Math.max(maxDeviation, Math.abs(s - 1));
    out.push(row.map((v) => v / s));
  }
  return { P: out, maxDeviation, danglingRows };
}

// ---- stationary distribution ------------------------------------------------

export interface SteadyResult {
  pi: number[];
  iterations: number;
  /** L1 norm of pi·P - pi at the final iterate. */
  residual: number;
  converged: boolean;
}

/** One synchronous update of a row distribution: pi·P. */
export function stepDistribution(pi: ArrayLike<number>, P: number[][]): number[] {
  const n = P.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const w = pi[i] ?? 0;
    if (w === 0) continue;
    const row = P[i]!;
    for (let j = 0; j < n; j += 1) out[j] = (out[j] ?? 0) + w * (row[j] ?? 0);
  }
  return out;
}

function l1Distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s;
}

/**
 * Power iteration for the stationary distribution pi P = pi, starting from
 * the uniform vector, until the L1 residual drops below `tol` (default
 * 1e-12). Converges for every finite irreducible-or-mixed chain in practice;
 * `maxIter` guards pathological (periodic) drift — the residual is still
 * reported so the caller can judge.
 */
export function steadyStateByPower(P: number[][], tol = 1e-12, maxIter = 20000): SteadyResult {
  const n = P.length;
  let pi = new Array<number>(n).fill(1 / n);
  let iterations = 0;
  let residual = l1Distance(stepDistribution(pi, P), pi);
  while (iterations < maxIter) {
    const next = stepDistribution(pi, P);
    residual = l1Distance(next, pi);
    pi = next;
    iterations += 1;
    if (residual < tol) break;
  }
  // Normalise away floating drift so the reported law sums to exactly 1.
  const s = pi.reduce((a, v) => a + v, 0);
  const pIn = s > 0 ? pi.map((v) => v / s) : pi;
  return { pi: pIn, iterations, residual, converged: residual < tol };
}

/**
 * Damped PageRank: G = d·P + (1-d)/n (every entry), then power iteration.
 * The unique stationary law of G exists for any row-stochastic P and 0<d<1.
 */
export function pageRank(P: number[][], damping = 0.85, tol = 1e-12, maxIter = 20000): SteadyResult {
  const n = P.length;
  const d = Math.min(0.99, Math.max(0.01, damping));
  const G: number[][] = P.map((row) => row.map((v) => d * v + (1 - d) / n));
  return steadyStateByPower(G, tol, maxIter);
}

// ---- structure: irreducibility & period -------------------------------------

function adjacency(P: number[][], transpose = false): number[][] {
  const n = P.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    const row = P[i]!;
    for (let j = 0; j < n; j += 1) {
      if ((row[j] ?? 0) > 1e-15) {
        if (transpose) adj[j]!.push(i);
        else adj[i]!.push(j);
      }
    }
  }
  return adj;
}

function bfsDepths(adj: number[][], root: number): (number | null)[] {
  const n = adj.length;
  const depth: (number | null)[] = new Array<number | null>(n).fill(null);
  depth[root] = 0;
  const queue = [root];
  for (let head = 0; head < queue.length; head += 1) {
    const u = queue[head]!;
    for (const v of adj[u]!) {
      if (depth[v] === null) {
        depth[v] = (depth[u] ?? 0) + 1;
        queue.push(v);
      }
    }
  }
  return depth;
}

/** True when every state reaches every other (strong connectivity). */
export function isIrreducible(P: number[][]): boolean {
  const n = P.length;
  const fwd = bfsDepths(adjacency(P), 0);
  const bwd = bfsDepths(adjacency(P, true), 0);
  for (let i = 0; i < n; i += 1) {
    if (fwd[i] === null || bwd[i] === null) return false;
  }
  return true;
}

/**
 * Period of a strongly connected chain: gcd over all edges (i, j) of
 * depth(i) + 1 - depth(j), where depth is the BFS distance from state 0.
 * Returns null when the chain is not irreducible (period is a class
 * property; we do not split classes here).
 */
export function chainPeriod(P: number[][]): number | null {
  if (!isIrreducible(P)) return null;
  const n = P.length;
  const depth = bfsDepths(adjacency(P), 0);
  let g = 0;
  const gcd = (a: number, b: number): number => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  };
  for (let i = 0; i < n; i += 1) {
    const row = P[i]!;
    for (let j = 0; j < n; j += 1) {
      if ((row[j] ?? 0) > 1e-15) {
        g = gcd(g, (depth[i] ?? 0) + 1 - (depth[j] ?? 0));
      }
    }
  }
  return g > 0 ? g : 1;
}

// ---- absorbing chains --------------------------------------------------------

/** Gauss-Jordan inverse with partial pivoting; null when singular. */
export function matrixInverse(A: number[][]): number[][] | null {
  const n = A.length;
  // Augmented [A | I]
  const a: number[][] = A.map((row, i) => {
    const r = row.slice();
    const id = new Array<number>(n).fill(0);
    id[i] = 1;
    return [...r, ...id];
  });
  for (let col = 0; col < n; col += 1) {
    // Partial pivot
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    }
    if (Math.abs(a[piv]![col]!) < 1e-14) return null;
    if (piv !== col) {
      const t = a[piv]!;
      a[piv] = a[col]!;
      a[col] = t;
    }
    const diag = a[col]!;
    const d = diag[col]!;
    for (let j = 0; j < 2 * n; j += 1) diag[j] = (diag[j] ?? 0) / d;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const row = a[r]!;
      const f = row[col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) row[j] = (row[j] ?? 0) - f * (diag[j] ?? 0);
    }
  }
  return a.map((row) => row.slice(n));
}

export interface AbsorbingResult {
  transient: number[];
  absorbing: number[];
  /** Fundamental matrix N = (I - Q)^-1 (transient states in order). */
  fundamental: number[][];
  /** Expected steps to absorption from each transient state: N·1. */
  expectedSteps: number[];
  /** Absorption probabilities B = N·R, rows = transient, cols = absorbing. */
  absorptionProbs: number[][];
}

/** Absorbing-state analysis; null when the chain has no absorbing states. */
export function absorbingAnalysis(P: number[][]): AbsorbingResult | null {
  const n = P.length;
  const absorbing: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = P[i]!;
    const self = row[i] ?? 0;
    let others = 0;
    for (let j = 0; j < n; j += 1) {
      if (j !== i) others += row[j] ?? 0;
    }
    if (self > 1 - 1e-12 && others <= 1e-15) absorbing.push(i);
  }
  if (absorbing.length === 0) return null;
  const transient: number[] = [];
  for (let i = 0; i < n; i += 1) if (!absorbing.includes(i)) transient.push(i);
  const t = transient.length;
  // Q = transient x transient block, R = transient x absorbing block.
  const Q: number[][] = transient.map((i) => transient.map((j) => P[i]![j] ?? 0));
  const R: number[][] = transient.map((i) => absorbing.map((j) => P[i]![j] ?? 0));
  // I - Q
  const IQ: number[][] = Q.map((row, i) => row.map((v, j) => (i === j ? 1 - v : -v)));
  const fund = matrixInverse(IQ);
  if (!fund) return null;
  const expectedSteps = fund.map((row) => row.reduce((a, v) => a + v, 0));
  const absorptionProbs = fund.map((row) => {
    const out = new Array<number>(absorbing.length).fill(0);
    for (let k = 0; k < absorbing.length; k += 1) {
      let s = 0;
      for (let j = 0; j < t; j += 1) s += (row[j] ?? 0) * (R[j]![k] ?? 0);
      out[k] = s;
    }
    return out;
  });
  return { transient, absorbing, fundamental: fund, expectedSteps, absorptionProbs };
}

// ---- simulation --------------------------------------------------------------

/** Draw an index from a probability vector (deterministic given rng). */
function drawFrom(next: () => number, probs: ArrayLike<number>): number {
  const u = next();
  let acc = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acc += probs[i] ?? 0;
    if (u < acc) return i;
  }
  return probs.length - 1;
}

/** Parse an initial distribution; fall back to uniform when invalid. */
export function parseInitial(text: string, n: number): number[] {
  const cells = text.split(/[\s,;]+/).filter((c) => c.length > 0);
  const vals: number[] = [];
  for (const c of cells) {
    const v = Number(c);
    if (!Number.isFinite(v) || v < 0) return new Array<number>(n).fill(1 / n);
    vals.push(v);
  }
  if (vals.length !== n) return new Array<number>(n).fill(1 / n);
  const s = vals.reduce((a, v) => a + v, 0);
  if (s <= 1e-12) return new Array<number>(n).fill(1 / n);
  return vals.map((v) => v / s);
}

/**
 * Simulate one trajectory of `steps` transitions. Returns the visited state
 * indices (length steps + 1, including the initial draw).
 */
export function simulateChain(P: number[][], initial: ArrayLike<number>, steps: number, seed: number): number[] {
  const next = mulberry32(seed >>> 0);
  const total = Math.max(1, Math.floor(steps));
  const out: number[] = [];
  let state = drawFrom(next, initial);
  out.push(state);
  for (let s = 0; s < total; s += 1) {
    state = drawFrom(next, P[state] ?? new Array<number>(P.length).fill(1 / P.length));
    out.push(state);
  }
  return out;
}

// ---- embedded benchmarks -----------------------------------------------------

export interface MarkovBenchmark {
  /** Weather chain vs exact (9/11, 2/11). */
  weatherMaxAbsErr: number;
  weatherIterations: number;
  /** Doubly stochastic -> uniform. */
  doublyStochasticMaxAbsErr: number;
  /** Gambler's ruin: max |expected steps - 2| and |ruin prob - 2/3|. */
  ruinStepsMaxAbsErr: number;
  ruinProbMaxAbsErr: number;
  /** PageRank damped 2-cycle -> uniform + fixed-point residual on a web graph. */
  pagerankUniformMaxAbsErr: number;
  pagerankFixedPointResidual: number;
  pass: boolean;
}

/** The 5-node teaching web graph (same matrix as examples/data/markov-pagerank-web.csv). */
export const WEB5_MATRIX: number[][] = [
  [0, 0.5, 0.5, 0, 0],
  [0, 0, 1, 0, 0],
  [1, 0, 0, 0, 0],
  [0.5, 0, 0.5, 0, 0],
  [0.5, 0, 0, 0.5, 0],
];

/**
 * Run all four validation scenarios against closed-form / hand-checked
 * ground truth (see manifest research.notesI18n). Thresholds:
 * weather < 1e-10, ruin < 1e-9, doubly stochastic & PageRank < 1e-12.
 */
export function runMarkovBenchmark(): MarkovBenchmark {
  // (1) Weather chain. pi P = pi with P = [[0.9,0.1],[0.45,0.55]] gives
  // 0.45·pi2 = 0.1·pi1, so pi = (9/11, 2/11).
  const weather: number[][] = [
    [0.9, 0.1],
    [0.45, 0.55],
  ];
  const wSteady = steadyStateByPower(weather);
  const wExact = [9 / 11, 2 / 11];
  const weatherMaxAbsErr = Math.max(
    Math.abs(wSteady.pi[0]! - wExact[0]!),
    Math.abs(wSteady.pi[1]! - wExact[1]!),
  );

  // (2) Doubly stochastic 3x3 -> uniform by the doubly-stochastic theorem.
  const dbl: number[][] = [
    [0.5, 0.25, 0.25],
    [0.25, 0.5, 0.25],
    [0.25, 0.25, 0.5],
  ];
  const dSteady = steadyStateByPower(dbl);
  const doublyStochasticMaxAbsErr = Math.max(
    ...dSteady.pi.map((v) => Math.abs(v - 1 / dSteady.pi.length)),
  );

  // (3) Gambler's ruin on {0 = $0 (ruin), $1, $2, 3 = $3 (win)} with a fair
  // coin. Q = [[0,0.5],[0.5,0]], N = (I-Q)^-1 = [[4/3,2/3],[2/3,4/3]],
  // expected steps = (2, 2); the gambler hits $0 before $3 with probability
  // 1 - i/3, so P(ruin | $1) = 2/3 and P(ruin | $2) = 1/3.
  const ruin: number[][] = [
    [1, 0, 0, 0],
    [0.5, 0, 0.5, 0],
    [0, 0.5, 0, 0.5],
    [0, 0, 0, 1],
  ];
  const abs = absorbingAnalysis(ruin);
  let ruinStepsMaxAbsErr = Infinity;
  let ruinProbMaxAbsErr = Infinity;
  if (abs) {
    ruinStepsMaxAbsErr = Math.max(...abs.expectedSteps.map((v) => Math.abs(v - 2)));
    // transient order [1, 2]; absorbing order [0 ($0, ruin), 3 ($3, win)]
    const p1 = abs.absorptionProbs[0]!; // from $1
    const p2 = abs.absorptionProbs[1]!; // from $2
    ruinProbMaxAbsErr = Math.max(
      Math.abs(p1[0]! - 2 / 3), // ruin (hit $0) from $1 = 2/3
      Math.abs(p1[1]! - 1 / 3), // win ($3) from $1 = 1/3
      Math.abs(p2[0]! - 1 / 3), // ruin from $2 = 1/3
      Math.abs(p2[1]! - 2 / 3), // win from $2 = 2/3
    );
  }

  // (4) PageRank: damped 2-cycle is symmetric -> uniform; the 5-node web must
  // satisfy the fixed-point equation pi = pi·G to machine precision.
  const cycle: number[][] = [
    [0, 1],
    [1, 0],
  ];
  const prCycle = pageRank(cycle, 0.85);
  const pagerankUniformMaxAbsErr = Math.max(
    Math.abs(prCycle.pi[0]! - 0.5),
    Math.abs(prCycle.pi[1]! - 0.5),
  );
  const prWeb = pageRank(WEB5_MATRIX, 0.85);
  const d = 0.85;
  const n = WEB5_MATRIX.length;
  const G = WEB5_MATRIX.map((row) => row.map((v) => d * v + (1 - d) / n));
  const pagerankFixedPointResidual = l1Distance(stepDistribution(prWeb.pi, G), prWeb.pi);

  const pass =
    weatherMaxAbsErr < 1e-10 &&
    doublyStochasticMaxAbsErr < 1e-12 &&
    ruinStepsMaxAbsErr < 1e-9 &&
    ruinProbMaxAbsErr < 1e-9 &&
    pagerankUniformMaxAbsErr < 1e-12 &&
    pagerankFixedPointResidual < 1e-12;

  return {
    weatherMaxAbsErr,
    weatherIterations: wSteady.iterations,
    doublyStochasticMaxAbsErr,
    ruinStepsMaxAbsErr,
    ruinProbMaxAbsErr,
    pagerankUniformMaxAbsErr,
    pagerankFixedPointResidual,
    pass,
  };
}

// ---- preset library ----------------------------------------------------------

export interface Preset {
  id: string;
  en: string;
  zh: string;
  rows: number[][];
  labels: string[] | null;
  note: string;
  noteZh: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'weather',
    en: 'Weather (2-state)',
    zh: '天气模型（两态）',
    rows: [
      [0.9, 0.1],
      [0.45, 0.55],
    ],
    labels: ['Sunny', 'Rainy'],
    note: 'pi = (9/11, 2/11)',
    noteZh: '稳态 π = (9/11, 2/11)',
  },
  {
    id: 'ruin',
    en: "Gambler's ruin (absorbing)",
    zh: '赌徒破产（吸收链）',
    rows: [
      [1, 0, 0, 0],
      [0.5, 0, 0.5, 0],
      [0, 0.5, 0, 0.5],
      [0, 0, 0, 1],
    ],
    labels: ['Ruin ($0)', '$1', '$2', 'Win ($3)'],
    note: 'E[steps] = 2, P(ruin | $1) = 2/3',
    noteZh: '期望吸收步数 2，$1 出发破产概率 2/3',
  },
  {
    id: 'doubly',
    en: 'Doubly stochastic',
    zh: '双随机矩阵',
    rows: [
      [0.5, 0.25, 0.25],
      [0.25, 0.5, 0.25],
      [0.25, 0.25, 0.5],
    ],
    labels: null,
    note: 'stationary law = uniform',
    noteZh: '稳态 = 均匀分布',
  },
  {
    id: 'pagerank-web',
    en: 'PageRank web (5 pages)',
    zh: 'PageRank 网页图（5 节点）',
    rows: WEB5_MATRIX,
    labels: ['A', 'B', 'C', 'D', 'E'],
    note: 'Page & Brin (1998), damping 0.85',
    noteZh: 'Page & Brin (1998)，阻尼 0.85',
  },
  {
    id: 'cycle2',
    en: 'Periodic 2-cycle',
    zh: '周期 2 循环',
    rows: [
      [0, 1],
      [1, 0],
    ],
    labels: ['Even', 'Odd'],
    note: 'period 2 (uniform start is already stationary)',
    noteZh: '周期 2（均匀初始分布即稳态）',
  },
];
