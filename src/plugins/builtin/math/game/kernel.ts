// ==========================================================================
// math-game — game-theory numerics (pure, dependency-free, testable)
//
// Normal-form analysis: best responses, pure Nash equilibria by mutual
// best response (any n x m), the closed-form 2x2 mixed equilibrium, and
// support enumeration with a least-squares indifference solve for general
// n x m mixed equilibria; iterated strict dominance and ESS tests for
// symmetric 2x2 games. Evolutionary play: single- and two-population
// replicator dynamics ẋ_i = x_i (f_i(x) − f̄) integrated with classic RK4.
// Extensive form: labelled game trees solved by backward induction.
// Auctions: first-price sealed, second-price sealed (= single-item VCG)
// and an English clock auction, all driven by a reproducible seeded RNG,
// plus an incentive-compatibility (truth-telling) gap metric.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// The unified error metric throughout is |computed − analytic|/|analytic|;
// when the analytic target is 0 the denominator is floored at 1 (plain
// absolute deviation), matching the odefield manifold convention.
// ==========================================================================

// ---- normal-form games ----------------------------------------------------------

export interface NormalFormGame {
  /** rowPayoffs[i][j] — row player's payoff when row i meets column j. */
  rowPayoffs: number[][];
  /** colPayoffs[i][j] — column player's payoff of the same profile. */
  colPayoffs: number[][];
  rowLabels?: string[];
  colLabels?: string[];
}

export interface NashEquilibrium {
  /** Mixture over the row player's strategies (probabilities). */
  row: number[];
  /** Mixture over the column player's strategies (probabilities). */
  col: number[];
  kind: 'pure' | 'mixed';
  /** Expected payoff of the row player at this profile. */
  u1: number;
  /** Expected payoff of the column player at this profile. */
  u2: number;
}

/** Tolerance for best-response / indifference / feasibility comparisons. */
const TOL = 1e-9;
/** Tolerance for the indifference residual of a solved support pair. */
const RESID_TOL = 1e-7;

function unit(n: number, k: number): number[] {
  const v = new Array<number>(n).fill(0);
  v[k] = 1;
  return v;
}

export function expectedPayoffs(game: NormalFormGame, row: number[], col: number[]): [number, number] {
  let u1 = 0;
  let u2 = 0;
  for (let i = 0; i < row.length; i += 1) {
    const ri = row[i]!;
    if (ri === 0) continue;
    for (let j = 0; j < col.length; j += 1) {
      const cj = col[j]!;
      if (cj === 0) continue;
      u1 += ri * cj * game.rowPayoffs[i]![j]!;
      u2 += ri * cj * game.colPayoffs[i]![j]!;
    }
  }
  return [u1, u2];
}

/** Row player's best-response set (within TOL) to a column mixture. */
export function rowBestResponses(game: NormalFormGame, colProbs: number[]): number[] {
  let best = -Infinity;
  const vals = game.rowPayoffs.map((row) => row.reduce((s, p, j) => s + (colProbs[j] ?? 0) * p, 0));
  for (const v of vals) if (v > best) best = v;
  const out: number[] = [];
  vals.forEach((v, i) => {
    if (best - v <= TOL) out.push(i);
  });
  return out;
}

/** Column player's best-response set (within TOL) to a row mixture. */
export function colBestResponses(game: NormalFormGame, rowProbs: number[]): number[] {
  let best = -Infinity;
  const vals = game.colPayoffs[0]?.map((_c, j) => {
    let s = 0;
    for (let i = 0; i < rowProbs.length; i += 1) s += (rowProbs[i] ?? 0) * game.colPayoffs[i]![j]!;
    return s;
  }) ?? [];
  for (const v of vals) if (v > best) best = v;
  const out: number[] = [];
  vals.forEach((v, j) => {
    if (best - v <= TOL) out.push(j);
  });
  return out;
}

/** Pure Nash equilibria = cells where both strategies are mutual best responses. */
export function findPureNE(game: NormalFormGame): NashEquilibrium[] {
  const m = game.rowPayoffs.length;
  const n = game.rowPayoffs[0]?.length ?? 0;
  const out: NashEquilibrium[] = [];
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!rowBestResponses(game, unit(n, j)).includes(i)) continue;
      if (!colBestResponses(game, unit(m, i)).includes(j)) continue;
      const [u1, u2] = expectedPayoffs(game, unit(m, i), unit(n, j));
      out.push({ row: unit(m, i), col: unit(n, j), kind: 'pure', u1, u2 });
    }
  }
  return out;
}

/**
 * Closed-form interior mixed equilibrium of a 2x2 game: `row[0]` = p makes
 * the column player indifferent between its two columns, `col[0]` = q makes
 * the row player indifferent between its two rows. Returns null when either
 * indifference denominator vanishes or the solution leaves the open square
 * (degenerate / non-interior cases — findNash classifies those rigorously).
 */
