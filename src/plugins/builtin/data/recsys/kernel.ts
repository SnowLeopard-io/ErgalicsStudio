// ==========================================================================
// Recommender Lab kernel — pure recommender-system logic.
//
// No DOM / host imports: every function is deterministic given (data, seed),
// so a run can be reproduced bit-for-bit. Contents:
//   - seeded RNG (mulberry32) + Gaussian sampler
//   - long-format ratings CSV parsing (`user,item,rating` + optional numeric
//     item-feature columns)
//   - cluster-structured synthetic rating generator (sample + benchmark)
//   - algorithms: user-based CF (Pearson / mean-centred cosine), item-based
//     CF (cosine), per-user ridge content-based, ALS matrix factorization
//     with L2 regularisation, hybrid (alpha blend of MF and content)
//   - evaluation: seeded holdout split, Precision@K, Recall@K, NDCG@K, MAP,
//     RMSE
//   - cold-start: popularity / global-mean fallback for new users, item-mean
//     fallback for new items, with fallback-coverage accounting
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

// ---- CSV -------------------------------------------------------------------

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

/** One interaction in internal index space. */
export interface Rating {
  u: number;
  i: number;
  r: number;
}

export interface RatingsDataset {
  userCount: number;
  itemCount: number;
  /** Labels in first-appearance order; index = internal user id. */
  userLabel: string[];
  itemLabel: string[];
  /** Names of the optional item-feature columns ('' when absent). */
  featureNames: string[];
  /** `itemFeatures[i][f]` — mean of column f over the rows of item i. */
  itemFeatures: number[][];
  ratings: Rating[];
}

/**
 * Parse a long-format ratings CSV. The header must contain `user`, `item`
 * and `rating` (case-insensitive); every other column is treated as a
 * numeric item-content feature (averaged per item). Throws `Error` with a
 * plain diagnostic message when the layout is not usable.
 */
export function parseRatingsCsv(text: string): RatingsDataset {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV needs a header row plus at least one data row');
  const header = splitCsvLine(lines[0]!).map((c) => c.trim().toLowerCase());
  const uIdx = header.indexOf('user');
  const iIdx = header.indexOf('item');
  const rIdx = header.indexOf('rating');
  if (uIdx < 0 || iIdx < 0 || rIdx < 0) {
    throw new Error('CSV header must contain "user", "item" and "rating" columns');
  }
  const featIdx: number[] = [];
  const featureNames: string[] = [];
  header.forEach((name, idx) => {
    if (idx !== uIdx && idx !== iIdx && idx !== rIdx) {
      featIdx.push(idx);
      featureNames.push(name);
    }
  });

  const userIndex = new Map<string, number>();
  const itemIndex = new Map<string, number>();
  const userLabel: string[] = [];
  const itemLabel: string[] = [];
  const featSum: number[][] = [];
  const featCnt: number[][] = [];
  const ratings: Rating[] = [];

  for (let ln = 1; ln < lines.length; ln += 1) {
    const cells = splitCsvLine(lines[ln]!);
    const uRaw = (cells[uIdx] ?? '').trim();
    const iRaw = (cells[iIdx] ?? '').trim();
    const r = Number((cells[rIdx] ?? '').trim());
    if (!uRaw || !iRaw || !Number.isFinite(r)) continue;

    let u = userIndex.get(uRaw);
    if (u === undefined) {
      u = userLabel.length;
      userIndex.set(uRaw, u);
      userLabel.push(uRaw);
    }
    let i = itemIndex.get(iRaw);
    if (i === undefined) {
      i = itemLabel.length;
      itemIndex.set(iRaw, i);
      itemLabel.push(iRaw);
      featSum.push(new Array<number>(featureNames.length).fill(0));
      featCnt.push(new Array<number>(featureNames.length).fill(0));
    }
    const sumRow = featSum[i]!;
    const cntRow = featCnt[i]!;
    featIdx.forEach((ci, f) => {
      const v = Number((cells[ci] ?? '').trim());
      if (Number.isFinite(v)) {
        sumRow[f] = (sumRow[f] ?? 0) + v;
        cntRow[f] = (cntRow[f] ?? 0) + 1;
      }
    });
    ratings.push({ u, i, r });
  }

  if (ratings.length === 0) throw new Error('No parsable "user,item,rating" rows found');
  const itemFeatures = featSum.map((sums, i) => {
    const cntRow = featCnt[i]!;
    return sums.map((s, f) => (cntRow[f]! > 0 ? s / cntRow[f]! : 0));
  });
  return {
    userCount: userLabel.length,
    itemCount: itemLabel.length,
    userLabel,
    itemLabel,
    featureNames,
    itemFeatures,
    ratings,
  };
}

