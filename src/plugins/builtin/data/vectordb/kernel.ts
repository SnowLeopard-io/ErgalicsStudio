// ==========================================================================
// Vector Store kernel — pure in-browser vector-index logic.
//
// No DOM / host imports: every function is deterministic given (data, seed),
// so a run can be reproduced bit-for-bit. Contents:
//   - seeded RNG (mulberry32) + Gaussian sampler
//   - embeddings: numeric rows -> L2-normalized; text -> hashing-trick
//     bag-of-words (fixed 64 dims, unigrams), then L2-normalized
//   - distance metrics: cosine, Euclidean, inner product (query
//     normalization handled per metric at the embedding stage)
//   - exact brute-force top-k search
//   - simplified HNSW approximate index (multi-layer graph, M connections,
//     efConstruction / efSearch, seeded level assignment in insertion order)
//   - Recall@K evaluation of HNSW against brute force
//   - seeded 2-D projection: PCA (power iteration, deflation) and a
//     lightweight exact t-SNE (n <= 400, early-exaggeration schedule),
//     with a PCA fallback for larger n
//   - cluster-structured synthetic vector generator (sample + benchmark)
// ==========================================================================

export type Rng = () => number;

/** Deterministic 32-bit PRNG (mulberry32). Same seed -> same sequence. */
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

// ---- metrics & embeddings --------------------------------------------------

export type Metric = 'cosine' | 'euclidean' | 'dot';
export type IndexKind = 'brute-force' | 'hnsw';
export type ProjectionKind = 'pca' | 'tsne';

/** `[en, zh]` display labels. */
export const METRIC_LABELS: Record<Metric, [string, string]> = {
  cosine: ['Cosine', '余弦距离'],
  euclidean: ['Euclidean', '欧氏距离'],
  dot: ['Inner product', '内积'],
};

/** `[en, zh]` display labels. */
export const INDEX_LABELS: Record<IndexKind, [string, string]> = {
  'brute-force': ['Brute force', '暴力精确检索'],
  hnsw: ['HNSW (approximate)', 'HNSW 近似检索'],
};

export const EMBED_DIM = 64;
/** Above this many points the t-SNE path falls back to PCA. */
export const TSNE_MAX_N = 400;

/** Scale a vector to unit L2 norm (zero vectors are returned unchanged). */
export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n < 1e-12) return v.slice();
  return v.map((x) => x / n);
}

/** FNV-1a 32-bit string hash — deterministic token bucket for the hashing trick. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Hashing-trick bag-of-words embedding of a short text: unigrams are hashed
 * into `dim` buckets (counts). The vector is L2-normalized only for cosine
 * search, where normalization is part of the metric; Euclidean and inner
 * product search keep the raw counts (magnitude carries information).
 */
export function embedText(text: string, dim = EMBED_DIM, metric: Metric = 'cosine'): number[] {
  const counts = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9']+/).filter((t) => t.length > 1);
  for (const tok of tokens) counts[fnv1a(tok) % dim]! += 1;
  return metric === 'cosine' ? l2normalize(counts) : counts;
}

/** Embed numeric feature rows; normalize only for the cosine metric. */
export function embedRows(rows: number[][], metric: Metric = 'cosine'): number[][] {
  return rows.map((r) => (metric === 'cosine' ? l2normalize(r.slice()) : r.slice()));
}

/**
 * Distance function per metric. Cosine is scale-invariant and divides by the
 * norms, so it is correct for both normalized and raw vectors. Inner product
 * is reported as a "distance" via negation so smaller is always better,
 * keeping top-k semantics uniform across metrics.
 */
export function makeDistance(metric: Metric): (a: number[], b: number[]) => number {
  if (metric === 'cosine') {
    return (a, b) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i += 1) {
        dot += a[i]! * b[i]!;
        na += a[i]! * a[i]!;
        nb += b[i]! * b[i]!;
      }
      const denom = Math.sqrt(na * nb);
      return denom < 1e-12 ? 1 : 1 - dot / denom;
    };
  }
  if (metric === 'dot') {
    return (a, b) => {
      let d = 0;
      for (let i = 0; i < a.length; i += 1) d += a[i]! * b[i]!;
      return -d;
    };
  }
  return (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 1) {
      const t = a[i]! - b[i]!;
      s += t * t;
    }
    return Math.sqrt(s);
  };
}