export function solveMixed2x2(game: NormalFormGame): NashEquilibrium | null {
  const A = game.rowPayoffs;
  const B = game.colPayoffs;
  if (A.length !== 2 || A[0]?.length !== 2 || B.length !== 2 || B[0]?.length !== 2) return null;
  const denA = A[0]![0]! - A[0]![1]! - A[1]![0]! + A[1]![1]!;
  const denB = B[0]![0]! - B[0]![1]! - B[1]![0]! + B[1]![1]!;
  if (Math.abs(denA) < 1e-12 || Math.abs(denB) < 1e-12) return null;
  const q = (A[1]![1]! - A[0]![1]!) / denA; // column player's prob on column 0
  const p = (B[1]![1]! - B[1]![0]!) / denB; // row player's prob on row 0
  const eps = 1e-12;
  if (!(p > eps && p < 1 - eps && q > eps && q < 1 - eps)) return null;
  const row = [p, 1 - p];
  const col = [q, 1 - q];
  const [u1, u2] = expectedPayoffs(game, row, col);
  return { row, col, kind: 'mixed', u1, u2 };
}

/** Gaussian elimination (Gauss-Jordan, partial pivoting) of a square system. */
function solveSquare(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) {
      if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    }
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= n; k += 1) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * Least-squares solve of M x = b through the normal equations MᵀM x = Mᵀb
 * (square systems reduce to plain Gauss-Jordan). Returns null when MᵀM is
 * singular — i.e. the indifference system is underdetermined (degenerate
 * supports that this enumerator intentionally skips).
 */
function leastSquares(M: number[][], b: number[]): number[] | null {
  const eqs = M.length;
  const vars = M[0]?.length ?? 0;
  if (vars === 0 || eqs === 0) return null;
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let a = 0; a < vars; a += 1) {
    const row: number[] = [];
    for (let c = 0; c < vars; c += 1) {
      let s = 0;
      for (let r = 0; r < eqs; r += 1) s += M[r]![a]! * M[r]![c]!;
      row.push(s);
    }
    A.push(row);
    let s = 0;
    for (let r = 0; r < eqs; r += 1) s += M[r]![a]! * b[r]!;
    rhs.push(s);
  }
  return solveSquare(A, rhs);
}

/** Clamp a support mixture to a feasible probability vector (or null). */
function feasibleDistribution(vals: number[], support: number[], n: number): number[] | null {
  const out = new Array<number>(n).fill(0);
  let sum = 0;
  for (let k = 0; k < support.length; k += 1) {
    let v = vals[k]!;
    if (v < 0 && v >= -RESID_TOL) v = 0;
    if (v < 0) return null;
    out[support[k]!] = v;
    sum += v;
  }
  if (Math.abs(sum - 1) > RESID_TOL) return null;
  for (const j of support) out[j] = out[j]! / sum;
  return out;
}

/**
 * General Nash solver by support enumeration: for every pair of nonempty
 * supports (S1, S2) solve the indifference systems by least squares, then
 * verify feasibility and that no strategy outside the support does better.
 * Pure equilibria fall out of the singleton supports; 2x2 mixed equilibria
 * coincide with the closed-form solution. Degenerate supports whose
 * indifference system is underdetermined are skipped.
 */
