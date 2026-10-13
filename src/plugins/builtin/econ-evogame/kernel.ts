// ==========================================================================
// econ-evogame — Nowak-May spatial prisoner's dilemma (pure, testable)
//
// A 2-D lattice of cooperators (1) and defectors (0). Each generation every
// cell plays the prisoner's dilemma against its 8 neighbours plus itself
// (R=1, S=0, T=b, P=0 — Nowak & May 1992), and then adopts the strategy of
// the highest-scoring cell in its closed neighbourhood (ties keep the own
// strategy, which makes the all-C / all-D states exact fixed points).
// Synchronous and async (random-sweep) updates are both fully deterministic
// under a fixed seed. All functions are pure — no canvas, no DOM.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type Boundary = 'periodic' | 'absorbing';
export type UpdateMode = 'sync' | 'async';

export const COOPERATE = 1;
export const DEFECT = 0;

export interface Grid {
  w: number;
  h: number;
  /** Row-major cells; 1 = cooperator, 0 = defector. */
  cells: Uint8Array;
}

export interface EvoParams {
  /** Temptation to defect (T = b); R=1, S=0, P=0. */
  b: number;
  w: number;
  h: number;
  /** Initial cooperation probability for a random lattice. */
  initCoop: number;
  /** Per-cell strategy mutation probability per generation. */
  mutation: number;
  boundary: Boundary;
  updateMode: UpdateMode;
  seed: number;
}

export const DEFAULT_EVO_PARAMS: EvoParams = {
  b: 1.8,
  w: 64,
  h: 64,
  initCoop: 0.5,
  mutation: 0,
  boundary: 'periodic',
  updateMode: 'sync',
  seed: 20260922,
};

/** Moore-8 neighbourhood offsets. */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// ---- lattice construction ----------------------------------------------------

export function makeRandomGrid(w: number, h: number, coopProb: number, rand: () => number): Grid {
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i += 1) cells[i] = rand() < coopProb ? COOPERATE : DEFECT;
  return { w, h, cells };
}

export function makeUniformGrid(w: number, h: number, strategy: 0 | 1): Grid {
  return { w, h, cells: new Uint8Array(w * h).fill(strategy) };
}

export function cloneGrid(g: Grid): Grid {
  return { w: g.w, h: g.h, cells: g.cells.slice() };
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.cells.length; i += 1) {
    if (a.cells[i] !== b.cells[i]) return false;
  }
  return true;
}

// ---- payoffs & scoring ---------------------------------------------------------

/**
 * Payoff of `self` against `other` under R=1, S=0, T=b, P=0:
 * C vs C → 1, C vs D → 0, D vs C → b, D vs D → 0.
 */
export function payoff(self: number, other: number, b: number): number {
  if (self === other) return self === COOPERATE ? 1 : 0;
  return self === COOPERATE ? 0 : b;
}

/**
 * Total score of cell (x, y): games against the 8 neighbours plus one
 * self-interaction. Boundary cells simply play fewer games ('absorbing').
 */
export function cellScore(g: Grid, x: number, y: number, b: number, boundary: Boundary): number {
  const me = g.cells[y * g.w + x] ?? DEFECT;
  let s = payoff(me, me, b);
  for (const [dx, dy] of NEIGHBORS) {
    let nx = x + dx;
    let ny = y + dy;
    if (boundary === 'periodic') {
      nx = (nx + g.w) % g.w;
      ny = (ny + g.h) % g.h;
    } else if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) {
      continue;
    }
    s += payoff(me, g.cells[ny * g.w + nx] ?? DEFECT, b);
  }
  return s;
}

/**
 * Strategy the cell will adopt next: the highest-scoring strategy in its
 * closed neighbourhood. Strict comparison means ties keep the own strategy —
 * this is what makes uniform lattices exact fixed points.
 */
export function adoptStrategy(g: Grid, x: number, y: number, b: number, boundary: Boundary): number {
  let best = cellScore(g, x, y, b, boundary);
  let strat = g.cells[y * g.w + x] ?? DEFECT;
  for (const [dx, dy] of NEIGHBORS) {
    let nx = x + dx;
    let ny = y + dy;
    if (boundary === 'periodic') {
      nx = (nx + g.w) % g.w;
      ny = (ny + g.h) % g.h;
    } else if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) {
      continue;
    }
    const sc = cellScore(g, nx, ny, b, boundary);
    if (sc > best) {
      best = sc;
      strat = g.cells[ny * g.w + nx] ?? DEFECT;
    }
  }
  return strat;
}