// ---- nearest-neighbour search ----------------------------------------------

export interface Neighbor {
  id: number;
  distance: number;
}

interface HeapNode {
  id: number;
  d: number;
}

/** Minimal binary heap over (id, distance) pairs; min-first when `minFirst`. */
class NeighborHeap {
  private a: HeapNode[] = [];
  constructor(private readonly minFirst: boolean) {}
  get size(): number {
    return this.a.length;
  }
  peek(): HeapNode | undefined {
    return this.a[0];
  }
  private better(x: HeapNode, y: HeapNode): boolean {
    return this.minFirst ? x.d < y.d : x.d > y.d;
  }
  push(n: HeapNode): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.better(a[i]!, a[p]!)) break;
      const t = a[p]!;
      a[p] = a[i]!;
      a[i] = t;
      i = p;
    }
  }
  pop(): HeapNode | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.better(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.better(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        const t = a[m]!;
        a[m] = a[i]!;
        a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

const EMPTY_LINKS: readonly number[] = [];

/** Exact brute-force top-k (used directly and as the recall ground truth). */
export function bruteForceSearch(vectors: number[][], query: number[], metric: Metric, k: number): Neighbor[] {
  const dist = makeDistance(metric);
  const all: HeapNode[] = vectors.map((v, i) => ({ id: i, d: dist(v, query) }));
  all.sort((a, b) => a.d - b.d);
  return all.slice(0, Math.max(0, k)).map((n) => ({ id: n.id, distance: n.d }));
}

// ---- HNSW (simplified Malkov & Yashunin) -----------------------------------

export interface HnswParams {
  /** Number of bidirectional links per node (M). */
  m: number;
  /** Beam width during index construction. */
  efConstruction: number;
  /** Seeds the per-element level assignment (insertion order is the input order). */
  seed: number;
}

export interface HnswGraph {
  vectors: number[][];
  dist: (a: number[], b: number[]) => number;
  m: number;
  mMax0: number;
  efConstruction: number;
  /** links[node][layer] = neighbour ids at that layer. */
  links: number[][][];
  levels: number[];
  entry: number;
  maxLevel: number;
}

/** Best-first beam search on one layer; returns up to `ef` nearest, ascending. */
function searchLayer(
  vectors: number[][],
  dist: (a: number[], b: number[]) => number,
  links: number[][][],
  query: number[],
  eps: HeapNode[],
  ef: number,
  layer: number,
): HeapNode[] {
  const visited = new Set<number>();
  const candidates = new NeighborHeap(true);
  const results = new NeighborHeap(false);
  for (const e of eps) {
    if (visited.has(e.id)) continue;
    visited.add(e.id);
    candidates.push(e);
    results.push(e);
  }
  while (candidates.size > 0) {
    const c = candidates.pop()!;
    const worst = results.peek();
    if (worst !== undefined && results.size >= ef && c.d > worst.d) break;
    const nbrs = links[c.id]?.[layer] ?? EMPTY_LINKS;
    for (const nb of nbrs) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      const d = dist(vectors[nb]!, query);
      const worst2 = results.peek();
      if (worst2 === undefined || results.size < ef || d < worst2.d) {
        candidates.push({ id: nb, d });
        results.push({ id: nb, d });
        if (results.size > ef) results.pop();
      }
    }
  }
  const out: HeapNode[] = [];
  while (results.size > 0) out.push(results.pop()!);
  out.sort((x, y) => x.d - y.d);
  return out;
}

/** Greedy descent to the local minimum on one layer (ef = 1). */
function greedyDescent(
  vectors: number[][],
  dist: (a: number[], b: number[]) => number,
  links: number[][][],
  query: number[],
  ep: number,
  epD: number,
  layer: number,
): HeapNode {
  let cur = ep;
  let curD = epD;
  for (;;) {
    let improved = false;
    const nbrs = links[cur]?.[layer] ?? EMPTY_LINKS;
    for (const nb of nbrs) {
      const d = dist(vectors[nb]!, query);
      if (d < curD) {
        curD = d;
        cur = nb;
        improved = true;
      }
    }
    if (!improved) return { id: cur, d: curD };
  }
}

/**
 * Neighbour selection: the paper's diversity heuristic (Algorithm 4) with a
 * closest-first fallback when the heuristic keeps fewer than `m`.
 */
function selectNeighbors(
  vectors: number[][],
  dist: (a: number[], b: number[]) => number,
  cands: HeapNode[],
  m: number,
): HeapNode[] {
  const keep: HeapNode[] = [];
  for (const c of cands) {
    if (keep.length >= m) break;
    let closerToKept = false;
    for (const s of keep) {
      if (dist(vectors[c.id]!, vectors[s.id]!) < c.d) {
        closerToKept = true;
        break;
      }
    }
    if (!closerToKept) keep.push(c);
  }
  if (keep.length < m) {
    const chosen = new Set(keep.map((k) => k.id));
    for (const c of cands) {
      if (keep.length >= m) break;
      if (!chosen.has(c.id)) {
        keep.push(c);
        chosen.add(c.id);
      }
    }
  }
  return keep;
}

/** Build a simplified HNSW graph over `vectors` in the given (seeded) order. */
export function buildHnsw(vectors: number[][], metric: Metric, params: HnswParams): HnswGraph {
  const m = Math.max(2, Math.round(params.m));
  const mMax0 = 2 * m;
  const efConstruction = Math.max(1, Math.round(params.efConstruction));
  const rng = mulberry32(params.seed);
  const mL = 1 / Math.log(m);
  const dist = makeDistance(metric);
  const n = vectors.length;
  const levels = new Array<number>(n).fill(0);
  const links: number[][][] = new Array(n);
  let entry = -1;
  let maxLevel = -1;

  for (let q = 0; q < n; q += 1) {
    const u = 1 - rng(); // in (0, 1]
    // Cap the top level so pathological -log(u) draws cannot create huge towers.
    const level = Math.min(Math.floor(-Math.log(u) * mL), 12);
    levels[q] = level;
    links[q] = Array.from({ length: level + 1 }, () => [] as number[]);
    const qv = vectors[q]!;

    if (entry < 0) {
      entry = q;
      maxLevel = level;
      continue;
    }

    // Zoom in from the top layer down to the element's level with ef = 1.
    let ep = entry;
    let epD = dist(vectors[ep]!, qv);
    for (let L = maxLevel; L > level; L -= 1) {
      const g = greedyDescent(vectors, dist, links, qv, ep, epD, L);
      ep = g.id;
      epD = g.d;
    }

    // Insert on layers min(level, maxLevel)..0 with the full beam.
    let eps: HeapNode[] = [{ id: ep, d: epD }];
    for (let L = Math.min(level, maxLevel); L >= 0; L -= 1) {
      const cap = L === 0 ? mMax0 : m;
      const cands = searchLayer(vectors, dist, links, qv, eps, efConstruction, L);
      const selected = selectNeighbors(vectors, dist, cands, m).slice(0, cap);
      links[q]![L] = selected.map((s) => s.id);
      for (const s of selected) {
        const back = links[s.id]![L]!;
        back.push(q);
        if (back.length > cap) {
          // Prune the overflowed list to the `cap` closest to s.
          const re = back.map((id) => ({ id, d: dist(vectors[id]!, vectors[s.id]!) }));
          re.sort((a, b) => a.d - b.d);
          links[s.id]![L] = re.slice(0, cap).map((x) => x.id);
        }
      }
      eps = cands;
    }

    if (level > maxLevel) {
      maxLevel = level;
      entry = q;
    }
  }

  return { vectors, dist, m, mMax0, efConstruction, links, levels, entry, maxLevel };
}

/** Approximate top-k through the layered graph (greedy descent + layer-0 beam). */
export function searchHnsw(graph: HnswGraph, query: number[], k: number, efSearch: number): Neighbor[] {
  if (graph.entry < 0) return [];
  const { vectors, dist, links } = graph;
  let ep = graph.entry;
  let epD = dist(vectors[ep]!, query);
  for (let L = graph.maxLevel; L >= 1; L -= 1) {
    const g = greedyDescent(vectors, dist, links, query, ep, epD, L);
    ep = g.id;
    epD = g.d;
  }
  const ef = Math.max(Math.max(1, Math.round(efSearch)), k);
  const res = searchLayer(vectors, dist, links, query, [{ id: ep, d: epD }], ef, 0);
  return res.slice(0, Math.max(0, k)).map((r) => ({ id: r.id, distance: r.d }));
}

// ---- index façade -----------------------------------------------------------

export interface BuiltIndex {
  kind: IndexKind;
  metric: Metric;
  vectors: number[][];
  buildMs: number;
  hnsw: HnswGraph | null;
  /** HNSW only: number of layers (maxLevel + 1). */
  layers: number;
  /** HNSW only: mean out-degree on layer 0. */
  avgDegree: number;
}

export function buildIndex(
  vectors: number[][],
  metric: Metric,
  kind: IndexKind,
  params: HnswParams,
): BuiltIndex {
  const t0 = performance.now();
  let hnsw: HnswGraph | null = null;
  if (kind === 'hnsw') hnsw = buildHnsw(vectors, metric, params);
  const buildMs = performance.now() - t0;
  let layers = 0;
  let avgDegree = 0;
  if (hnsw) {
    layers = hnsw.maxLevel + 1;
    let deg = 0;
    for (const node of hnsw.links) deg += node[0]?.length ?? 0;
    avgDegree = vectors.length > 0 ? deg / vectors.length : 0;
  }
  return { kind, metric, vectors, buildMs, hnsw, layers, avgDegree };
}

/** Top-k through the built index (brute force or HNSW). */
export function searchIndex(index: BuiltIndex, query: number[], k: number, efSearch: number): Neighbor[] {
  if (index.kind === 'hnsw' && index.hnsw) {
    return searchHnsw(index.hnsw, query, k, efSearch);
  }
  return bruteForceSearch(index.vectors, query, index.metric, k);
}

/**
 * Mean Recall@k of the index against exact brute force, over `queryCount`
 * seeded self-queries (dataset vectors used as queries — the standard
 * in-sample recall estimate).
 */
export function evaluateRecall(
  index: BuiltIndex,
  k: number,
  efSearch: number,
  queryCount: number,
  seed: number,
): number {
  if (index.kind !== 'hnsw' || !index.hnsw) return 1;
  const n = index.vectors.length;
  if (n === 0 || k <= 0) return 1;
  const qCount = Math.max(1, Math.min(Math.round(queryCount), n));
  const rng = mulberry32(seed);
  let sum = 0;
  for (let i = 0; i < qCount; i += 1) {
    const qi = Math.floor(rng() * n) % n;
    const q = index.vectors[qi]!;
    const truth = new Set(bruteForceSearch(index.vectors, q, index.metric, k).map((t) => t.id));
    const approx = searchHnsw(index.hnsw, q, k, efSearch);
    let hit = 0;
    for (const a of approx) if (truth.has(a.id)) hit += 1;
    sum += hit / k;
  }
  return sum / qCount;
}

// ---- 2-D projection ----------------------------------------------------------

interface MatVec {
  /** Apply the (implicit) operator to `v`. */
  apply(v: number[]): number[];
  n: number;
  d: number;
}

/** Power iteration for the leading eigenvector; seeded start, fixed sign. */
function powerIterate(op: MatVec, rng: Rng, iters = 150): number[] {
  let v = Array.from({ length: op.d }, () => gaussian(rng));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm < 1e-12) {
    v = new Array<number>(op.d).fill(0);
    if (op.d > 0) v[0] = 1;
    return v;
  }
  v = v.map((x) => x / norm);
  for (let it = 0; it < iters; it += 1) {
    const w = op.apply(v);
    const wn = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
    if (wn < 1e-12) break; // deflated to zero: keep current v
    w.forEach((x, i) => (w[i] = x / wn));
    let delta = 0;
    for (let i = 0; i < op.d; i += 1) delta += (w[i]! - v[i]!) ** 2;
    v = w;
    if (delta < 1e-12) break;
  }
  // Deterministic sign: largest-|component| positive.
  let best = 0;
  for (let i = 1; i < v.length; i += 1) if (Math.abs(v[i]!) > Math.abs(v[best]!)) best = i;
  if (v[best]! < 0) v = v.map((x) => -x);
  return v;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i]! * b[i]!;
  return s;
}