export function findNash(game: NormalFormGame): NashEquilibrium[] {
  const A = game.rowPayoffs;
  const B = game.colPayoffs;
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const out: NashEquilibrium[] = [];
  const seen = new Set<string>();
  if (m === 0 || n === 0) return out;

  for (let mask1 = 1; mask1 < 1 << m; mask1 += 1) {
    const S1: number[] = [];
    for (let i = 0; i < m; i += 1) if (mask1 & (1 << i)) S1.push(i);
    for (let mask2 = 1; mask2 < 1 << n; mask2 += 1) {
      const S2: number[] = [];
      for (let j = 0; j < n; j += 1) if (mask2 & (1 << j)) S2.push(j);

      // --- column mixture q on S2 making the row player indifferent on S1 ---
      const i0 = S1[0]!;
      const Mq: number[][] = [];
      const bq: number[] = [];
      for (let a = 1; a < S1.length; a += 1) {
        const i = S1[a]!;
        Mq.push(S2.map((j) => A[i]![j]! - A[i0]![j]!));
        bq.push(0);
      }
      Mq.push(S2.map(() => 1));
      bq.push(1);
      const qSmall = leastSquares(Mq, bq);
      if (!qSmall) continue;
      const q = feasibleDistribution(qSmall, S2, n);
      if (!q) continue;

      // --- row mixture p on S1 making the column player indifferent on S2 ---
      const j0 = S2[0]!;
      const Mp: number[][] = [];
      const bp: number[] = [];
      for (let b = 1; b < S2.length; b += 1) {
        const j = S2[b]!;
        Mp.push(S1.map((i) => B[i]![j]! - B[i]![j0]!));
        bp.push(0);
      }
      Mp.push(S1.map(() => 1));
      bp.push(1);
      const pSmall = leastSquares(Mp, bp);
      if (!pSmall) continue;
      const p = feasibleDistribution(pSmall, S1, m);
      if (!p) continue;

      // --- verify indifference residual + no profitable deviation ------------
      const rowVals = A.map((row) => row.reduce((s, v, j) => s + v * q[j]!, 0));
      const colVals = B[0]?.map((_c, j) => {
        let s = 0;
        for (let i = 0; i < m; i += 1) s += p[i]! * B[i]![j]!;
        return s;
      }) ?? [];
      const sup1 = rowVals[i0]!;
      const sup2 = colVals[j0]!;
      let ok = true;
      for (const i of S1) if (Math.abs(rowVals[i]! - sup1) > RESID_TOL) ok = false;
      for (let i = 0; i < m && ok; i += 1) if (!S1.includes(i) && rowVals[i]! > sup1 + TOL) ok = false;
      for (const j of S2) if (Math.abs(colVals[j]! - sup2) > RESID_TOL) ok = false;
      for (let j = 0; j < n && ok; j += 1) if (!S2.includes(j) && colVals[j]! > sup2 + TOL) ok = false;
      if (!ok) continue;

      const key = [...p, ...q].map((v) => Math.round(v * 1e7)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const [u1, u2] = expectedPayoffs(game, p, q);
      out.push({ row: p, col: q, kind: S1.length === 1 && S2.length === 1 ? 'pure' : 'mixed', u1, u2 });
    }
  }
  return out;
}

/** Iterated elimination of strictly dominated (pure) strategies. */
export function eliminateStrictlyDominated(game: NormalFormGame): { rows: number[]; cols: number[] } {
  let rows = game.rowPayoffs.map((_, i) => i);
  let cols = game.rowPayoffs[0]?.map((_, j) => j) ?? [];
  let changed = true;
  while (changed) {
    changed = false;
    const nextRows = rows.filter((i) => {
      const dominated = rows.some(
        (k) => k !== i && cols.every((j) => game.rowPayoffs[k]![j]! > game.rowPayoffs[i]![j]!),
      );
      if (dominated) changed = true;
      return !dominated;
    });
    rows = nextRows;
    const nextCols = cols.filter((j) => {
      const dominated = cols.some(
        (k) => k !== j && rows.every((i) => game.colPayoffs[i]![k]! > game.colPayoffs[i]![j]!),
      );
      if (dominated) changed = true;
      return !dominated;
    });
    cols = nextCols;
  }
  return { rows, cols };
}

/**
 * Largest unilateral profitable deviation at a profile (0 = no-deviation
 * condition of the Nash definition holds). Payoffs are linear in the own
 * mixture, so checking the pure deviations suffices.
 */
export function noDeviationGap(game: NormalFormGame, eq: NashEquilibrium): number {
  const [u1, u2] = expectedPayoffs(game, eq.row, eq.col);
  let gap = 0;
  for (let i = 0; i < eq.row.length; i += 1) {
    const [d1] = expectedPayoffs(game, unit(eq.row.length, i), eq.col);
    gap = Math.max(gap, d1 - u1);
  }
  for (let j = 0; j < eq.col.length; j += 1) {
    const [, d2] = expectedPayoffs(game, eq.row, unit(eq.col.length, j));
    gap = Math.max(gap, d2 - u2);
  }
  return Math.max(0, gap);
}

/**
 * Pure ESS of the symmetric game induced by rowPayoffs: strategy i is an
 * ESS when i is a strict best response to itself, or ties with every rival
 * against itself and beats them against i (Maynard Smith criterion).
 */
export function essPureStrategies(game: NormalFormGame): number[] {
  const A = game.rowPayoffs;
  const out: number[] = [];
  for (let i = 0; i < A.length; i += 1) {
    let ess = true;
    for (let j = 0; j < A.length && ess; j += 1) {
      if (j === i) continue;
      const self = A[i]![i]!;
      const inv = A[j]![i]!;
      if (self > inv) continue; // strict best response against itself
      if (Math.abs(self - inv) > TOL || !(A[i]![j]! > A[j]![j]! + TOL)) ess = false;
    }
    if (ess) out.push(i);
  }
  return out;
}

// ---- sample games --------------------------------------------------------------------

export interface SampleGame {
  id: string;
  labelEn: string;
  labelZh: string;
  rowLabelsEn: string[];
  rowLabelsZh: string[];
  colLabelsEn: string[];
  colLabelsZh: string[];
  rowPayoffs: number[][];
  colPayoffs: number[][];
}

export const SAMPLE_GAMES: SampleGame[] = [
  {
    id: 'pd',
    labelEn: "Prisoner's Dilemma",
    labelZh: '囚徒困境',
    rowLabelsEn: ['Cooperate', 'Defect'],
    rowLabelsZh: ['合作', '背叛'],
    colLabelsEn: ['Cooperate', 'Defect'],
    colLabelsZh: ['合作', '背叛'],
    rowPayoffs: [
      [3, 0],
      [5, 1],
    ],
    colPayoffs: [
      [3, 5],
      [0, 1],
    ],
  },
  {
    id: 'hawks-doves',
    labelEn: 'Hawk–Dove (V = 2, C = 6)',
    labelZh: '鹰鸽博弈（V = 2, C = 6）',
    rowLabelsEn: ['Hawk', 'Dove'],
    rowLabelsZh: ['鹰', '鸽'],
    colLabelsEn: ['Hawk', 'Dove'],
    colLabelsZh: ['鹰', '鸽'],
    rowPayoffs: [
      [-2, 2],
      [0, 1],
    ],
    colPayoffs: [
      [-2, 0],
      [2, 1],
    ],
  },
  {
    id: 'matching-pennies',
    labelEn: 'Matching Pennies',
    labelZh: '匹配硬币',
    rowLabelsEn: ['Head', 'Tail'],
    rowLabelsZh: ['正面', '反面'],
    colLabelsEn: ['Head', 'Tail'],
    colLabelsZh: ['正面', '反面'],
    rowPayoffs: [
      [1, -1],
      [-1, 1],
    ],
    colPayoffs: [
      [-1, 1],
      [1, -1],
    ],
  },
  {
    id: 'battle-of-sexes',
    labelEn: 'Battle of the Sexes',
    labelZh: '性别战',
    rowLabelsEn: ['Opera', 'Football'],
    rowLabelsZh: ['歌剧', '足球'],
    colLabelsEn: ['Opera', 'Football'],
    colLabelsZh: ['歌剧', '足球'],
    rowPayoffs: [
      [2, 0],
      [0, 1],
    ],
    colPayoffs: [
      [1, 0],
      [0, 2],
    ],
  },
  {
    id: 'stag-hunt',
    labelEn: 'Stag Hunt',
    labelZh: '猎鹿博弈',
    rowLabelsEn: ['Stag', 'Hare'],
    rowLabelsZh: ['猎鹿', '野兔'],
    colLabelsEn: ['Stag', 'Hare'],
    colLabelsZh: ['猎鹿', '野兔'],
    rowPayoffs: [
      [2, 0],
      [1, 1],
    ],
    colPayoffs: [
      [2, 1],
      [0, 1],
    ],
  },
];

export function sampleGameById(id: string): SampleGame | undefined {
  return SAMPLE_GAMES.find((g) => g.id === id);
}

// ---- payoff text serialisation (custom matrix editing) ---------------------------

/** Serialize two n x m payoff tables as `P1 rows | P2 rows` (`;` rows, `,` cells). */
export function formatPayoffText(rowPayoffs: number[][], colPayoffs: number[][]): string {
  const side = (t: number[][]) => t.map((row) => row.join(',')).join(';');
  return `${side(rowPayoffs)}|${side(colPayoffs)}`;
}

/** Parse the payoff text for an n x m game; null on any shape/value error. */
export function parsePayoffText(
  text: string,
  size: number,
): { rowPayoffs: number[][]; colPayoffs: number[][] } | null {
  const parts = text.split('|');
  if (parts.length !== 2 || size < 2) return null;
  const table = (src: string): number[][] | null => {
    const rows = src.split(';');
    if (rows.length !== size) return null;
    const out: number[][] = [];
    for (const r of rows) {
      const cells = r.split(',');
      if (cells.length !== size) return null;
      const vals: number[] = [];
      for (const c of cells) {
        const v = Number(c.trim());
        if (!Number.isFinite(v)) return null;
        vals.push(v);
      }
      out.push(vals);
    }
    return out;
  };
  const rowPayoffs = table(parts[0] ?? '');
  const colPayoffs = table(parts[1] ?? '');
  if (!rowPayoffs || !colPayoffs) return null;
  return { rowPayoffs, colPayoffs };
}

// ---- replicator dynamics (RK4) --------------------------------------------------------

export type VecField = (s: number[]) => number[];

/** One classic RK4 step of an autonomous vector field (h < 0 integrates back). */
export function rk4StepVec(f: VecField, s: number[], h: number): number[] {
  const k1 = f(s);
  const k2 = f(s.map((v, i) => v + (h / 2) * k1[i]!));
  const k3 = f(s.map((v, i) => v + (h / 2) * k2[i]!));
  const k4 = f(s.map((v, i) => v + h * k3[i]!));
  return s.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
}

/** Clamp to the simplex: box each frequency to [0,1] and renormalize. */
function projectSimplex(v: number[]): number[] {
  const clamped = v.map((x) => Math.min(1, Math.max(0, x)));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum <= 0) return clamped.map(() => 1 / clamped.length);
  return clamped.map((x) => x / sum);
}