// ---- synthetic generator -----------------------------------------------------

export interface SynthOptions {
  /** Fraction of (user,item) cells left unrated (default 0.15). */
  missing?: number;
  /** Number of latent taste clusters (default 3). */
  clusters?: number;
}

/**
 * Generate a cluster-structured synthetic ratings CSV: `nUsers` users ×
 * `nItems` items, 3 latent taste clusters by default, `missing` fraction of
 * cells unrated, integer ratings 1–5 and 4 numeric item content features.
 * Fully seeded → the CSV text is identical for identical arguments.
 */
export function generateSyntheticRatings(
  nUsers: number,
  nItems: number,
  seed: number,
  opts?: SynthOptions,
): string {
  const missing = opts?.missing ?? 0.15;
  const clusters = Math.max(1, Math.floor(opts?.clusters ?? 3));
  const F = 4;
  const rng = mulberry32(seed >>> 0);

  // Cluster prototypes over the 4 content features.
  const proto: number[][] = [];
  for (let c = 0; c < clusters; c += 1) {
    const row: number[] = [];
    for (let f = 0; f < F; f += 1) row.push(clampNum(0.15 + 0.7 * rng(), 0, 1));
    proto.push(row);
  }
  // Item features: prototype of the item's cluster + light Gaussian noise.
  const feats: number[][] = [];
  for (let i = 0; i < nItems; i += 1) {
    const c = (i + Math.floor(rng() * clusters)) % clusters;
    const row: number[] = [];
    for (let f = 0; f < F; f += 1) row.push(clampNum(proto[c]![f]! + gaussian(rng) * 0.1, 0, 1));
    feats.push(row);
  }
  // Cluster taste direction over the features.
  const taste: number[][] = [];
  for (let c = 0; c < clusters; c += 1) {
    const row: number[] = [];
    for (let f = 0; f < F; f += 1) row.push(gaussian(rng) * 0.9);
    taste.push(row);
  }

  // rating[u * nItems + i] === 0 means "unrated".
  const rating = new Array<number>(nUsers * nItems).fill(0);
  for (let u = 0; u < nUsers; u += 1) {
    const cu = u % clusters;
    const w: number[] = [];
    for (let f = 0; f < F; f += 1) w.push(taste[cu]![f]! + gaussian(rng) * 0.15);
    for (let i = 0; i < nItems; i += 1) {
      if (rng() < missing) continue;
      let dot = 0;
      const fi = feats[i]!;
      for (let f = 0; f < F; f += 1) dot += w[f]! * fi[f]!;
      const util = 3.0 + (1.8 * dot) / F + gaussian(rng) * 0.35;
      rating[u * nItems + i] = clampNum(Math.round(util), 1, 5);
    }
  }
  // Repair: every user and every item keeps at least one rating so holdout
  // evaluation and cold-start accounting stay meaningful.
  for (let u = 0; u < nUsers; u += 1) {
    let any = false;
    for (let i = 0; i < nItems; i += 1) {
      if (rating[u * nItems + i]! > 0) {
        any = true;
        break;
      }
    }
    if (!any) rating[u * nItems + Math.floor(rng() * nItems) % nItems] = 3 + (u % 3);
  }
  for (let i = 0; i < nItems; i += 1) {
    let any = false;
    for (let u = 0; u < nUsers; u += 1) {
      if (rating[u * nItems + i]! > 0) {
        any = true;
        break;
      }
    }
    if (!any) rating[(Math.floor(rng() * nUsers) % nUsers) * nItems + i] = 2 + (i % 3);
  }

  const pad = (n: number): string => String(n + 1).padStart(2, '0');
  const lines: string[] = ['user,item,rating,f1,f2,f3,f4'];
  for (let u = 0; u < nUsers; u += 1) {
    for (let i = 0; i < nItems; i += 1) {
      const r = rating[u * nItems + i]!;
      if (r <= 0) continue;
      const f = feats[i]!;
      lines.push(
        `U${pad(u)},I${pad(i)},${r},${f[0]!.toFixed(3)},${f[1]!.toFixed(3)},${f[2]!.toFixed(3)},${f[3]!.toFixed(3)}`,
      );
    }
  }
  return lines.join('\n');
}

// ---- linear algebra ----------------------------------------------------------

