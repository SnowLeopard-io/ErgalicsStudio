// ==========================================================================
// socio-opinion — public opinion diffusion on social networks (pure, testable)
//
// A small deterministic laboratory for opinion spreading: random / small-world
// / echo-chamber networks with seeded node opinions, three cascade models
// (independent cascade with per-edge probability, linear threshold with
// neighbor-weighted activation, competing rumor-vs-fact-checker cascades),
// echo-chamber metrics (opinion homophily index, per-node cross-cutting
// exposure diversity), CELF-style greedy influence maximization and a
// bounded-confidence / DeGroot-style opinion-averaging second mode.
//
// Everything is pure — no canvas, no DOM — and fully deterministic under a
// fixed seed. Threshold-style adoption follows Granovetter (1978); the greedy
// influence maximization follows Kempe-Kleinberg-Terman (2003); the echo-
// chamber metrics paraphrase the filter-bubble literature.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type CascadeModel = 'independent-cascade' | 'linear-threshold' | 'competing-cascades';
export type NetworkKind = 'random' | 'small-world' | 'echo-chamber';
export type OpinionMode = 'static' | 'average' | 'bounded';
export type ThresholdMode = 'seeded' | 'fixed';

/** Node states: susceptible, adopted (rumor spreader), corrected (fact-checked). */
export const SUSCEPTIBLE = 0;
export const ADOPTED = 1;
export const CORRECTED = 2;

/** Opinion half-width that defines a "same-opinion" edge for echo metrics. */
export const OPINION_BOUND = 0.15;

/** Watts-Strogatz ring-lattice rewiring probability used by the plugin. */
export const WS_REWIRE_PROB = 0.15;

// ---- network model -----------------------------------------------------------

export interface SocialEdge {
  u: number;
  v: number;
  /** Edge weight in (0, 1]; the effective cascade probability is p * w. */
  w: number;
}

export interface SocialNetwork {
  n: number;
  /** Undirected edges, u < v, deduplicated, construction order. */
  edges: SocialEdge[];
  /** Per-node neighbour lists, ascending node index, with edge weights. */
  adj: Array<Array<{ node: number; w: number }>>;
}

export interface OpinionParams {
  model: CascadeModel;
  network: NetworkKind;
  nNodes: number;
  avgDegree: number;
  /** Echo-chamber rewiring strength in [0, 1]. */
  homophily: number;
  /** Per-edge adoption probability p (effective probability is p * w). */
  spreadProb: number;
  /** Fact-checker success probability (competing cascades). */
  correctionProb: number;
  /** Number of initial adopter seeds k (also the greedy budget). */
  seedCount: number;
  /** Draw initial seeds uniformly at random instead of the lowest indices. */
  randomSeeds: boolean;
  thresholdMode: ThresholdMode;
  /** Fixed linear-threshold value used when thresholdMode = 'fixed'. */
  threshold: number;
  opinionMode: OpinionMode;
  seed: number;
}

export const DEFAULT_OPINION_PARAMS: OpinionParams = {
  model: 'independent-cascade',
  network: 'random',
  nNodes: 80,
  avgDegree: 4,
  homophily: 0.5,
  spreadProb: 0.5,
  correctionProb: 0.4,
  seedCount: 3,
  randomSeeds: true,
  thresholdMode: 'seeded',
  threshold: 0.5,
  opinionMode: 'static',
  seed: 20260922,
};