/**
 * Two-population replicator field of a normal-form game.
 * `state = [...rowFreqs, ...colFreqs]`; returns ẋ_i = x_i(f_i − f̄) stacked
 * with ẏ_j = y_j(g_j − ḡ).
 */
export function replicatorDerivative(game: NormalFormGame, state: number[]): number[] {
  const m = game.rowPayoffs.length;
  const n = game.rowPayoffs[0]?.length ?? 0;
  const x = state.slice(0, m);
  const y = state.slice(m, m + n);
  const out = new Array<number>(m + n).fill(0);
  const f = new Array<number>(m).fill(0);
  const g = new Array<number>(n).fill(0);
  let fbar = 0;
  let gbar = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) f[i] = (f[i] ?? 0) + y[j]! * game.rowPayoffs[i]![j]!;
    fbar += (x[i] ?? 0) * f[i]!;
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < m; i += 1) g[j] = (g[j] ?? 0) + (x[i] ?? 0) * game.colPayoffs[i]![j]!;
    gbar += (y[j] ?? 0) * g[j]!;
  }
  for (let i = 0; i < m; i += 1) out[i] = (x[i] ?? 0) * (f[i]! - fbar);
  for (let j = 0; j < n; j += 1) out[m + j] = (y[j] ?? 0) * (g[j]! - gbar);
  return out;
}

export interface ReplicatorPoint {
  t: number;
  x: number[];
  y: number[];
}