/**
 * Solve A·x = b (small dense system) via Gaussian elimination with partial
 * pivoting. `a` is consumed. Returns zeros when singular (cannot happen for
 * the ridge systems used here, which are positive definite).
 */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return new Array<number>(n).fill(0);
    const tmp = m[piv]!;
    m[piv] = m[col]!;
    m[col] = tmp;
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r]![col]! / m[col]![col]!;
      if (factor === 0) continue;
      const mr = m[r]!;
      const mc = m[col]!;
      for (let c = col; c <= n; c += 1) mr[c] = (mr[c] ?? 0) - factor * (mc[c] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    const mr = m[r]!;
    let s = mr[n] ?? 0;
    for (let c = r + 1; c < n; c += 1) s -= (mr[c] ?? 0) * x[c]!;
    x[r] = s / (Math.abs(mr[r]!) < 1e-12 ? 1 : mr[r]!);
  }
  return x;
}

/** Ridge regression (closed form) with an intercept column prepended. */
function ridgeFit(rows: number[][], targets: number[], lambda: number): number[] {
  const d = rows[0]?.length ?? 0;
  const a: number[][] = [];
  for (let r = 0; r < d; r += 1) a.push(new Array<number>(d).fill(0));
  const b = new Array<number>(d).fill(0);
  for (let n = 0; n < rows.length; n += 1) {
    const x = rows[n]!;
    const y = targets[n]!;
    for (let p = 0; p < d; p += 1) {
      b[p] = (b[p] ?? 0) + x[p]! * y;
      const ap = a[p]!;
      for (let q = 0; q < d; q += 1) ap[q] = (ap[q] ?? 0) + x[p]! * x[q]!;
    }
  }
  for (let p = 0; p < d; p += 1) a[p]![p] = (a[p]![p] ?? 0) + lambda;
  return solveLinearSystem(a, b);
}

// ---- public model types --------------------------------------------------------

export type RecsysAlgorithm = 'user-cf' | 'item-cf' | 'content' | 'als' | 'hybrid';

/** Bilingual algorithm display names [en, zh]. */
export const ALGORITHM_LABELS: Record<RecsysAlgorithm, [string, string]> = {
  'user-cf': ['User-CF (Pearson)', '基于用户协同过滤（Pearson）'],
  'item-cf': ['Item-CF (cosine)', '基于物品协同过滤（余弦）'],
  content: ['Content-Based (ridge)', '基于内容推荐（岭回归）'],
  als: ['ALS Matrix Factorization', 'ALS 矩阵分解'],
  hybrid: ['Hybrid (MF + Content)', '混合推荐（MF + 内容）'],
};

export interface RecsysParams {
  algorithm: RecsysAlgorithm;
  /** Neighbourhood size for user-/item-based CF. */
  neighbors: number;
  /** ALS latent factors k. */
  factors: number;
  /** ALS alternating iterations. */
  iterations: number;
  /** ALS L2 regularisation strength. */
  lambda: number;
  /** Recommendation-list / ranking-metric cutoff K. */
  topK: number;
  /** Hybrid blend: `alpha·MF + (1-alpha)·content`. */
  alpha: number;
  /** Fraction of each user's ratings held out for evaluation. */
  holdout: number;
  seed: number;
}

export interface RecsysMetrics {
  precision: number;
  recall: number;
  ndcg: number;
  map: number;
  rmse: number;
}

export interface ScatterPoint {
  actual: number;
  pred: number;
}

export interface TopNEntry {
  item: string;
  score: number;
}

export interface RecsysResult {
  algorithm: RecsysAlgorithm;
  algorithmLabel: string;
  userCount: number;
  itemCount: number;
  ratingCount: number;
  featureCount: number;
  trainCount: number;
  testCount: number;
  topK: number;
  holdout: number;
  metrics: RecsysMetrics;
  /** Held-out pairs: predicted vs actual rating. */
  scatter: ScatterPoint[];
  /** Dense training rating matrix (`null` = unrated in training). */
  matrix: {
    userCount: number;
    itemCount: number;
    values: Array<number | null>;
    userLabel: string[];
    itemLabel: string[];
  };
  /** Top-N recommendations for the most active training user. */
  topN: { user: string; entries: TopNEntry[] };
  coldStart: {
    globalMean: number;
    candidateCount: number;
    fallbackCount: number;
    newItemFallbacks: number;
    coldUserFallbacks: number;
    coveragePct: number;
    /** Shrunk popularity list — what a brand-new user is served. */
    popularity: TopNEntry[];
  };
  /** Users with at least one relevant held-out item (ranking-metric base). */
  rankUsers: number;
  relevantThreshold: number;
  seed: number;
  runtimeMs: number;
}