export interface PcaProjection {
  points: Array<{ x: number; y: number }>;
  /** Optional out-of-sample points (e.g. the query) projected with the fitted basis. */
  extraPoints: Array<{ x: number; y: number }>;
}

/**
 * PCA to 2-D via power iteration on the mean-centred data matrix (no d×d
 * covariance is formed): leading direction by Xᵀ(Xv), rank-1 deflation,
 * second direction likewise. Deterministic given the seed.
 */
export function pcaProject(vectors: number[][], extra: number[][] = [], seed = 20261029): PcaProjection {
  const n = vectors.length;
  const out: PcaProjection = { points: [], extraPoints: [] };
  if (n === 0) return out;
  const d = vectors[0]!.length;
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j += 1) mean[j]! += v[j]!;
  for (let j = 0; j < d; j += 1) mean[j] = mean[j]! / n;
  let X = vectors.map((v) => v.map((x, j) => x - mean[j]!));
  const Xc = extra.map((q) => q.map((x, j) => x - mean[j]!));

  const op = (m: number[][]): MatVec => ({
    n: m.length,
    d,
    apply: (v: number[]) => {
      const w = new Array<number>(d).fill(0);
      for (const r of m) {
        let rv = 0;
        for (let j = 0; j < d; j += 1) rv += r[j]! * v[j]!;
        if (rv === 0) continue;
        for (let j = 0; j < d; j += 1) w[j]! += rv * r[j]!;
      }
      return w;
    },
  });

  const v1 = powerIterate(op(X), mulberry32(seed));
  const pc1 = X.map((r) => dot(r, v1));
  // Rank-1 deflation: X' = X - (X v1) v1^T.
  X = X.map((r, i) => {
    const c = pc1[i]!;
    return r.map((x, j) => x - c * v1[j]!);
  });
  const v2 = powerIterate(op(X), mulberry32(seed + 1));
  const pc2 = X.map((r) => dot(r, v2));
  out.points = pc1.map((x, i) => ({ x, y: pc2[i]! }));
  out.extraPoints = Xc.map((q) => {
    const c = dot(q, v1);
    const q2 = q.map((x, j) => x - c * v1[j]!);
    return { x: c, y: dot(q2, v2) };
  });
  return out;
}