/** RK4 trajectory of the two-population replicator dynamics. */
export function integrateReplicator(
  game: NormalFormGame,
  x0: number[],
  y0: number[],
  h: number,
  steps: number,
): ReplicatorPoint[] {
  const m = x0.length;
  const field: VecField = (s) => replicatorDerivative(game, s);
  // Each population lives on its OWN simplex: x sums to 1 and y sums to 1.
  // Normalizing the concatenated [x…, y…] vector would instead give each
  // population a total of 0.5, silently pushing the flow off both simplices.
  let x = projectSimplex([...x0]);
  let y = projectSimplex([...y0]);
  const pts: ReplicatorPoint[] = [{ t: 0, x: x.slice(), y: y.slice() }];
  let t = 0;
  for (let k = 0; k < steps; k += 1) {
    const next = rk4StepVec(field, [...x, ...y], h);
    if (!next.every((v) => Number.isFinite(v))) break;
    x = projectSimplex(next.slice(0, m));
    y = projectSimplex(next.slice(m));
    t += h;
    pts.push({ t, x: x.slice(), y: y.slice() });
  }
  return pts;
}

/**
 * Single-population replicator field of a symmetric game:
 * ẋ_i = x_i ((Ax)_i − xᵀAx).
 */
export function replicatorSingleDerivative(payoffs: number[][], x: number[]): number[] {
  const n = payoffs.length;
  const u = new Array<number>(n).fill(0);
  let mean = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) u[i] = (u[i] ?? 0) + payoffs[i]![j]! * (x[j] ?? 0);
    mean += (x[i] ?? 0) * u[i]!;
  }
  return u.map((v, i) => (x[i] ?? 0) * (v - mean));
}

/** RK4 trajectory of the single-population replicator dynamics. */
export function integrateReplicatorSingle(
  payoffs: number[][],
  x0: number[],
  h: number,
  steps: number,
): Array<{ t: number; x: number[] }> {
  const field: VecField = (s) => replicatorSingleDerivative(payoffs, s);
  let s = projectSimplex([...x0]);
  const pts: Array<{ t: number; x: number[] }> = [{ t: 0, x: [...s] }];
  let t = 0;
  for (let k = 0; k < steps; k += 1) {
    s = rk4StepVec(field, s, h);
    if (!s.every((v) => Number.isFinite(v))) break;
    s = projectSimplex(s);
    t += h;
    pts.push({ t, x: [...s] });
  }
  return pts;
}

// ---- extensive form (game trees) ---------------------------------------------------

export interface TreeEdge {
  /** Short action label of the edge (bilingual, drawn on the branch). */
  labelEn: string;
  labelZh: string;
  child: GameTreeNode;
}

export interface GameTreeNode {
  id: string;
  /** Acting player at this node; absent on terminal nodes. */
  player?: number;
  children?: TreeEdge[];
  /** Terminal payoff [player1, player2]. */
  payoff?: [number, number];
}

export interface BackwardInductionResult {
  /** Node ids along the solution path (root first). */
  pathNodeIds: string[];
  /** Action labels along the solution path (bilingual pairs). */
  path: TreeEdge[];
  /** Chosen child index for every decision node on the path. */
  chosen: Array<{ nodeId: string; childIndex: number }>;
  /** Payoffs at the terminal reached by the solution path. */
  payoffs: [number, number];
}

/** Solve an extensive-form game by backward induction (subgame perfection). */
export function backwardInduction(root: GameTreeNode): BackwardInductionResult {
  const chosen = new Map<string, number>();
  const solve = (node: GameTreeNode): [number, number] => {
    const kids = node.children ?? [];
    if (kids.length === 0) return node.payoff ?? [0, 0];
    const vals = kids.map((e) => solve(e.child));
    const p = node.player ?? 0;
    let best = 0;
    for (let k = 1; k < vals.length; k += 1) {
      if ((vals[k]![p] ?? 0) > (vals[best]![p] ?? 0)) best = k; // ties keep the first action
    }
    chosen.set(node.id, best);
    return vals[best]!;
  };
  const payoffs = solve(root);
  const pathNodeIds: string[] = [root.id];
  const path: TreeEdge[] = [];
  const chosenList: BackwardInductionResult['chosen'] = [];
  let node = root;
  for (;;) {
    const kids = node.children ?? [];
    if (kids.length === 0) break;
    const idx = chosen.get(node.id) ?? 0;
    const edge = kids[idx]!;
    chosenList.push({ nodeId: node.id, childIndex: idx });
    path.push(edge);
    node = edge.child;
    pathNodeIds.push(node.id);
  }
  return { pathNodeIds, path, chosen: chosenList, payoffs };
}

export interface TreeSample {
  id: string;
  labelEn: string;
  labelZh: string;
  root: GameTreeNode;
}