// ---- internal model plumbing -----------------------------------------------------

export type FallbackReason = 'new-item' | 'cold-user' | 'sparse';

/** `reason === null` → the prediction used personalised signal. */
interface Prediction {
  value: number;
  reason: FallbackReason | null;
}
type Predictor = (u: number, i: number) => Prediction;

interface TrainData {
  userRatings: Array<Map<number, number>>;
  itemRatings: Array<Map<number, number>>;
  userMean: Array<number | null>;
  itemMean: Array<number | null>;
  itemSum: number[];
  itemCount: number[];
  globalMean: number;
  /** Observed rating range, used to clamp predictions. */
  lo: number;
  hi: number;
}

function buildTrain(ds: RatingsDataset, train: Rating[]): TrainData {
  const userRatings: Array<Map<number, number>> = [];
  for (let u = 0; u < ds.userCount; u += 1) userRatings.push(new Map());
  const itemRatings: Array<Map<number, number>> = [];
  for (let i = 0; i < ds.itemCount; i += 1) itemRatings.push(new Map());
  const itemSum = new Array<number>(ds.itemCount).fill(0);
  const itemCount = new Array<number>(ds.itemCount).fill(0);
  let total = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of train) {
    userRatings[r.u]!.set(r.i, r.r);
    itemRatings[r.i]!.set(r.u, r.r);
    itemSum[r.i] = (itemSum[r.i] ?? 0) + r.r;
    itemCount[r.i] = (itemCount[r.i] ?? 0) + 1;
    total += r.r;
    if (r.r < lo) lo = r.r;
    if (r.r > hi) hi = r.r;
  }
  const userMean = userRatings.map((m) =>
    m.size > 0 ? [...m.values()].reduce((acc, v) => acc + v, 0) / m.size : null,
  );
  const itemMean = itemCount.map((c, i) => (c > 0 ? (itemSum[i] ?? 0) / c : null));
  const globalMean = train.length > 0 ? total / train.length : 3;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 1;
    hi = 5;
  }
  if (hi - lo < 1e-9) {
    lo -= 0.5;
    hi += 0.5;
  }
  return { userRatings, itemRatings, userMean, itemMean, itemSum, itemCount, globalMean, lo, hi };
}

/** Bayesian-shrunk item popularity — the new-user fallback. */
function popularityScore(t: TrainData, i: number, shrink = 5): number {
  const c = t.itemCount[i] ?? 0;
  const s = t.itemSum[i] ?? 0;
  return (s + t.globalMean * shrink) / (c + shrink);
}

/** Pearson correlation (mean-centred cosine) over co-rated items. */
function pearson(
  a: Map<number, number>,
  b: Map<number, number>,
  ma: number | null,
  mb: number | null,
): number {
  if (ma === null || mb === null) return 0;
  let num = 0;
  let da2 = 0;
  let db2 = 0;
  let shared = 0;
  for (const [i, ra] of a) {
    const rb = b.get(i);
    if (rb === undefined) continue;
    shared += 1;
    const da = ra - ma;
    const db = rb - mb;
    num += da * db;
    da2 += da * da;
    db2 += db * db;
  }
  if (shared < 2 || da2 <= 1e-12 || db2 <= 1e-12) return 0;
  return num / Math.sqrt(da2 * db2);
}

/** Plain cosine similarity over co-rating users. */
function cosine(a: Map<number, number>, b: Map<number, number>): number {
  let num = 0;
  let da = 0;
  let db = 0;
  let shared = 0;
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (rb === undefined) continue;
    shared += 1;
    num += ra * rb;
    da += ra * ra;
    db += rb * rb;
  }
  if (shared === 0 || da <= 1e-12 || db <= 1e-12) return 0;
  return num / Math.sqrt(da * db);
}

// ---- algorithm builders -------------------------------------------------------