/** Symmetric Gaussian row of the similarity matrix for one point (Hbeta). */
function hbeta(Di: number[], beta: number, skip: number): { p: number[]; h: number } {
  const p = new Array<number>(Di.length).fill(0);
  let sumP = 0;
  for (let j = 0; j < Di.length; j += 1) {
    if (j === skip) continue;
    const v = Math.exp(-Di[j]! * beta);
    p[j] = v;
    sumP += v;
  }
  if (sumP <= 0) return { p, h: 0 };
  let sumDP = 0;
  for (let j = 0; j < Di.length; j += 1) {
    if (j === skip || p[j] === 0) continue;
    sumDP += Di[j]! * p[j]!;
  }
  const h = Math.log(sumP) + (beta * sumDP) / sumP;
  for (let j = 0; j < Di.length; j += 1) p[j] = p[j]! / sumP;
  return { p, h };
}

/**
 * Lightweight exact t-SNE to 2-D: pairwise t-distribution affinities,
 * gradient descent with momentum and a 4x early-exaggeration schedule.
 * Deterministic given the seed; intended for n <= 400.
 */
export function tsneProject(vectors: number[][], seed = 20261029, iterations = 300): Array<{ x: number; y: number }> {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  // Pairwise squared Euclidean distances.
  const D2: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let s = 0;
      const a = vectors[i]!;
      const b = vectors[j]!;
      const len = Math.min(a.length, b.length);
      for (let t = 0; t < len; t += 1) s += (a[t]! - b[t]!) ** 2;
      D2[i]![j] = s;
      D2[j]![i] = s;
    }
  }

  // Per-row Gaussian bandwidth by binary search on the target perplexity.
  const perplexity = Math.min(30, n - 1);
  const target = Math.log(perplexity);
  const P: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const Di = D2[i]!;
    let beta = 1;
    let lo = -Infinity;
    let hi = Infinity;
    let row = hbeta(Di, beta, i).p;
    for (let it = 0; it < 50; it += 1) {
      const hb = hbeta(Di, beta, i);
      row = hb.p;
      if (Math.abs(hb.h - target) < 1e-4) break;
      if (hb.h > target) {
        lo = beta;
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
      } else {
        hi = beta;
        beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2;
      }
    }
    for (let j = 0; j < n; j += 1) P[i]![j] = row[j]!;
  }

  // Symmetrize and normalize so total mass is 1.
  const Pnorm = 2 * n;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const v = (P[i]![j]! + P[j]![i]!) / Pnorm;
      P[i]![j] = v;
      P[j]![i] = v;
    }
  }

  // Seeded small random init + zero momentum buffer.
  const rng = mulberry32(seed);
  const Y: Array<[number, number]> = Array.from({ length: n }, () => [gaussian(rng) * 1e-4, gaussian(rng) * 1e-4]);
  const iY: Array<[number, number]> = Array.from({ length: n }, () => [0, 0]);

  const eta = 200;
  const exaggerationIters = Math.min(100, Math.floor(iterations / 3));
  const num = new Float64Array(n * n);
  const grad = new Float64Array(n * 2);

  for (let iter = 0; iter < iterations; iter += 1) {
    const exagg = iter < exaggerationIters ? 4 : 1;
    if (iter === exaggerationIters) {
      // Momentum anneals when early exaggeration ends.
      for (let i = 0; i < n; i += 1) {
        iY[i]![0] *= 0.8 / 0.5;
        iY[i]![1] *= 0.8 / 0.5;
      }
    }
    const momentum = iter < exaggerationIters ? 0.5 : 0.8;

    let Z = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = Y[i]![0] - Y[j]![0];
        const dy = Y[i]![1] - Y[j]![1];
        const v = 1 / (1 + dx * dx + dy * dy);
        num[i * n + j] = v;
        num[j * n + i] = v;
        Z += 2 * v; // ordered-pair sum
      }
    }
    if (Z <= 0) Z = 1;

    grad.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const q = num[i * n + j]! / Z;
        const c = (P[i]![j]! * exagg - q) * num[i * n + j]!;
        const gx = c * (Y[i]![0] - Y[j]![0]);
        const gy = c * (Y[i]![1] - Y[j]![1]);
        grad[i * 2]! += gx;
        grad[i * 2 + 1]! += gy;
        grad[j * 2]! -= gx;
        grad[j * 2 + 1]! -= gy;
      }
    }

    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i += 1) {
      iY[i]![0] = momentum * iY[i]![0] - eta * grad[i * 2]!;
      iY[i]![1] = momentum * iY[i]![1] - eta * grad[i * 2 + 1]!;
      Y[i]![0] += iY[i]![0];
      Y[i]![1] += iY[i]![1];
      mx += Y[i]![0];
      my += Y[i]![1];
    }
    // Recenter every step (standard practice) so the layout stays in view.
    mx /= n;
    my /= n;
    for (let i = 0; i < n; i += 1) {
      Y[i]![0] -= mx;
      Y[i]![1] -= my;
    }
  }

  return Y.map((p) => ({ x: p[0], y: p[1] }));
}