/** Assemble the canonical representation (sorted dedup edges + adjacency). */
export function networkFromEdges(n: number, edges: SocialEdge[]): SocialNetwork {
  const seen = new Set<string>();
  const clean: SocialEdge[] = [];
  for (const e of edges) {
    const lo = Math.min(e.u, e.v);
    const hi = Math.max(e.u, e.v);
    if (lo === hi || lo < 0 || hi >= n) continue;
    const key = `${lo},${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ u: lo, v: hi, w: e.w });
  }
  const adj: Array<Array<{ node: number; w: number }>> = Array.from({ length: n }, () => []);
  for (const e of clean) {
    adj[e.u]!.push({ node: e.v, w: e.w });
    adj[e.v]!.push({ node: e.u, w: e.w });
  }
  for (const list of adj) list.sort((a, b) => a.node - b.node);
  return { n, edges: clean, adj };
}

/** Hand-built path graph 0-1-...-(n-1); optional per-edge weights. */
export function makePathNetwork(n: number, weights?: ReadonlyArray<number>): SocialNetwork {
  const edges: SocialEdge[] = [];
  for (let i = 0; i + 1 < n; i += 1) edges.push({ u: i, v: i + 1, w: weights?.[i] ?? 1 });
  return networkFromEdges(n, edges);
}

/** Erdos-Renyi-style random graph with mean degree ~ avgDegree. */
export function makeRandomNetwork(n: number, avgDegree: number, rand: () => number): SocialNetwork {
  const p = n > 1 ? Math.min(1, avgDegree / (n - 1)) : 0;
  const edges: SocialEdge[] = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = u + 1; v < n; v += 1) {
      if (rand() < p) edges.push({ u, v, w: 1 });
    }
  }
  return networkFromEdges(n, edges);
}

/** Watts-Strogatz small-world: ring lattice of even degree, rewired. */
export function makeSmallWorldNetwork(n: number, avgDegree: number, rewireProb: number, rand: () => number): SocialNetwork {
  const half = Math.max(1, Math.round(avgDegree / 2));
  const edges: SocialEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 1; j <= half; j += 1) {
      edges.push({ u: i, v: (i + j) % n, w: 1 });
    }
  }
  if (rewireProb <= 0) return networkFromEdges(n, edges);
  // Rewire in construction order: keep u, move v to a random non-neighbour.
  const members = Array.from({ length: n }, () => new Set<number>());
  for (const e of edges) {
    members[e.u]!.add(e.v);
    members[e.v]!.add(e.u);
  }
  for (let idx = 0; idx < edges.length; idx += 1) {
    const e = edges[idx]!;
    if (rand() >= rewireProb) continue;
    let target = -1;
    for (let attempt = 0; attempt < n; attempt += 1) {
      const w = Math.floor(rand() * n) % n;
      if (w !== e.u && w !== e.v && !members[e.u]!.has(w)) {
        target = w;
        break;
      }
    }
    if (target < 0) continue;
    members[e.u]!.delete(e.v);
    members[e.v]!.delete(e.u);
    members[e.u]!.add(target);
    members[target]!.add(e.u);
    edges[idx] = { u: e.u, v: target, w: 1 };
  }
  return networkFromEdges(n, edges);
}

/**
 * Echo-chamber network: a random graph whose cross-opinion edges are rewired
 * toward same-opinion targets with probability `homophily`, producing the
 * assortative cluster structure of the filter-bubble literature.
 */
export function makeEchoChamberNetwork(n: number, avgDegree: number, homophily: number, opinions: Float64Array, rand: () => number): SocialNetwork {
  const base = makeRandomNetwork(n, avgDegree, rand);
  if (homophily <= 0) return base;
  const edges = base.edges.map((e) => ({ ...e }));
  const members = Array.from({ length: n }, () => new Set<number>());
  for (const e of edges) {
    members[e.u]!.add(e.v);
    members[e.v]!.add(e.u);
  }
  for (let idx = 0; idx < edges.length; idx += 1) {
    const e = edges[idx]!;
    if (rand() >= homophily) continue;
    const ou = opinions[e.u] ?? 0;
    const ov = opinions[e.v] ?? 0;
    if (Math.abs(ou - ov) <= OPINION_BOUND) continue;
    // Collect same-opinion candidates for u in ascending node order.
    const candidates: number[] = [];
    for (let w = 0; w < n; w += 1) {
      if (w === e.u || w === e.v || members[e.u]!.has(w)) continue;
      if (Math.abs((opinions[w] ?? 0) - ou) <= OPINION_BOUND) candidates.push(w);
    }
    if (candidates.length === 0) continue;
    const target = candidates[Math.floor(rand() * candidates.length) % candidates.length]!;
    members[e.u]!.delete(e.v);
    members[e.v]!.delete(e.u);
    members[e.u]!.add(target);
    members[target]!.add(e.u);
    edges[idx] = { u: Math.min(e.u, target), v: Math.max(e.u, target), w: 1 };
  }
  return networkFromEdges(n, edges);
}

/** Dispatch the configured network generator (deterministic given rand). */
export function buildNetwork(p: OpinionParams, opinions: Float64Array, rand: () => number): SocialNetwork {
  if (p.network === 'small-world') return makeSmallWorldNetwork(p.nNodes, p.avgDegree, WS_REWIRE_PROB, rand);
  if (p.network === 'echo-chamber') return makeEchoChamberNetwork(p.nNodes, p.avgDegree, p.homophily, opinions, rand);
  return makeRandomNetwork(p.nNodes, p.avgDegree, rand);
}

// ---- opinions & metrics ---------------------------------------------------------

/** Seeded initial opinions, uniform in [0, 1). */
export function initialOpinions(n: number, rand: () => number): Float64Array {
  const op = new Float64Array(n);
  for (let i = 0; i < n; i += 1) op[i] = rand();
  return op;
}

/**
 * Opinion homophily index: the fraction of edges whose endpoints hold the
 * same opinion (|op_u - op_v| <= bound). 1 = perfectly assortative
 * echo-chamber structure, 0 = fully cross-cutting exposure.
 */
export function homophilyIndex(net: SocialNetwork, opinions: Float64Array, bound: number = OPINION_BOUND): number {
  if (net.edges.length === 0) return 0;
  let same = 0;
  for (const e of net.edges) {
    if (Math.abs((opinions[e.u] ?? 0) - (opinions[e.v] ?? 0)) <= bound) same += 1;
  }
  return same / net.edges.length;
}

/**
 * Per-node cross-cutting exposure diversity: the fraction of neighbours
 * holding a different opinion (0 for isolated nodes). Averaged over nodes
 * with degree > 0 this gives the mean exposure diversity.
 */
export function exposureDiversity(net: SocialNetwork, opinions: Float64Array, bound: number = OPINION_BOUND): Float64Array {
  const div = new Float64Array(net.n);
  for (let i = 0; i < net.n; i += 1) {
    const nbrs = net.adj[i] ?? [];
    if (nbrs.length === 0) continue;
    let diff = 0;
    for (const { node } of nbrs) {
      if (Math.abs((opinions[node] ?? 0) - (opinions[i] ?? 0)) > bound) diff += 1;
    }
    div[i] = diff / nbrs.length;
  }
  return div;
}

/** Mean cross-cutting exposure diversity over non-isolated nodes. */
export function meanExposureDiversity(net: SocialNetwork, opinions: Float64Array, bound: number = OPINION_BOUND): number {
  const div = exposureDiversity(net, opinions, bound);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < net.n; i += 1) {
    if ((net.adj[i]?.length ?? 0) === 0) continue;
    sum += div[i] ?? 0;
    cnt += 1;
  }
  return cnt > 0 ? sum / cnt : 0;
}

/**
 * One synchronous opinion-averaging step. 'average' is DeGroot-style
 * (each node averages itself with all neighbours); 'bounded' is the
 * bounded-confidence variant that only listens to neighbours within
 * OPINION_BOUND (Deffuant-style confidence limit).
 */
export function opinionStep(net: SocialNetwork, opinions: Float64Array, mode: OpinionMode): Float64Array {
  const next = new Float64Array(net.n);
  for (let i = 0; i < net.n; i += 1) {
    const me = opinions[i] ?? 0;
    let sum = me;
    let cnt = 1;
    for (const { node } of net.adj[i] ?? []) {
      const oj = opinions[node] ?? 0;
      if (mode === 'bounded' && Math.abs(oj - me) > OPINION_BOUND) continue;
      sum += oj;
      cnt += 1;
    }
    next[i] = sum / cnt;
  }
  return next;
}

export function meanOpinion(opinions: Float64Array): number {
  let s = 0;
  for (let i = 0; i < opinions.length; i += 1) s += opinions[i] ?? 0;
  return opinions.length > 0 ? s / opinions.length : 0;
}

/** Population variance of the opinion distribution. */
export function opinionVariance(opinions: Float64Array): number {
  const m = meanOpinion(opinions);
  let s = 0;
  for (let i = 0; i < opinions.length; i += 1) {
    const d = (opinions[i] ?? 0) - m;
    s += d * d;
  }
  return opinions.length > 0 ? s / opinions.length : 0;
}

// ---- seeding ---------------------------------------------------------------------

/**
 * Pick k distinct seed nodes. Deterministic order: uniform random draw
 * (seeded shuffle) when `randomSeeds`, otherwise the lowest free indices.
 * Nodes in `exclude` (e.g. fact-checker seeds) are skipped.
 */
export function pickSeeds(n: number, k: number, randomSeeds: boolean, rand: () => number, exclude?: ReadonlySet<number>): number[] {
  const out: number[] = [];
  const take = (i: number): void => {
    if (out.length < k && !exclude?.has(i)) out.push(i);
  };
  if (randomSeeds) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = idx[i]!;
      idx[i] = idx[j]!;
      idx[j] = tmp;
    }
    for (const i of idx) take(i);
  } else {
    for (let i = 0; i < n && out.length < k; i += 1) take(i);
  }
  return out;
}

// ---- independent cascade ----------------------------------------------------------

/**
 * One cascade wave: every node in `frontier` (activated in the previous
 * step) makes a single seeded attempt on each susceptible neighbour in
 * ascending adjacency order; success activates with probability p * w.
 * Mutates `state`, returns the newly activated nodes.
 */
export function icWave(net: SocialNetwork, state: Uint8Array, frontier: ReadonlyArray<number>, p: number, rand: () => number): number[] {
  const newActive: number[] = [];
  for (const u of frontier) {
    for (const { node: v, w } of net.adj[u] ?? []) {
      if (state[v] !== SUSCEPTIBLE) continue;
      if (rand() < p * w) {
        state[v] = ADOPTED;
        newActive.push(v);
      }
    }
  }
  return newActive;
}

/** Full independent cascade from `seeds` to saturation. */
export function runIndependentCascade(net: SocialNetwork, seeds: ReadonlyArray<number>, p: number, rand: () => number): Uint8Array {
  const state = new Uint8Array(net.n);
  const frontier: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < net.n && state[s] === SUSCEPTIBLE) {
      state[s] = ADOPTED;
      frontier.push(s);
    }
  }
  frontier.sort((a, b) => a - b);
  let wave = frontier;
  while (wave.length > 0) wave = icWave(net, state, wave, p, rand);
  return state;
}

// ---- linear threshold --------------------------------------------------------------

/** Thresholds drawn seeded, uniform in [0, 1). */
export function drawThresholds(net: SocialNetwork, rand: () => number): Float64Array {
  const t = new Float64Array(net.n);
  for (let i = 0; i < net.n; i += 1) t[i] = rand();
  return t;
}

/** Constant threshold vector. */
export function fixedThresholds(net: SocialNetwork, t: number): Float64Array {
  return new Float64Array(net.n).fill(t);
}

/**
 * One synchronous linear-threshold round: an inactive node activates when
 * the weight fraction of its already-active neighbours reaches its
 * threshold (Granovetter 1978; Kempe-Kleinberg-Terman 2003). Mutates
 * `state`, returns the newly activated nodes (ascending).
 */
export function ltWave(net: SocialNetwork, state: Uint8Array, thresholds: Float64Array): number[] {
  const newly: number[] = [];
  for (let v = 0; v < net.n; v += 1) {
    if (state[v] !== SUSCEPTIBLE) continue;
    let activeW = 0;
    let totalW = 0;
    for (const { node: u, w } of net.adj[v] ?? []) {
      totalW += w;
      if (state[u] === ADOPTED) activeW += w;
    }
    if (totalW > 0 && activeW / totalW >= (thresholds[v] ?? 1)) {
      state[v] = ADOPTED;
      newly.push(v);
    }
  }
  return newly;
}

/** Full linear-threshold cascade from `seeds` to the fixed point. */
export function runLinearThreshold(net: SocialNetwork, seeds: ReadonlyArray<number>, thresholds: Float64Array): Uint8Array {
  const state = new Uint8Array(net.n);
  for (const s of seeds) {
    if (s >= 0 && s < net.n) state[s] = ADOPTED;
  }
  let newly = ltWave(net, state, thresholds);
  while (newly.length > 0) newly = ltWave(net, state, thresholds);
  return state;
}

/**
 * Fixed-point check: the cascade has terminated exactly when no inactive
 * node would activate under one more synchronous round (and active nodes
 * never deactivate, so the active set is stable).
 */
export function ltFixedPointStable(net: SocialNetwork, state: Uint8Array, thresholds: Float64Array): boolean {
  return ltWave(net, state.slice(), thresholds).length === 0;
}

// ---- competing cascades -------------------------------------------------------------

/**
 * One synchronous round of the misinformation game: rumour-spreaders in
 * `aFrontier` try to adopt susceptible neighbours with probability pA * w;
 * fact-checkers in `bFrontier` then try to convert susceptible neighbours
 * (probability pB * w) and to correct already-adopted spreaders with the
 * same correction probability. Mutates `state`, returns both new frontiers.
 */
export function competingWave(
  net: SocialNetwork,
  state: Uint8Array,
  aFrontier: ReadonlyArray<number>,
  bFrontier: ReadonlyArray<number>,
  pA: number,
  pB: number,
  rand: () => number,
): { aNew: number[]; bNew: number[] } {
  const aNew: number[] = [];
  for (const u of aFrontier) {
    for (const { node: v, w } of net.adj[u] ?? []) {
      if (state[v] !== SUSCEPTIBLE) continue;
      if (rand() < pA * w) {
        state[v] = ADOPTED;
        aNew.push(v);
      }
    }
  }
  const bNew: number[] = [];
  for (const u of bFrontier) {
    for (const { node: v, w } of net.adj[u] ?? []) {
      const s = state[v];
      if (s !== SUSCEPTIBLE && s !== ADOPTED) continue;
      if (rand() < pB * w) {
        state[v] = CORRECTED;
        bNew.push(v);
      }
    }
  }
  return { aNew, bNew };
}

// ---- influence maximization -----------------------------------------------------------

function countActive(state: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < state.length; i += 1) {
    if (state[i] !== SUSCEPTIBLE) c += 1;
  }
  return c;
}

/**
 * Expected cascade size of `seeds` under the independent cascade,
 * averaged over `sims` seeded simulations (common random numbers per
 * evaluation keep the estimator deterministic).
 */
export function expectedReach(net: SocialNetwork, seeds: ReadonlyArray<number>, p: number, sims: number, seed: number): number {
  if (seeds.length === 0 || net.n === 0) return 0;
  const base = (seed ^ 0x5bd1e995) >>> 0 || 1;
  let total = 0;
  for (let s = 0; s < sims; s += 1) {
    const rand = mulberry32((base + s * 0x9e3779b1) >>> 0 || 1);
    total += countActive(runIndependentCascade(net, seeds, p, rand));
  }
  return total / Math.max(1, sims);
}

/**
 * CELF-style lazy greedy seed selection under the independent cascade
 * (Kempe-Kleinberg-Terman 2003). Deterministic tie-break by node index;
 * marginal gains use the same common-random-number estimator. The queue
 * stores *marginal* gains (stale values are re-evaluated when an element
 * reaches the front again), which is what makes the lazy scheme correct.
 */
export function greedySeeds(net: SocialNetwork, k: number, p: number, sims: number, seed: number): number[] {
  const selected: number[] = [];
  if (k <= 0 || net.n === 0) return selected;
  const base = (seed ^ 0x1b873593) >>> 0 || 1;
  const reach = (set: ReadonlyArray<number>): number => expectedReach(net, set, p, sims, base);
  interface Cell {
    node: number;
    gain: number;
    iter: number;
  }
  const cmp = (a: Cell, b: Cell): number => b.gain - a.gain || a.node - b.node;
  const queue: Cell[] = [];
  for (let v = 0; v < net.n; v += 1) queue.push({ node: v, gain: reach([v]), iter: 0 });
  queue.sort(cmp);
  // Cached sigma(S) for the current selection size (constant within a round).
  let cachedLen = -1;
  let cachedReach = 0;
  while (selected.length < k && queue.length > 0) {
    const top = queue[0]!;
    if (top.iter === selected.length) {
      queue.shift();
      selected.push(top.node);
    } else {
      if (cachedLen !== selected.length) {
        cachedReach = reach(selected);
        cachedLen = selected.length;
      }
      top.gain = reach([...selected, top.node]) - cachedReach;
      top.iter = selected.length;
      queue.sort(cmp);
    }
  }
  return selected;
}

// ---- per-step series --------------------------------------------------------------------

export interface SeriesRow {
  /** Fraction of nodes in the adopted (rumour) state. */
  adopted: number;
  /** Fraction of nodes corrected by fact-checkers (competing mode). */
  corrected: number;
  meanOpinion: number;
  opinionVar: number;
  homophily: number;
}

/** One structured observation of the current simulation state. */
export function opinionSeriesRow(net: SocialNetwork, state: Uint8Array, opinions: Float64Array): SeriesRow {
  let adopted = 0;
  let corrected = 0;
  for (let i = 0; i < state.length; i += 1) {
    if (state[i] === ADOPTED) adopted += 1;
    else if (state[i] === CORRECTED) corrected += 1;
  }
  const n = Math.max(1, state.length);
  return {
    adopted: adopted / n,
    corrected: corrected / n,
    meanOpinion: meanOpinion(opinions),
    opinionVar: opinionVariance(opinions),
    homophily: homophilyIndex(net, opinions),
  };
}

export interface OpinionRun {
  state: Uint8Array;
  rows: SeriesRow[];
  steps: number;
}

/**
 * Run the configured model to saturation (or `maxSteps`) from explicit
 * seed sets, recording a SeriesRow after every step. Fully deterministic.
 */
export function runOpinionSimulation(
  net: SocialNetwork,
  opinions: Float64Array,
  params: OpinionParams,
  seeds: ReadonlyArray<number>,
  factSeeds: ReadonlyArray<number>,
  thresholds: Float64Array,
  maxSteps: number,
): OpinionRun {
  const state = new Uint8Array(net.n);
  const aF: number[] = [];
  const bF: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < net.n && state[s] === SUSCEPTIBLE) {
      state[s] = ADOPTED;
      aF.push(s);
    }
  }
  for (const s of factSeeds) {
    if (s >= 0 && s < net.n && state[s] === SUSCEPTIBLE) {
      state[s] = CORRECTED;
      bF.push(s);
    }
  }
  aF.sort((a, b) => a - b);
  bF.sort((a, b) => a - b);
  let op = opinions.slice();
  const rows: SeriesRow[] = [opinionSeriesRow(net, state, op)];
  let steps = 0;
  const rand = mulberry32(params.seed >>> 0 || 1);
  while (steps < maxSteps) {
    let aNew: number[] = [];
    let bNew: number[] = [];
    if (params.model === 'linear-threshold') {
      aNew = ltWave(net, state, thresholds);
    } else if (params.model === 'competing-cascades') {
      const r = competingWave(net, state, aF, bF, params.spreadProb, params.correctionProb, rand);
      aNew = r.aNew;
      bNew = r.bNew;
    } else {
      aNew = icWave(net, state, aF, params.spreadProb, rand);
    }
    if (aNew.length === 0 && bNew.length === 0) break;
    if (params.model === 'competing-cascades') {
      aF.length = 0;
      aF.push(...aNew);
      bF.length = 0;
      bF.push(...bNew);
    } else {
      aF.length = 0;
      aF.push(...aNew);
    }
    if (params.opinionMode !== 'static') op = opinionStep(net, op, params.opinionMode);
    steps += 1;
    rows.push(opinionSeriesRow(net, state, op));
  }
  return { state, rows, steps };
}

// ---- embedded validation benchmark --------------------------------------------------------

export interface OpinionBenchmark {
  /** Hand-built 4-node chain: exact cascade outcomes for given edge probabilities. */
  chainExact: boolean;
  /** |E[reach] - (1 + p + p^2 + p^3)| for the p = 0.5 chain (criterion: <= 0.08). */
  chainMeanErr: number;
  /** Linear-threshold active set is a fixed point (no further activation). */
  ltFixedPoint: boolean;
  /** Greedy (CELF) matches exhaustive seed search on the tiny two-chain graph. */
  greedyMatchesExhaustive: boolean;
  greedySpread: number;
  exhaustiveSpread: number;
  /** Homophily index and exposure diversity stay within [0, 1] + structure checks. */
  homophilyBounds: boolean;
  /** Identical seeds reproduce identical networks, cascades and series. */
  deterministic: boolean;
  details: string[];
  pass: boolean;
}

/**
 * Run the embedded socio-opinion validation battery. All checks are exact
 * except the p = 0.5 chain mean, which is bounded against the analytic
 * geometric-series reach 1 + p + p^2 + p^3 within a 5-sigma Monte Carlo
 * tolerance at 4000 simulations.
 */
export function runOpinionBenchmark(): OpinionBenchmark {
  const details: string[] = [];

  // (1) hand-built 4-node chain: exact outcomes for given edge probabilities.
  let chainExact = true;
  {
    const chain = makePathNetwork(4);
    const full = runIndependentCascade(chain, [0], 1, mulberry32(5));
    chainExact = chainExact && countActive(full) === 4;
    // Middle edge carries probability 0 (weight 0 at p = 1) -> cascade stops.
    const broken = makePathNetwork(4, [1, 0, 1]);
    const head = runIndependentCascade(broken, [0], 1, mulberry32(5));
    chainExact =
      chainExact &&
      head[0] === ADOPTED &&
      head[1] === ADOPTED &&
      head[2] === SUSCEPTIBLE &&
      head[3] === SUSCEPTIBLE;
    const tail = runIndependentCascade(broken, [2], 1, mulberry32(5));
    chainExact =
      chainExact &&
      tail[0] === SUSCEPTIBLE &&
      tail[1] === SUSCEPTIBLE &&
      tail[2] === ADOPTED &&
      tail[3] === ADOPTED;
    details.push(`chain exact outcomes: ${chainExact ? 'ok' : 'FAIL'}`);
  }

  // (1b) statistical check: E[reach] of the p = 0.5 chain is the geometric
  // series 1 + p + p^2 + p^3 = 1.875 (each edge fires only if its upstream did).
  let chainMeanErr = Number.POSITIVE_INFINITY;
  {
    const chain = makePathNetwork(4);
    const mean = expectedReach(chain, [0], 0.5, 4000, 99);
    chainMeanErr = Math.abs(mean - 1.875);
    details.push(`chain mean-reach error = ${chainMeanErr.toFixed(4)} (criterion <= 0.08 vs 1 + p + p^2 + p^3)`);
  }

  // (2) linear threshold: terminal active set is a fixed point.
  let ltFixedPoint = false;
  {
    const net = makeRandomNetwork(12, 3, mulberry32(12));
    const thresholds = drawThresholds(net, mulberry32(13));
    const state = runLinearThreshold(net, [0], thresholds);
    ltFixedPoint = ltFixedPointStable(net, state, thresholds) && countActive(state) >= 1;
    details.push(`LT fixed point (active ${countActive(state)}/12): ${ltFixedPoint ? 'ok' : 'FAIL'}`);
  }

  // (3) greedy vs exhaustive on two disjoint 3-chains, p = 1, k = 2.
  let greedyMatchesExhaustive = false;
  let greedySpread = 0;
  let exhaustiveSpread = 0;
  {
    const net = networkFromEdges(6, [
      { u: 0, v: 1, w: 1 },
      { u: 1, v: 2, w: 1 },
      { u: 3, v: 4, w: 1 },
      { u: 4, v: 5, w: 1 },
    ]);
    const seeds = greedySeeds(net, 2, 1, 8, 42);
    greedySpread = expectedReach(net, seeds, 1, 8, 42);
    exhaustiveSpread = 0;
    for (let i = 0; i < 6; i += 1) {
      for (let j = i + 1; j < 6; j += 1) {
        exhaustiveSpread = Math.max(exhaustiveSpread, expectedReach(net, [i, j], 1, 8, 42));
      }
    }
    greedyMatchesExhaustive = greedySpread === exhaustiveSpread && greedySpread === 6;
    details.push(
      `greedy seeds [${seeds.join(',')}] spread ${greedySpread} vs exhaustive ${exhaustiveSpread}: ${greedyMatchesExhaustive ? 'ok' : 'FAIL'}`,
    );
  }

  // (4) echo-chamber metric bounds and structure.
  let homophilyBounds = true;
  {
    const n = 40;
    const opinions = initialOpinions(n, mulberry32(21));
    const rnd = makeRandomNetwork(n, 4, mulberry32(22));
    const echo = makeEchoChamberNetwork(n, 4, 0.9, opinions, mulberry32(23));
    const hR = homophilyIndex(rnd, opinions);
    const hE = homophilyIndex(echo, opinions);
    const dR = meanExposureDiversity(rnd, opinions);
    const dE = meanExposureDiversity(echo, opinions);
    const in01 = (v: number): boolean => v >= 0 && v <= 1;
    homophilyBounds = in01(hR) && in01(hE) && hE >= hR && in01(dR) && in01(dE) && dE <= dR;
    // Degenerate references: uniform opinions -> 1, alternating path -> 0.
    const path = makePathNetwork(6);
    const uniform = new Float64Array(6).fill(0.5);
    const alt = new Float64Array([0, 1, 0, 1, 0, 1]);
    homophilyBounds =
      homophilyBounds && homophilyIndex(path, uniform) === 1 && homophilyIndex(path, alt) === 0;
    details.push(`homophily random=${hR.toFixed(3)} echo=${hE.toFixed(3)}, exposure echo=${dE.toFixed(3)}: ${homophilyBounds ? 'ok' : 'FAIL'}`);
  }

  // (5) determinism: identical seeds reproduce the full pipeline exactly.
  let deterministic = true;
  {
    const pipeline = (seed: number): { state: Uint8Array; rows: SeriesRow[] } => {
      const params: OpinionParams = {
        ...DEFAULT_OPINION_PARAMS,
        nNodes: 30,
        avgDegree: 4,
        model: 'competing-cascades',
        opinionMode: 'bounded',
        seed,
      };
      const rand = mulberry32(params.seed >>> 0 || 1);
      const opinions = initialOpinions(params.nNodes, rand);
      const net = buildNetwork(params, opinions, rand);
      const thresholds = drawThresholds(net, rand);
      const seeds = pickSeeds(net.n, params.seedCount, params.randomSeeds, rand);
      const factSeeds = pickSeeds(net.n, 3, params.randomSeeds, rand, new Set(seeds));
      const run = runOpinionSimulation(net, opinions, params, seeds, factSeeds, thresholds, net.n + 2);
      return { state: run.state, rows: run.rows };
    };
    const a = pipeline(123);
    const b = pipeline(123);
    deterministic = a.state.length === b.state.length && a.state.every((v, i) => v === b.state[i]);
    deterministic =
      deterministic &&
      a.rows.length === b.rows.length &&
      a.rows.every((r, i) => {
        const s = b.rows[i]!;
        return r.adopted === s.adopted && r.corrected === s.corrected && r.meanOpinion === s.meanOpinion && r.opinionVar === s.opinionVar && r.homophily === s.homophily;
      });
    details.push(`seed determinism: ${deterministic ? 'ok' : 'FAIL'}`);
  }

  const pass =
    chainExact && chainMeanErr <= 0.08 && ltFixedPoint && greedyMatchesExhaustive && homophilyBounds && deterministic;
  return {
    chainExact,
    chainMeanErr,
    ltFixedPoint,
    greedyMatchesExhaustive,
    greedySpread,
    exhaustiveSpread,
    homophilyBounds,
    deterministic,
    details,
    pass,
  };
}