// ---- generation steps ------------------------------------------------------------

/** One synchronous generation: scores from the old lattice, then all adopt. */
export function stepSync(g: Grid, b: number, boundary: Boundary, mutation: number, rand: () => number): Grid {
  const cells = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y += 1) {
    for (let x = 0; x < g.w; x += 1) {
      let s = adoptStrategy(g, x, y, b, boundary);
      if (mutation > 0 && rand() < mutation) s = s === COOPERATE ? DEFECT : COOPERATE;
      cells[y * g.w + x] = s;
    }
  }
  return { w: g.w, h: g.h, cells };
}

/**
 * One async sweep: all cells visited once in a seeded random order, each
 * adopting immediately from the partially updated lattice (in place).
 */
export function stepAsync(g: Grid, b: number, boundary: Boundary, mutation: number, rand: () => number): void {
  const n = g.w * g.h;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  for (let i = 0; i < n; i += 1) {
    const k = order[i]!;
    const x = k % g.w;
    const y = Math.floor(k / g.w);
    let s = adoptStrategy(g, x, y, b, boundary);
    if (mutation > 0 && rand() < mutation) s = s === COOPERATE ? DEFECT : COOPERATE;
    g.cells[k] = s;
  }
}

// ---- statistics -----------------------------------------------------------------

/** Fraction of cooperators f_C. */
export function coopFraction(g: Grid): number {
  let c = 0;
  for (let i = 0; i < g.cells.length; i += 1) c += g.cells[i]!;
  return c / Math.max(1, g.cells.length);
}

/** Mean score per cell over the whole lattice. */
export function averageScore(g: Grid, b: number, boundary: Boundary): number {
  let s = 0;
  for (let y = 0; y < g.h; y += 1) {
    for (let x = 0; x < g.w; x += 1) s += cellScore(g, x, y, b, boundary);
  }
  return s / Math.max(1, g.w * g.h);
}

// ---- driver -----------------------------------------------------------------------

export interface EvoSeries {
  /** f_C(t), index 0 = initial state. */
  fc: number[];
  /** Mean score per generation. */
  score: number[];
}

export interface EvoRun {
  grid: Grid;
  series: EvoSeries;
  generations: number;
}

/**
 * Run `generations` generations from `start`, recording f_C and the mean
 * score each step. Fully deterministic given the params' seed.
 */
export function simulate(start: Grid, p: EvoParams, generations: number): EvoRun {
  const rand = mulberry32(p.seed >>> 0 || 1);
  const grid = cloneGrid(start);
  const fc: number[] = [coopFraction(grid)];
  const score: number[] = [averageScore(grid, p.b, p.boundary)];
  for (let t = 0; t < generations; t += 1) {
    if (p.updateMode === 'async') stepAsync(grid, p.b, p.boundary, p.mutation, rand);
    else grid.cells.set(stepSync(grid, p.b, p.boundary, p.mutation, rand).cells);
    fc.push(coopFraction(grid));
    score.push(averageScore(grid, p.b, p.boundary));
  }
  return { grid, series: { fc, score }, generations };
}

/** Convenience: random start lattice for the given params. */
export function initialGrid(p: EvoParams): Grid {
  return makeRandomGrid(p.w, p.h, p.initCoop, mulberry32(p.seed >>> 0 || 1));
}

// ---- embedded validation benchmark -------------------------------------------------

export const EVO_BENCHMARK = {
  id: 'nowak-may-spatial-pd',
  /** The hand-checked scenario: 5x5, central C, all else D, b = 1.8. */
  b: 1.8,
} as const;

export interface EvoBenchmark {
  allCInvariant: boolean;
  allDInvariant: boolean;
  /** Max |score - hand-computed reference| over the 5x5 scenario (criterion: 0). */
  handScoreErr: number;
  /** 5x5 scenario collapses to all-D after one sync generation (criterion: true). */
  handCollapse: boolean;
  /** Sync + async sweeps reproduce exactly under the same seed. */
  deterministic: boolean;
  pass: boolean;
}

/**
 * Reference scores for the hand-checked scenario: 5x5 absorbing lattice,
 * centre (2,2) = C and every other cell = D, b = 1.8.
 *   centre: self R=1 + 8×S=0        → 1
 *   the 8 cells adjacent to centre: one T=b game → 1.8
 *   remaining 16 cells: all-D games → 0
 */