/** User-based CF: top-k Pearson neighbours, mean-centred weighted vote. */
function buildUserCf(t: TrainData, k: number): Predictor {
  const n = t.userRatings.length;
  const kk = Math.max(1, Math.floor(k));
  const neighbors: Array<Array<{ v: number; sim: number }>> = new Array(n);
  for (let u = 0; u < n; u += 1) {
    const ru = t.userRatings[u]!;
    const mu = t.userMean[u] ?? null;
    const list: Array<{ v: number; sim: number }> = [];
    if (ru.size > 0 && mu !== null) {
      for (let v = 0; v < n; v += 1) {
        if (v === u) continue;
        const sim = pearson(ru, t.userRatings[v]!, mu, t.userMean[v] ?? null);
        if (sim > 0) list.push({ v, sim });
      }
      list.sort((a, b) => b.sim - a.sim || a.v - b.v);
    }
    neighbors[u] = list.slice(0, kk);
  }
  return (u, i) => {
    if (t.userRatings[u]!.size === 0 || t.userMean[u] === null) {
      return { value: popularityScore(t, i), reason: 'cold-user' };
    }
    const mu = t.userMean[u]!;
    let num = 0;
    let den = 0;
    for (const { v, sim } of neighbors[u] ?? []) {
      const rv = t.userRatings[v]!.get(i);
      if (rv === undefined) continue;
      num += sim * (rv - (t.userMean[v] ?? mu));
      den += Math.abs(sim);
    }
    if (den <= 1e-9) {
      const im = t.itemMean[i] ?? null;
      if (im !== null) return { value: im, reason: 'sparse' };
      return { value: popularityScore(t, i), reason: 'new-item' };
    }
    return { value: clampNum(mu + num / den, t.lo, t.hi), reason: null };
  };
}

/** Item-based CF: top-k cosine neighbours over item rating columns. */
function buildItemCf(t: TrainData, k: number): Predictor {
  const n = t.itemRatings.length;
  const kk = Math.max(1, Math.floor(k));
  const neighbors: Array<Array<{ j: number; sim: number }>> = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const ri = t.itemRatings[i]!;
    const list: Array<{ j: number; sim: number }> = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const sim = cosine(ri, t.itemRatings[j]!);
      if (sim > 0) list.push({ j, sim });
    }
    list.sort((a, b) => b.sim - a.sim || a.j - b.j);
    neighbors[i] = list.slice(0, kk);
  }
  return (u, i) => {
    if (t.userRatings[u]!.size === 0) {
      return { value: popularityScore(t, i), reason: 'cold-user' };
    }
    const ru = t.userRatings[u]!;
    let num = 0;
    let den = 0;
    for (const { j, sim } of neighbors[i] ?? []) {
      const r = ru.get(j);
      if (r === undefined) continue;
      num += sim * r;
      den += Math.abs(sim);
    }
    if (den <= 1e-9) {
      const im = t.itemMean[i] ?? null;
      if (im !== null) return { value: im, reason: 'sparse' };
      return { value: popularityScore(t, i), reason: 'new-item' };
    }
    return { value: clampNum(num / den, t.lo, t.hi), reason: null };
  };
}

/**
 * Content-based: per-user ridge regression over item features (users with
 * too few ratings share the global ridge). Item features make new items
 * rankable without interaction data.
 */
function buildContent(t: TrainData, ds: RatingsDataset, train: Rating[]): Predictor {
  const F = ds.featureNames.length;
  const lambda = 1.0;
  let wGlobal = new Array<number>(F + 1).fill(0);
  if (F > 0 && train.length > 0) {
    const rows = train.map((r) => [1, ...ds.itemFeatures[r.i]!]);
    const ys = train.map((r) => r.r - t.globalMean);
    wGlobal = ridgeFit(rows, ys, lambda);
  }
  const wUser: Array<number[] | null> = new Array(t.userRatings.length).fill(null);
  if (F > 0) {
    for (let u = 0; u < t.userRatings.length; u += 1) {
      const m = t.userRatings[u]!;
      if (m.size < F + 2) continue; // too few equations — keep the global fit
      const rows: number[][] = [];
      const ys: number[] = [];
      for (const [i, r] of m) {
        rows.push([1, ...ds.itemFeatures[i]!]);
        ys.push(r - t.globalMean);
      }
      wUser[u] = ridgeFit(rows, ys, lambda);
    }
  }
  return (u, i) => {
    if (t.userRatings[u]!.size === 0) {
      return { value: popularityScore(t, i), reason: 'cold-user' };
    }
    const w = wUser[u] ?? wGlobal;
    const x = ds.itemFeatures[i] ?? [];
    let pred = t.globalMean + (w[0] ?? 0);
    for (let f = 0; f < F; f += 1) pred += (w[f + 1] ?? 0) * (x[f] ?? 0);
    const reason: FallbackReason | null = wUser[u] === null ? 'sparse' : null;
    return { value: clampNum(pred, t.lo, t.hi), reason };
  };
}

/**
 * ALS matrix factorization with L2 regularisation. Latent factors are
 * initialised from the seeded RNG, so the whole run is reproducible.
 */