export interface ProjectionResult {
  method: 'pca' | 'tsne';
  points: Array<{ x: number; y: number }>;
  extraPoints: Array<{ x: number; y: number }>;
  /** True when t-SNE was requested but n exceeded the exact-t-SNE budget. */
  fallback: boolean;
}

/** PCA / t-SNE dispatch with the automatic PCA fallback for large n. */
export function projectVectors(
  vectors: number[][],
  kind: ProjectionKind,
  seed = 20261029,
  extra: number[][] = [],
): ProjectionResult {
  if (kind === 'tsne' && vectors.length <= TSNE_MAX_N) {
    return { method: 'tsne', points: tsneProject(vectors, seed), extraPoints: [], fallback: false };
  }
  const pca = pcaProject(vectors, extra, seed);
  return { method: 'pca', points: pca.points, extraPoints: pca.extraPoints, fallback: kind === 'tsne' };
}

// ---- data parsing -------------------------------------------------------------

export interface TextDocument {
  id: number;
  text: string;
}

/** Parse `{"documents": [...]}` (strings or `{text}` objects). Throws on bad shape. */
export function parseDocumentsJson(text: string): TextDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('invalid JSON — expected {"documents": [...]}');
  }
  const docsRaw = (parsed as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(docsRaw)) throw new Error('JSON must contain a "documents" array');
  const docs: TextDocument[] = [];
  for (const raw of docsRaw) {
    if (typeof raw === 'string') {
      if (raw.trim()) docs.push({ id: docs.length, text: raw.trim() });
    } else if (raw && typeof raw === 'object') {
      const t = (raw as { text?: unknown }).text;
      if (typeof t === 'string' && t.trim()) docs.push({ id: docs.length, text: t.trim() });
    }
  }
  if (docs.length < 2) throw new Error('need at least 2 non-empty documents');
  return docs;
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