function handScoreReference(b: number): number[] {
  const ref = new Array<number>(25).fill(0);
  ref[2 * 5 + 2] = 1; // centre: self-play R
  for (const [dx, dy] of NEIGHBORS) ref[(2 + dy) * 5 + (2 + dx)] = b; // adjacent cells earn T=b
  return ref;
}

/**
 * Run the embedded Nowak-May validation battery (fixed points, hand-computed
 * scores, determinism). Uniform relative error metric: |computed - reference|
 * / max(1, |reference|) — the score reference is bounded away from 0 by the
 * centre cell's payoff.
 */
export function runEvogameBenchmark(): EvoBenchmark {
  // (1) all-C / all-D fixed points (sync + async, no mutation).
  let allCInvariant = true;
  let allDInvariant = true;
  {
    const c0 = makeUniformGrid(12, 12, COOPERATE);
    const randC = mulberry32(7);
    const c1 = stepSync(c0, 1.8, 'periodic', 0, randC);
    allCInvariant = gridsEqual(c0, c1);
    const cAsync = cloneGrid(c0);
    stepAsync(cAsync, 1.8, 'periodic', 0, mulberry32(7));
    allCInvariant = allCInvariant && gridsEqual(c0, cAsync);

    const d0 = makeUniformGrid(12, 12, DEFECT);
    const d1 = stepSync(d0, 1.8, 'periodic', 0, mulberry32(7));
    allDInvariant = gridsEqual(d0, d1);
    const dAsync = cloneGrid(d0);
    stepAsync(dAsync, 1.8, 'periodic', 0, mulberry32(7));
    allDInvariant = allDInvariant && gridsEqual(d0, dAsync);
  }

  // (2) hand-computed 5x5 score reference + collapse to all-D.
  let handScoreErr = 0;
  let handCollapse = false;
  {
    const g = makeUniformGrid(5, 5, DEFECT);
    g.cells[2 * 5 + 2] = COOPERATE;
    const ref = handScoreReference(EVO_BENCHMARK.b);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const got = cellScore(g, x, y, EVO_BENCHMARK.b, 'absorbing');
        const want = ref[y * 5 + x]!;
        handScoreErr = Math.max(handScoreErr, Math.abs(got - want) / Math.max(1, Math.abs(want)));
      }
    }
    const next = stepSync(g, EVO_BENCHMARK.b, 'absorbing', 0, mulberry32(1));
    handCollapse = coopFraction(next) === 0;
  }

  // (3) determinism: identical seeds → identical trajectories (sync & async).
  let deterministic = true;
  {
    const p: EvoParams = { ...DEFAULT_EVO_PARAMS, w: 24, h: 24, updateMode: 'sync', seed: 42 };
    const a = simulate(initialGrid(p), p, 12);
    const c = simulate(initialGrid(p), p, 12);
    deterministic = deterministic && gridsEqual(a.grid, c.grid) && a.series.fc.every((v, i) => v === c.series.fc[i]);
    const pa: EvoParams = { ...p, updateMode: 'async' };
    const b1 = simulate(initialGrid(pa), pa, 12);
    const b2 = simulate(initialGrid(pa), pa, 12);
    deterministic = deterministic && gridsEqual(b1.grid, b2.grid) && b1.series.fc.every((v, i) => v === b2.series.fc[i]);
  }

  return {
    allCInvariant,
    allDInvariant,
    handScoreErr,
    handCollapse,
    deterministic,
    pass: allCInvariant && allDInvariant && handScoreErr === 0 && handCollapse && deterministic,
  };
}

// ---- qualitative spatial-pattern verdict ---------------------------------------------

export interface EvoRegime {
  key: 'cooperative' | 'mosaic' | 'defection';
  en: string;
  zh: string;
}

/**
 * Qualitative verdict on the final spatial pattern (Nowak-May regimes):
 * cooperative dominance / spatial coexistence mosaic / defection sweep.
 */
export function classifyRegime(fC: number): EvoRegime {
  if (fC >= 0.5) {
    return {
      key: 'cooperative',
      en: 'cooperative dominance (f_C ≥ 0.5)',
      zh: '合作主导（f_C ≥ 0.5）',
    };
  }
  if (fC >= 0.02) {
    return {
      key: 'mosaic',
      en: 'spatial coexistence mosaic (0.02 ≤ f_C < 0.5)',
      zh: '空间共存斑图（0.02 ≤ f_C < 0.5）',
    };
  }
  return {
    key: 'defection',
    en: 'defection sweep (f_C < 0.02)',
    zh: '背叛蔓延（f_C < 0.02）',
  };
}