function buildAls(t: TrainData, k: number, iterations: number, lambda: number, rng: Rng): Predictor {
  const kf = Math.max(2, Math.floor(k));
  const reg = Math.max(1e-6, lambda);
  const U: number[][] = [];
  const V: number[][] = [];
  for (let u = 0; u < t.userRatings.length; u += 1) {
    const row: number[] = [];
    for (let f = 0; f < kf; f += 1) row.push(gaussian(rng) * 0.1);
    U.push(row);
  }
  for (let i = 0; i < t.itemRatings.length; i += 1) {
    const row: number[] = [];
    for (let f = 0; f < kf; f += 1) row.push(gaussian(rng) * 0.1);
    V.push(row);
  }

  /** Ridge-solve one side's factors given the other side fixed. */
  const solveFactors = (
    maps: Array<Map<number, number>>,
    own: number[][],
    other: number[][],
  ): void => {
    for (let x = 0; x < maps.length; x += 1) {
      const m = maps[x]!;
      if (m.size === 0) continue; // cold profile keeps the seeded init
      const a: number[][] = [];
      for (let p = 0; p < kf; p += 1) a.push(new Array<number>(kf).fill(0));
      const b = new Array<number>(kf).fill(0);
      for (const [y, r] of m) {
        const vy = other[y]!;
        for (let p = 0; p < kf; p += 1) {
          b[p] = (b[p] ?? 0) + vy[p]! * r;
          const ap = a[p]!;
          for (let q = 0; q < kf; q += 1) ap[q] = (ap[q] ?? 0) + vy[p]! * vy[q]!;
        }
      }
      for (let p = 0; p < kf; p += 1) a[p]![p] = (a[p]![p] ?? 0) + reg;
      own[x] = solveLinearSystem(a, b);
    }
  };

  for (let it = 0; it < Math.max(1, Math.floor(iterations)); it += 1) {
    solveFactors(t.userRatings, U, V);
    solveFactors(t.itemRatings, V, U);
  }

  return (u, i) => {
    if (t.userRatings[u]!.size === 0) {
      return { value: popularityScore(t, i), reason: 'cold-user' };
    }
    if ((t.itemCount[i] ?? 0) === 0) {
      // New item: its factors were never trained — use the user's own mean.
      const um = t.userMean[u];
      return { value: clampNum(um ?? t.globalMean, t.lo, t.hi), reason: 'new-item' };
    }
    const uu = U[u]!;
    const vi = V[i]!;
    let dot = 0;
    for (let f = 0; f < kf; f += 1) dot += uu[f]! * vi[f]!;
    return { value: clampNum(dot, t.lo, t.hi), reason: null };
  };
}

/** Hybrid: `alpha · MF + (1 − alpha) · content`, content covers new items. */
function buildHybrid(mf: Predictor, content: Predictor, alpha: number): Predictor {
  const a = clampNum(alpha, 0, 1);
  return (u, i) => {
    const pm = mf(u, i);
    const pc = content(u, i);
    return { value: a * pm.value + (1 - a) * pc.value, reason: pc.reason ?? pm.reason };
  };
}

function buildPredictor(
  ds: RatingsDataset,
  t: TrainData,
  train: Rating[],
  params: RecsysParams,
  rng: Rng,
): Predictor {
  switch (params.algorithm) {
    case 'user-cf':
      return buildUserCf(t, params.neighbors);
    case 'item-cf':
      return buildItemCf(t, params.neighbors);
    case 'content':
      return buildContent(t, ds, train);
    case 'als':
      return buildAls(t, params.factors, params.iterations, params.lambda, rng);
    case 'hybrid': {
      const mf = buildAls(t, params.factors, params.iterations, params.lambda, rng);
      const content = buildContent(t, ds, train);
      return buildHybrid(mf, content, params.alpha);
    }
  }
  throw new Error(`unknown algorithm: ${params.algorithm}`);
}

// ---- evaluation ---------------------------------------------------------------

/**
 * NDCG@K of a ranked list of binary relevance flags. Exported so the
 * plugin's benchmark can sanity-check the metric implementation itself.
 */
export function computeNdcg(hitFlags: boolean[], k: number): number {
  const kk = Math.max(1, Math.floor(k));
  let dcg = 0;
  for (let pos = 0; pos < Math.min(kk, hitFlags.length); pos += 1) {
    if (hitFlags[pos]) dcg += 1 / Math.log2(pos + 2);
  }
  let rel = 0;
  for (const h of hitFlags) if (h) rel += 1;
  let ideal = 0;
  for (let pos = 0; pos < Math.min(kk, rel); pos += 1) ideal += 1 / Math.log2(pos + 2);
  return ideal > 0 ? dcg / ideal : 0;
}