/** Parse an all-numeric CSV (optional header row). Throws on unusable layout. */
export function parseNumericCsv(text: string): number[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) throw new Error('CSV needs at least 3 data rows');
  const asNumber = (cell: string): number | null => {
    const v = Number(cell.trim());
    return Number.isFinite(v) ? v : null;
  };
  let start = 0;
  if (splitCsvLine(lines[0]!).some((c) => asNumber(c) === null)) start = 1;
  if (lines.length - start < 3) throw new Error('CSV needs at least 3 numeric data rows');
  const rows: number[][] = [];
  let dims = -1;
  for (let i = start; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!).map(asNumber);
    if (cells.some((c) => c === null)) throw new Error(`row ${i} contains a non-numeric cell`);
    if (dims < 0) dims = cells.length;
    if (cells.length !== dims) throw new Error(`row ${i} has ${cells.length} columns, expected ${dims}`);
    if (dims < 2) throw new Error('need at least 2 numeric feature columns');
    rows.push(cells.map((c) => c!));
  }
  return rows;
}

// ---- synthetic corpus -----------------------------------------------------------

/** Cluster-structured synthetic vectors (sample corpus + benchmark corpus). */
export function generateSyntheticVectors(n: number, dims: number, clusters: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  const centers: number[][] = Array.from({ length: Math.max(1, clusters) }, () =>
    Array.from({ length: dims }, () => gaussian(rng) * 2.5),
  );
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const c = centers[i % centers.length]!;
    out.push(c.map((v) => v + gaussian(rng) * 0.9));
  }
  return out;
}