export const EXAMPLE_TREES: TreeSample[] = [
  {
    id: 'entry-deterrence',
    labelEn: 'Entry deterrence',
    labelZh: '市场进入威慑',
    root: {
      id: 'e-root',
      player: 0,
      children: [
        {
          labelEn: 'Stay out',
          labelZh: '不进入',
          child: { id: 'e-out', payoff: [0, 2] },
        },
        {
          labelEn: 'Enter',
          labelZh: '进入',
          child: {
            id: 'e-inc',
            player: 1,
            children: [
              { labelEn: 'Fight', labelZh: '反击', child: { id: 'e-fight', payoff: [-1, 0] } },
              { labelEn: 'Accommodate', labelZh: '容纳', child: { id: 'e-acc', payoff: [1, 1] } },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'centipede',
    labelEn: 'Centipede (3 stages)',
    labelZh: '蜈蚣博弈（3 阶段）',
    root: {
      id: 'c0',
      player: 0,
      children: [
        { labelEn: 'Take', labelZh: '拿取', child: { id: 'c-t0', payoff: [1, 0] } },
        {
          labelEn: 'Pass',
          labelZh: '传递',
          child: {
            id: 'c1',
            player: 1,
            children: [
              { labelEn: 'Take', labelZh: '拿取', child: { id: 'c-t1', payoff: [0, 2] } },
              {
                labelEn: 'Pass',
                labelZh: '传递',
                child: {
                  id: 'c2',
                  player: 0,
                  children: [
                    { labelEn: 'Take', labelZh: '拿取', child: { id: 'c-t2', payoff: [3, 1] } },
                    { labelEn: 'Pass', labelZh: '传递', child: { id: 'c-t3', payoff: [2, 3] } },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
];

export function treeSampleById(id: string): TreeSample | undefined {
  return EXAMPLE_TREES.find((t) => t.id === id);
}

// ---- auctions --------------------------------------------------------------------------

export type AuctionFormat = 'first' | 'second' | 'english';

export interface AuctionFormatInfo {
  id: AuctionFormat;
  labelEn: string;
  labelZh: string;
}

export const AUCTION_FORMATS: AuctionFormatInfo[] = [
  { id: 'first', labelEn: 'First-price sealed bid', labelZh: '一价密封拍卖' },
  { id: 'second', labelEn: 'Second-price sealed bid (VCG)', labelZh: '二价密封拍卖（VCG）' },
  { id: 'english', labelEn: 'English clock auction', labelZh: '英式钟表拍卖' },
];

/** Deterministic 32-bit PRNG (mulberry32) — reproducible across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ValuationSampleOptions {
  nBidders: number;
  nAuctions: number;
  min: number;
  max: number;
  seed: number;
}

/** i.i.d. uniform private valuations: nAuctions rows x nBidders columns. */
export function sampleValuations(opts: ValuationSampleOptions): number[][] {
  const rnd = mulberry32(opts.seed);
  const out: number[][] = [];
  for (let a = 0; a < opts.nAuctions; a += 1) {
    const row: number[] = [];
    for (let b = 0; b < opts.nBidders; b += 1) {
      row.push(opts.min + (opts.max - opts.min) * rnd());
    }
    out.push(row);
  }
  return out;
}

export interface AuctionOutcome {
  /** Index of the winning (highest-value under truthful bidding) bidder. */
  winner: number;
  /** Price paid by the winner. */
  price: number;
  /** Seller revenue (equal to the price for these formats). */
  revenue: number;
}

function argMax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i]! > values[best]!) best = i;
  return best;
}

/**
 * Run one auction over truthful private valuations.
 * - first: winner pays her own bid (= valuation).
 * - second: winner pays the highest rival bid (= single-item VCG).
 * - english: clock price rises in steps of `tick`; the runner-up drops when
 *   the clock first exceeds her valuation, which is the price paid.
 */
export function runAuction(format: AuctionFormat, valuations: number[], tick = 0.25): AuctionOutcome {
  const n = valuations.length;
  if (n === 0) return { winner: -1, price: 0, revenue: 0 };
  const winner = argMax(valuations);
  if (format === 'first') {
    const price = valuations[winner]!;
    return { winner, price, revenue: price };
  }
  if (format === 'second') {
    let second = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (i === winner) continue;
      if (valuations[i]! > second) second = valuations[i]!;
    }
    const price = n > 1 && Number.isFinite(second) ? second : 0;
    return { winner, price, revenue: price };
  }
  // English clock auction.
  if (n === 1) return { winner, price: 0, revenue: 0 };
  const step = tick > 0 ? tick : 0.25;
  const active = new Set<number>();
  for (let i = 0; i < n; i += 1) active.add(i);
  let ticks = 0;
  let revenue = 0;
  while (active.size > 1 && ticks < 1e6) {
    ticks += 1;
    const price = ticks * step;
    const dropped: number[] = [];
    for (const i of active) if (valuations[i]! < price) dropped.push(i);
    if (dropped.length > 0) {
      for (const i of dropped) active.delete(i);
      if (active.size <= 1) revenue = price;
    }
  }
  if (active.size === 0) {
    // All remaining bidders dropped on the same tick (tied valuations):
    // the runner-up still paid that clock price.
    revenue = revenue || ticks * step;
  }
  return { winner, price: revenue, revenue };
}

export interface AuctionSimulation {
  format: AuctionFormat;
  revenues: number[];
  meanRevenue: number;
  minRevenue: number;
  maxRevenue: number;
  /** Share of auctions allocated to the highest-valuation bidder. */
  efficiency: number;
}

/** Simulate every requested format over one shared valuation sample. */
export function simulateAuctions(
  valuations: number[][],
  formats: AuctionFormat[],
  tick = 0.25,
): Record<AuctionFormat, AuctionSimulation> {
  const out = {} as Record<AuctionFormat, AuctionSimulation>;
  for (const format of formats) {
    const revenues: number[] = [];
    let efficient = 0;
    for (const vals of valuations) {
      const oc = runAuction(format, vals, tick);
      revenues.push(oc.revenue);
      if (vals.length > 0 && oc.winner === argMax(vals)) efficient += 1;
    }
    const mean = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;
    out[format] = {
      format,
      revenues,
      meanRevenue: mean,
      minRevenue: revenues.length > 0 ? Math.min(...revenues) : 0,
      maxRevenue: revenues.length > 0 ? Math.max(...revenues) : 0,
      efficiency: revenues.length > 0 ? efficient / revenues.length : 0,
    };
  }
  return out;
}

/** Single-item VCG (Clarke pivot) payment: the winner faces her highest rival value. */
export function vcgPayment(valuations: number[]): number {
  if (valuations.length < 2) return 0;
  let max = -Infinity;
  let second = -Infinity;
  for (const v of valuations) {
    if (v >= max) {
      second = max;
      max = v;
    } else if (v > second) {
      second = v;
    }
  }
  return Number.isFinite(second) ? second : 0;
}

/**
 * Incentive-compatibility gap: the largest gain any bidder can reach by
 * deviating from truthful bidding in a second-price / VCG auction (0 =
 * truthful bidding is weakly dominant). Bids are scanned on a grid over
 * [0, max valuation].
 */
export function incentiveCompatibilityGap(valuations: number[], grid = 201): number {
  const n = valuations.length;
  if (n < 2) return 0;
  const maxV = Math.max(...valuations);
  let gap = 0;
  for (let i = 0; i < n; i += 1) {
    let others = -Infinity;
    for (let k = 0; k < n; k += 1) if (k !== i && valuations[k]! > others) others = valuations[k]!;
    const truthful = valuations[i]! > others ? valuations[i]! - others : 0;
    for (let g = 0; g < grid; g += 1) {
      const b = (maxV * g) / (grid - 1);
      const utility = b > others ? valuations[i]! - others : 0;
      gap = Math.max(gap, utility - truthful);
    }
  }
  return Math.max(0, gap);
}

export interface MechanismComparison {
  /** Mean revenue of the first-price auction under truthful bidding. */
  meanFirstPriceRevenue: number;
  /** Mean VCG revenue (equivalently second-price) under truthful bidding. */
  meanVcgRevenue: number;
  /** first-price minus VCG revenue (positive = first price extracts more here). */
  revenueGap: number;
}

/** Compare first-price vs VCG revenue over a sample of valuation profiles. */
export function compareMechanisms(valuations: number[][]): MechanismComparison {
  let first = 0;
  let vcg = 0;
  for (const vals of valuations) {
    first += runAuction('first', vals).revenue;
    vcg += vcgPayment(vals);
  }
  const n = Math.max(1, valuations.length);
  const meanFirstPriceRevenue = first / n;
  const meanVcgRevenue = vcg / n;
  return { meanFirstPriceRevenue, meanVcgRevenue, revenueGap: meanFirstPriceRevenue - meanVcgRevenue };
}

// ---- embedded validation benchmarks ---------------------------------------------

export const GAME_BENCHMARK_ID = 'game-benchmarks';

export interface GameBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  passed: boolean;
  /** Unified relative error |computed − analytic|/|analytic| (denominator floored at 1 for a zero target). */
  relErr: number;
  detailEn: string;
  detailZh: string;
}

/**
 * Run the embedded validation suite:
 * (1) the Prisoner's Dilemma has the unique pure equilibrium (Defect, Defect);
 * (2) Matching Pennies mixed equilibrium (1/2, 1/2);
 * (3) Hawk–Dove mixed equilibrium p = V/C = 1/3;
 * (4) single-population replicator dynamics converges to the Hawk–Dove ESS;
 * (5) second-price auction revenue equals the second-highest valuation;
 * (6) computed equilibria satisfy the no-profitable-deviation condition.
 * Unified metric throughout: |computed − analytic|/|analytic|.
 */
export function runGameBenchmarks(): GameBenchmark[] {
  const out: GameBenchmark[] = [];

  // (1) Prisoner's Dilemma: unique pure NE (Defect, Defect) = ((0,1),(0,1)).
  const pd = sampleGameById('pd')!;
  const pure = findPureNE(pd);
  const ref = [0, 1, 0, 1];
  const vec = pure.length === 1 ? [...pure[0]!.row, ...pure[0]!.col] : [];
  let e1 = Infinity;
  if (pure.length === 1) {
    e1 = Math.max(...vec.map((v, k) => Math.abs(v - ref[k]!))) / Math.max(...ref.map(Math.abs));
  }
  out.push({
    id: 'pd-pure-ne',
    labelEn: "Prisoner's Dilemma unique pure NE (Defect, Defect)",
    labelZh: '囚徒困境唯一纯策略均衡（背叛, 背叛）',
    passed: pure.length === 1 && e1 < 1e-12,
    relErr: e1,
    detailEn: `found ${pure.length} pure equilibria${pure.length === 1 ? ` at (Defect, Defect), payoffs (${pure[0]!.u1}, ${pure[0]!.u2})` : ''}; L∞ deviation of the strategy vectors from the reference ÷ ‖ref‖∞ = ${Number.isFinite(e1) ? e1.toExponential(2) : 'n/a'}`,
    detailZh: `找到 ${pure.length} 个纯均衡${pure.length === 1 ? `，位于（背叛, 背叛），收益 (${pure[0]!.u1}, ${pure[0]!.u2})` : ''}；策略向量 L∞ 偏差 ÷ ‖ref‖∞ = ${Number.isFinite(e1) ? e1.toExponential(2) : 'n/a'}`,
  });

  // (2) Matching Pennies: unique mixed equilibrium (1/2, 1/2).
  const mp = solveMixed2x2(sampleGameById('matching-pennies')!);
  const e2 = mp ? Math.max(Math.abs(mp.row[0]! - 0.5), Math.abs(mp.col[0]! - 0.5)) / 0.5 : Infinity;
  out.push({
    id: 'matching-pennies-mixed',
    labelEn: 'Matching Pennies mixed equilibrium (1/2, 1/2)',
    labelZh: '匹配硬币混合均衡 (1/2, 1/2)',
    passed: !!mp && e2 < 1e-12,
    relErr: e2,
    detailEn: mp
      ? `p = ${mp.row[0]!.toPrecision(12)}, q = ${mp.col[0]!.toPrecision(12)}; payoffs (${mp.u1}, ${mp.u2})`
      : 'no interior mixed equilibrium found',
    detailZh: mp
      ? `p = ${mp.row[0]!.toPrecision(12)}，q = ${mp.col[0]!.toPrecision(12)}；收益 (${mp.u1}, ${mp.u2})`
      : '未找到内部混合均衡',
  });

  // (3) Hawk–Dove: closed-form mixed equilibrium p = V/C = 2/6 = 1/3.
  const hd = solveMixed2x2(sampleGameById('hawks-doves')!);
  const ref3 = 1 / 3;
  const e3 = hd ? Math.abs(hd.row[0]! - ref3) / ref3 : Infinity;
  out.push({
    id: 'hawk-dove-mixed',
    labelEn: 'Hawk–Dove mixed equilibrium vs V/C = 1/3',
    labelZh: '鹰鸽博弈混合均衡对照 V/C = 1/3',
    passed: !!hd && e3 < 1e-12,
    relErr: e3,
    detailEn: hd
      ? `p(Hawk) = ${hd.row[0]!.toPrecision(12)} vs 2/6 = ${ref3.toPrecision(12)}; expected payoff ${hd.u1.toPrecision(8)}`
      : 'no interior mixed equilibrium found',
    detailZh: hd
      ? `p(鹰) = ${hd.row[0]!.toPrecision(12)} 对照 2/6 = ${ref3.toPrecision(12)}；期望收益 ${hd.u1.toPrecision(8)}`
      : '未找到内部混合均衡',
  });

  // (4) Replicator dynamics converges to the Hawk–Dove ESS (x* = 1/3).
  const traj = integrateReplicatorSingle(sampleGameById('hawks-doves')!.rowPayoffs, [0.8, 0.2], 0.01, 3000);
  const last = traj[traj.length - 1]!.x[0]!;
  const e4 = Math.abs(last - ref3) / ref3;
  out.push({
    id: 'replicator-ess',
    labelEn: 'Replicator dynamics converges to the Hawk–Dove ESS 1/3 (< 1e-4)',
    labelZh: '复制者动态收敛到鹰鸽 ESS 1/3（< 1e-4）',
    passed: e4 < 1e-4,
    relErr: e4,
    detailEn: `single-population RK4 from (0.8, 0.2), h = 0.01, T = ${traj[traj.length - 1]!.t.toFixed(2)} → x = ${last.toPrecision(12)} vs 1/3`,
    detailZh: `单群体 RK4 自 (0.8, 0.2)，h = 0.01，T = ${traj[traj.length - 1]!.t.toFixed(2)} → x = ${last.toPrecision(12)} 对照 1/3`,
  });

  // (5) Second-price revenue equals the second-highest valuation exactly.
  const vals = [8.5, 3.25, 9.75, 6];
  const ref5 = 8.5;
  const rev5 = runAuction('second', vals).revenue;
  const e5 = Math.abs(rev5 - ref5) / ref5;
  out.push({
    id: 'second-price-revenue',
    labelEn: 'Second-price revenue = second-highest valuation (relErr = 0)',
    labelZh: '二价拍卖收益 = 第二高估值（relErr = 0）',
    passed: e5 < 1e-15,
    relErr: e5,
    detailEn: `valuations [${vals.join(', ')}] → revenue ${rev5} vs second-highest ${ref5}`,
    detailZh: `估值 [${vals.join(', ')}] → 收益 ${rev5} 对照第二高估值 ${ref5}`,
  });

  // (6) Nash no-deviation condition at the computed Hawk–Dove mixed equilibrium.
  const eq6 = findNash(sampleGameById('hawks-doves')!).find((e) => e.kind === 'mixed') ?? null;
  const e6 = eq6 ? noDeviationGap(sampleGameById('hawks-doves')!, eq6) : Infinity;
  out.push({
    id: 'nash-no-deviation',
    labelEn: 'Nash no-deviation gap at the mixed equilibrium (< 1e-9)',
    labelZh: '混合均衡处的纳什无偏离间隙（< 1e-9）',
    passed: !!eq6 && e6 < 1e-9,
    relErr: e6,
    detailEn: eq6
      ? `max unilateral gain = ${e6.toExponential(2)} (analytic target 0, denominator floored at 1); p = ${eq6.row[0]!.toPrecision(8)}`
      : 'no mixed equilibrium found',
    detailZh: eq6
      ? `单方最大增益 = ${e6.toExponential(2)}（解析目标 0，分母下限取 1）；p = ${eq6.row[0]!.toPrecision(8)}`
      : '未找到混合均衡',
  });

  return out;
}