interface EvalOutput {
  metrics: RecsysMetrics;
  scatter: ScatterPoint[];
  rankUsers: number;
  candidateCount: number;
  fallbackCount: number;
  newItemFallbacks: number;
  coldUserFallbacks: number;
}

/**
 * Seeded holdout evaluation: RMSE over all held-out pairs, plus Precision@K /
 * Recall@K / NDCG@K / MAP averaged over users with at least one relevant
 * (rating ≥ threshold) held-out item. Fallback coverage is counted over every
 * ranked candidate prediction.
 */
function evaluate(
  t: TrainData,
  ds: RatingsDataset,
  test: Rating[],
  predictor: Predictor,
  topK: number,
  relevantThreshold: number,
): EvalOutput {
  const scatter: ScatterPoint[] = [];
  let se = 0;
  let cnt = 0;
  for (const r of test) {
    const p = predictor(r.u, r.i);
    scatter.push({ actual: r.r, pred: p.value });
    se += (r.r - p.value) ** 2;
    cnt += 1;
  }
  const rmse = cnt > 0 ? Math.sqrt(se / cnt) : 0;

  const testByUser = new Map<number, Rating[]>();
  for (const r of test) {
    const list = testByUser.get(r.u);
    if (list) list.push(r);
    else testByUser.set(r.u, [r]);
  }

  const kk = Math.max(1, Math.floor(topK));
  let precisionSum = 0;
  let recallSum = 0;
  let ndcgSum = 0;
  let mapSum = 0;
  let rankUsers = 0;
  let candidateCount = 0;
  let fallbackCount = 0;
  let newItemFallbacks = 0;
  let coldUserFallbacks = 0;

  for (const [u, userTest] of testByUser) {
    const relevant = new Set<number>();
    for (const r of userTest) if (r.r >= relevantThreshold) relevant.add(r.i);
    if (relevant.size === 0) continue;
    rankUsers += 1;

    const scored: Array<{ i: number; value: number }> = [];
    for (let i = 0; i < ds.itemCount; i += 1) {
      if (t.userRatings[u]!.has(i)) continue;
      const p = predictor(u, i);
      candidateCount += 1;
      if (p.reason !== null) {
        fallbackCount += 1;
        if (p.reason === 'new-item') newItemFallbacks += 1;
        else if (p.reason === 'cold-user') coldUserFallbacks += 1;
      }
      scored.push({ i, value: p.value });
    }
    scored.sort((a, b) => b.value - a.value || a.i - b.i);
    const top = scored.slice(0, kk);

    let hits = 0;
    const flags: boolean[] = [];
    let ap = 0;
    for (let pos = 0; pos < top.length; pos += 1) {
      const hit = relevant.has(top[pos]!.i);
      flags.push(hit);
      if (hit) {
        hits += 1;
        ap += hits / (pos + 1);
      }
    }
    precisionSum += hits / kk;
    recallSum += hits / relevant.size;
    ndcgSum += computeNdcg(flags, kk);
    mapSum += ap / Math.min(kk, relevant.size);
  }

  const div = rankUsers > 0 ? rankUsers : 1;
  return {
    metrics: {
      precision: precisionSum / div,
      recall: recallSum / div,
      ndcg: ndcgSum / div,
      map: mapSum / div,
      rmse,
    },
    scatter,
    rankUsers,
    candidateCount,
    fallbackCount,
    newItemFallbacks,
    coldUserFallbacks,
  };
}

// ---- holdout split -----------------------------------------------------------

/**
 * Split each user's ratings into train/test with a seeded Fisher-Yates
 * shuffle. Users with a single rating are held out entirely so the
 * evaluation genuinely exercises the cold-user fallback.
 */