// ---- orchestration --------------------------------------------------------------

export interface VectordbParams {
  metric: Metric;
  indexKind: IndexKind;
  m: number;
  efConstruction: number;
  efSearch: number;
  topK: number;
  projection: ProjectionKind;
  seed: number;
}

export interface VectordbPrepared {
  vectors: number[][];
  snippets: string[];
  query: number[];
  queryLabel: string;
  /** Set when the query is one of the dataset vectors (self-query highlight). */
  queryId: number | null;
}

export interface VectordbRunResult {
  buildMs: number;
  searchMs: number;
  vectorCount: number;
  dims: number;
  indexKind: IndexKind;
  metric: Metric;
  topK: number;
  layers: number;
  avgDegree: number;
  /** Mean Recall@K vs brute force; null for the brute-force index. */
  recall: number | null;
  recallQueries: number;
  projectionMethod: 'pca' | 'tsne';
  projectionFallback: boolean;
  points: Array<{ x: number; y: number }>;
  /** Set when the query is a dataset vector (self-query highlight in the scatter). */
  queryId: number | null;
  /** Query position in the projection (null for self-queries and under t-SNE). */
  queryPoint: { x: number; y: number } | null;
  top: Neighbor[];
  snippets: string[];
  queryLabel: string;
}

/** Build the index, run the query, evaluate recall and project to 2-D. */
export function runVectordb(prep: VectordbPrepared, params: VectordbParams): VectordbRunResult {
  const { vectors, snippets, query, queryLabel, queryId } = prep;
  const n = vectors.length;
  const dims = n > 0 ? vectors[0]!.length : 0;
  const index = buildIndex(vectors, params.metric, params.indexKind, {
    m: params.m,
    efConstruction: params.efConstruction,
    seed: params.seed,
  });
  const t0 = performance.now();
  const top = searchIndex(index, query, params.topK, params.efSearch);
  const searchMs = performance.now() - t0;
  const recallQueries = Math.min(20, n);
  const recall = params.indexKind === 'hnsw' ? evaluateRecall(index, params.topK, params.efSearch, recallQueries, params.seed + 7) : null;
  const proj = projectVectors(vectors, params.projection, params.seed + 11, queryId === null ? [query] : []);
  return {
    buildMs: index.buildMs,
    searchMs,
    vectorCount: n,
    dims,
    indexKind: index.kind,
    metric: params.metric,
    topK: params.topK,
    layers: index.layers,
    avgDegree: index.avgDegree,
    recall,
    recallQueries,
    projectionMethod: proj.method,
    projectionFallback: proj.fallback,
    points: proj.points,
    queryId,
    queryPoint: queryId === null ? (proj.extraPoints[0] ?? null) : null,
    top,
    snippets,
    queryLabel,
  };
}