function splitHoldout(
  ds: RatingsDataset,
  ratio: number,
  rng: Rng,
): { train: Rating[]; test: Rating[] } {
  const byUser = new Map<number, Rating[]>();
  for (const r of ds.ratings) {
    const list = byUser.get(r.u);
    if (list) list.push(r);
    else byUser.set(r.u, [r]);
  }
  const train: Rating[] = [];
  const test: Rating[] = [];
  for (const list of byUser.values()) {
    if (list.length <= 1) {
      test.push(list[0]!);
      continue;
    }
    const h = clampNum(Math.round(list.length * clampNum(ratio, 0.05, 0.5)), 1, list.length - 1);
    const shuffled = list.slice();
    for (let k = shuffled.length - 1; k > 0; k -= 1) {
      const j = Math.floor(rng() * (k + 1));
      const tmp = shuffled[k]!;
      shuffled[k] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    for (let k = 0; k < h; k += 1) test.push(shuffled[k]!);
    for (let k = h; k < shuffled.length; k += 1) train.push(shuffled[k]!);
  }
  if (train.length === 0 && ds.ratings.length > 0) {
    // Degenerate corner (every user had exactly one rating): keep the whole
    // set trainable so the model still fits.
    return { train: ds.ratings.slice(), test: [] };
  }
  return { train, test };
}

// ---- main entry -----------------------------------------------------------------

/**
 * Train the selected recommender on a long-format ratings CSV (or a
 * pre-parsed dataset), evaluate on a seeded holdout and return metrics,
 * the training matrix, scatter points, top-N recommendations and cold-start
 * statistics. Deterministic given (input, params).
 */
export function runRecsys(input: string | RatingsDataset, params: RecsysParams): RecsysResult {
  const started = performance.now();
  const ds = typeof input === 'string' ? parseRatingsCsv(input) : input;
  const rng = mulberry32(params.seed >>> 0);
  const { train, test } = splitHoldout(ds, params.holdout, rng);
  const t = buildTrain(ds, train);
  const predictor = buildPredictor(ds, t, train, params, rng);
  const relevantThreshold = 4;
  const evalOut = evaluate(t, ds, test, predictor, params.topK, relevantThreshold);

  // Cold-start demo: a brand-new user with no ratings is served the shrunk
  // popularity list (this is also the fallback used by every algorithm).
  const popularity = ds.itemLabel
    .map((label, i) => ({ item: label, score: popularityScore(t, i) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.floor(params.topK)));

  // Top-N for the most active training user (deterministic tie-break by id).
  let bestUser = -1;
  let bestCount = 0;
  for (let u = 0; u < t.userRatings.length; u += 1) {
    const c = t.userRatings[u]!.size;
    if (c > bestCount) {
      bestCount = c;
      bestUser = u;
    }
  }
  let topN: RecsysResult['topN'] = { user: '', entries: popularity };
  if (bestUser >= 0 && bestCount > 0) {
    const scored: Array<{ i: number; value: number }> = [];
    for (let i = 0; i < ds.itemCount; i += 1) {
      if (t.userRatings[bestUser]!.has(i)) continue;
      scored.push({ i, value: predictor(bestUser, i).value });
    }
    scored.sort((a, b) => b.value - a.value || a.i - b.i);
    topN = {
      user: ds.userLabel[bestUser] ?? `U${bestUser + 1}`,
      entries: scored
        .slice(0, Math.max(1, Math.floor(params.topK)))
        .map((s) => ({ item: ds.itemLabel[s.i] ?? `I${s.i + 1}`, score: s.value })),
    };
  }

  const matrixValues: Array<number | null> = new Array(ds.userCount * ds.itemCount).fill(null);
  for (const r of train) matrixValues[r.u * ds.itemCount + r.i] = r.r;

  const coveragePct =
    evalOut.candidateCount > 0 ? (100 * evalOut.fallbackCount) / evalOut.candidateCount : 0;

  return {
    algorithm: params.algorithm,
    algorithmLabel: ALGORITHM_LABELS[params.algorithm][0],
    userCount: ds.userCount,
    itemCount: ds.itemCount,
    ratingCount: ds.ratings.length,
    featureCount: ds.featureNames.length,
    trainCount: train.length,
    testCount: test.length,
    topK: params.topK,
    holdout: params.holdout,
    metrics: evalOut.metrics,
    scatter: evalOut.scatter,
    matrix: {
      userCount: ds.userCount,
      itemCount: ds.itemCount,
      values: matrixValues,
      userLabel: ds.userLabel,
      itemLabel: ds.itemLabel,
    },
    topN,
    coldStart: {
      globalMean: t.globalMean,
      candidateCount: evalOut.candidateCount,
      fallbackCount: evalOut.fallbackCount,
      newItemFallbacks: evalOut.newItemFallbacks,
      coldUserFallbacks: evalOut.coldUserFallbacks,
      coveragePct,
      popularity,
    },
    rankUsers: evalOut.rankUsers,
    relevantThreshold,
    seed: params.seed,
    runtimeMs: performance.now() - started,
  };
}