// ---- benchmark --------------------------------------------------------------------

export interface VectordbBenchmarkResult {
  corpus: number;
  dims: number;
  clusters: number;
  m: number;
  efConstruction: number;
  efSearch: number;
  buildMs: number;
  layers: number;
  avgDegree: number;
  queries: number;
  avgSearchMs: number;
  maxSearchMs: number;
  /** Recall@10 of HNSW vs brute force, measured on a 500-vector subset. */
  subset: number;
  subsetRecallAt10: number;
  subsetQueries: number;
  totalMs: number;
  budgetMs: number;
  withinBudget: boolean;
}

/**
 * Seeded benchmark: HNSW over 5000 x 32 synthetic vectors; build time, mean
 * search latency over 100 queries (efSearch = 64) and Recall@10 against
 * brute force measured on a 500-vector subset.
 */
export function runVectordbBenchmark(seed = 20261029): VectordbBenchmarkResult {
  const budgetMs = 2500;
  const t0 = performance.now();
  const corpus = generateSyntheticVectors(5000, 32, 8, seed);
  const graph = buildHnsw(corpus, 'cosine', { m: 8, efConstruction: 64, seed: seed + 1 });
  const buildMs = performance.now() - t0;

  // Search latency over 100 seeded near-corpus queries.
  const rng = mulberry32(seed + 2);
  const queries = 100;
  let sumLatency = 0;
  let maxLatency = 0;
  for (let i = 0; i < queries; i += 1) {
    const base = corpus[Math.floor(rng() * corpus.length) % corpus.length]!;
    const q = l2normalize(base.map((v) => v + gaussian(rng) * 0.05));
    const t = performance.now();
    searchHnsw(graph, q, 10, 64);
    const ms = performance.now() - t;
    sumLatency += ms;
    if (ms > maxLatency) maxLatency = ms;
  }

  // Recall@10 vs brute force on a 500-vector subset (same index settings).
  const subset = 500;
  const subsetIdx: number[] = [];
  const seen = new Set<number>();
  while (subsetIdx.length < Math.min(subset, corpus.length)) {
    const idx = Math.floor(rng() * corpus.length) % corpus.length;
    if (!seen.has(idx)) {
      seen.add(idx);
      subsetIdx.push(idx);
    }
  }
  const subVectors = subsetIdx.map((i) => corpus[i]!);
  const subGraph = buildHnsw(subVectors, 'cosine', { m: 8, efConstruction: 64, seed: seed + 3 });
  const subRng = mulberry32(seed + 4);
  const subQueries = 50;
  let recallSum = 0;
  for (let i = 0; i < subQueries; i += 1) {
    const base = subVectors[Math.floor(subRng() * subVectors.length) % subVectors.length]!;
    const q = l2normalize(base.map((v) => v + gaussian(subRng) * 0.05));
    const truth = new Set(bruteForceSearch(subVectors, q, 'cosine', 10).map((t) => t.id));
    const approx = searchHnsw(subGraph, q, 10, 64);
    let hit = 0;
    for (const a of approx) if (truth.has(a.id)) hit += 1;
    recallSum += hit / 10;
  }

  const totalMs = performance.now() - t0;
  let deg = 0;
  for (const node of graph.links) deg += node[0]?.length ?? 0;
  return {
    corpus: corpus.length,
    dims: 32,
    clusters: 8,
    m: 8,
    efConstruction: 64,
    efSearch: 64,
    buildMs,
    layers: graph.maxLevel + 1,
    avgDegree: graph.links.length > 0 ? deg / graph.links.length : 0,
    queries,
    avgSearchMs: sumLatency / queries,
    maxSearchMs: maxLatency,
    subset: subVectors.length,
    subsetRecallAt10: recallSum / subQueries,
    subsetQueries: subQueries,
    totalMs,
    budgetMs,
    withinBudget: totalMs < budgetMs,
  };
}
