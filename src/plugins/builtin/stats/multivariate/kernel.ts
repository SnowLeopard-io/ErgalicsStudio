// ==========================================================================
// multivariate — PCA, factor analysis, clustering, discriminant analysis,
// canonical correlation and Mahalanobis outlier detection.
//
// Everything is pure TypeScript on a numeric matrix. The symmetric Jacobi
// eigensolver from `shared/stats-utils` powers PCA / CCA; the remaining
// routines build on the same covariance algebra.
// ==========================================================================

import { chiSquareCdf } from '@/core/stats/special';
import {
  covarianceMatrix,
  fmt,
  invert,
  jacobiEigen,
  matMul,
  mean,
  numericColumns,
  parseTable,
  standardizeRows,
  std,
  transpose,
  zeros,
  type Matrix,
} from '../../shared/stats-utils';

export interface MultiDataset {
  ids: string[];
  variables: string[];
  x: Matrix;
  groups: string[] | null;
  groupName: string | null;
}

const GROUP_NAMES = ['group', 'class', 'category', 'label', 'species', 'treatment', 'cluster'];
const ID_NAMES = ['id', 'name', 'sample', 'observation', 'subject'];

/** Parse the first two numeric columns as X/Y (or a full matrix when no header). */
export function parseMultivariate(text: string): MultiDataset {
  const table = parseTable(text);
  if (table.header.length === 0) return { ids: [], variables: [], x: [], groups: null, groupName: null };
  const lower = table.header.map((h) => h.toLowerCase());
  const groupIdx = lower.findIndex((h) => GROUP_NAMES.includes(h));
  const idIdx = lower.findIndex((h) => ID_NAMES.includes(h));
  const numeric = numericColumns(table);
  const variables = numeric.filter((_, i) => {
    const idx = table.header.indexOf(numeric[i]!);
    return idx !== groupIdx && idx !== idIdx;
  });
  const colIdx = variables.map((v) => table.header.indexOf(v));
  const x: Matrix = [];
  const ids: string[] = [];
  const groups: string[] = [];
  for (const row of table.rows) {
    const rec = colIdx.map((i) => Number(row[i]));
    if (rec.some((v) => !Number.isFinite(v))) continue;
    x.push(rec);
    ids.push(idIdx >= 0 ? String(row[idIdx] ?? '') : String(ids.length + 1));
    if (groupIdx >= 0) groups.push(String(row[groupIdx] ?? 'group'));
  }
  return {
    ids,
    variables,
    x,
    groups: groupIdx >= 0 ? groups : null,
    groupName: groupIdx >= 0 ? table.header[groupIdx]! : null,
  };
}

export interface PcaResult {
  means: number[];
  sds: number[];
  eigenvalues: number[];
  explained: number[];
  cumulative: number[];
  /** loadings[variable][component] */
  loadings: Matrix;
  /** scores[observation][component] */
  scores: Matrix;
  standardized: boolean;
}

/** Principal component analysis on the covariance or correlation matrix. */
export function pca(x: Matrix, standardize = true): PcaResult | null {
  if (x.length < 2 || (x[0]?.length ?? 0) < 2) return null;
  const p = x[0]!.length;
  const means: number[] = [];
  const sds: number[] = [];
  for (let j = 0; j < p; j += 1) {
    const col = x.map((r) => r[j]!);
    means.push(mean(col));
    sds.push(std(col, true));
  }
  const work = standardize ? standardizeRows(x) : x.map((row) => row.map((v, j) => v - means[j]!));
  const cov = covarianceMatrix(work, true);
  const eig = jacobiEigen(cov);
  const total = eig.values.reduce((s, v) => s + Math.max(0, v), 0);
  let cum = 0;
  const explained = eig.values.map((v) => {
    const frac = total > 0 ? Math.max(0, v) / total : 0;
    cum += frac;
    return frac;
  });
  const cumulative = explained.map((_, i) => explained.slice(0, i + 1).reduce((s, v) => s + v, 0));
  // Loadings = eigenvector * sqrt(eigenvalue) (correlation-scale loadings).
  const loadings: Matrix = Array.from({ length: p }, (_, j) =>
    eig.values.map((v, c) => eig.vectors[j]![c]! * Math.sqrt(Math.max(0, v))),
  );
  const scores = work.map((row) => eig.values.map((_, c) => row.reduce((s, v, j) => s + v * eig.vectors[j]![c]!, 0)));
  return { means, sds, eigenvalues: eig.values, explained, cumulative, loadings, scores, standardized: standardize };
}

/** Varimax rotation of a loadings matrix (rows = variables, cols = factors). */
export function varimax(loadings: Matrix, iterations = 50): Matrix {
  const p = loadings.length;
  const k = loadings[0]?.length ?? 0;
  const rot = zeros(k, k);
  for (let i = 0; i < k; i += 1) rot[i]![i] = 1;
  const current = loadings.map((r) => [...r]);
  for (let it = 0; it < iterations; it += 1) {
    for (let a = 0; a < k; a += 1) {
      for (let b = a + 1; b < k; b += 1) {
        let num = 0;
        let den = 0;
        for (let i = 0; i < p; i += 1) {
          const u = current[i]![a]!;
          const v = current[i]![b]!;
          const s = u * u - v * v;
          const d = 2 * u * v;
          num += s * d;
          den += s * s - d * d;
        }
        const angle = 0.25 * Math.atan2(num, den);
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        for (let i = 0; i < p; i += 1) {
          const u = current[i]![a]!;
          const v = current[i]![b]!;
          current[i]![a] = c * u + s * v;
          current[i]![b] = -s * u + c * v;
        }
        for (let i = 0; i < k; i += 1) {
          const u = rot[i]![a]!;
          const v = rot[i]![b]!;
          rot[i]![a] = c * u + s * v;
          rot[i]![b] = -s * u + c * v;
        }
      }
    }
  }
  return current;
}

export interface FactorResult {
  loadings: Matrix;
  communalities: number[];
  uniqueness: number[];
  varianceExplained: number[];
  rotated: Matrix;
}

/** Exploratory factor analysis (principal-axis extraction + varimax). */
export function factorAnalysis(x: Matrix, factors = 2): FactorResult | null {
  const model = pca(x, true);
  if (!model) return null;
  const k = Math.max(1, Math.min(factors, model.loadings[0]?.length ?? 1));
  const raw = model.loadings.map((row) => row.slice(0, k));
  const rotated = varimax(raw);
  const communalities = rotated.map((row) => row.reduce((s, v) => s + v * v, 0));
  const varianceExplained = Array.from({ length: k }, (_, c) =>
    rotated.reduce((s, row) => s + row[c]! * row[c]!, 0) / Math.max(1, rotated.length),
  );
  return {
    loadings: raw,
    rotated,
    communalities,
    uniqueness: communalities.map((h) => Math.max(0, 1 - h)),
    varianceExplained,
  };
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
}

export interface ClusterResult {
  labels: number[];
  k: number;
  /** Within-cluster sum of squares. */
  wss: number;
  /** Silhouette score (mean over observations), in [-1, 1]. */
  silhouette: number;
  centers: Matrix;
}

function silhouetteScore(x: Matrix, labels: number[], k: number): number {
  if (k < 2) return 0;
  const n = x.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const own = labels[i]!;
    let aSum = 0;
    let aCount = 0;
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const d = euclidean(x[i]!, x[j]!);
      if (labels[j] === own) {
        aSum += d;
        aCount += 1;
      }
      sums[labels[j]!]! += d;
      counts[labels[j]!]! += 1;
    }
    const a = aCount > 0 ? aSum / aCount : 0;
    let b = Infinity;
    for (let c = 0; c < k; c += 1) {
      if (c === own || counts[c] === 0) continue;
      b = Math.min(b, sums[c]! / counts[c]!);
    }
    if (!Number.isFinite(b)) continue;
    const s = Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
    total += s;
  }
  return total / n;
}

function clusterStats(x: Matrix, labels: number[], k: number): ClusterResult {
  const centers = zeros(k, x[0]?.length ?? 0);
  const counts = new Array<number>(k).fill(0);
  labels.forEach((lab, i) => {
    counts[lab]! += 1;
    for (let j = 0; j < (x[0]?.length ?? 0); j += 1) centers[lab]![j]! += x[i]![j]!;
  });
  for (let c = 0; c < k; c += 1) {
    for (let j = 0; j < (x[0]?.length ?? 0); j += 1) centers[c]![j]! /= Math.max(1, counts[c]!);
  }
  let wss = 0;
  labels.forEach((lab, i) => {
    wss += (euclidean(x[i]!, centers[lab]!) || 0) ** 2;
  });
  return { labels, k, wss, silhouette: silhouetteScore(x, labels, k), centers };
}

/** Agglomerative clustering with Ward linkage. */
export function hierarchicalCluster(x: Matrix, k = 3): ClusterResult | null {
  const n = x.length;
  if (n < 2) return null;
  const clusters = Array.from({ length: n }, (_, i) => ({ members: [i], center: [...x[i]!] }));
  while (clusters.length > k) {
    let bestI = 0;
    let bestJ = 1;
    let best = Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const ni = clusters[i]!.members.length;
        const nj = clusters[j]!.members.length;
        const d = (euclidean(clusters[i]!.center, clusters[j]!.center) ** 2) * ((ni * nj) / (ni + nj));
        if (d < best) {
          best = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const a = clusters[bestI]!;
    const b = clusters[bestJ]!;
    const members = [...a.members, ...b.members];
    const center = a.center.map((v, idx) => (v * a.members.length + b.center[idx]! * b.members.length) / members.length);
    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1, { members, center });
  }
  const labels = new Array<number>(n).fill(0);
  clusters.forEach((c, idx) => c.members.forEach((m) => (labels[m] = idx)));
  return clusterStats(x, labels, clusters.length);
}

/** k-means with deterministic k-means++ seeding. */
export function kmeans(x: Matrix, k = 3, seed = 42): ClusterResult | null {
  const n = x.length;
  if (n < k || k < 1) return null;
  let state = seed >>> 0;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const centers: Matrix = [[...x[Math.floor(rand() * n)]!]];
  while (centers.length < k) {
    const dists = x.map((row) => Math.min(...centers.map((c) => euclidean(row, c) ** 2)));
    const total = dists.reduce((s, d) => s + d, 0);
    let target = rand() * total;
    let pick = 0;
    for (let i = 0; i < n; i += 1) {
      target -= dists[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.push([...x[pick]!]);
  }
  let labels = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 200; iter += 1) {
    const next = x.map((row) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, idx) => {
        const d = euclidean(row, c);
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      });
      return best;
    });
    if (next.every((v, i) => v === labels[i])) break;
    labels = next;
    const counts = new Array<number>(k).fill(0);
    for (let c = 0; c < k; c += 1) centers[c] = new Array<number>(x[0]!.length).fill(0);
    labels.forEach((lab, i) => {
      counts[lab]! += 1;
      for (let j = 0; j < x[0]!.length; j += 1) centers[lab]![j]! += x[i]![j]!;
    });
    for (let c = 0; c < k; c += 1) {
      for (let j = 0; j < x[0]!.length; j += 1) centers[c]![j]! /= Math.max(1, counts[c]!);
    }
  }
  return clusterStats(x, labels, k);
}

/** DBSCAN density clustering. */
export function dbscan(x: Matrix, eps = 1, minPts = 3): ClusterResult {
  const n = x.length;
  const labels = new Array<number>(n).fill(-1);
  const neighbours = x.map((row, i) =>
    x.map((other, j) => (i === j ? -1 : euclidean(row, other))).map((d, j) => ({ d, j })).filter((o) => o.d <= eps).map((o) => o.j),
  );
  let cluster = 0;
  for (let i = 0; i < n; i += 1) {
    if (labels[i] !== -1  || neighbours[i]!.length + 1 < minPts) continue;
    labels[i] = cluster;
    const queue = [...neighbours[i]!];
    while (queue.length > 0) {
      const j = queue.pop()!;
      if (labels[j] === -1) {
        labels[j] = cluster;
        if (neighbours[j]!.length + 1 >= minPts) queue.push(...neighbours[j]!);
      }
    }
    cluster += 1;
  }
  return clusterStats(x, labels.map((l) => (l < 0 ? cluster : l)), cluster);
}

export interface DiscriminantResult {
  kind: 'lda' | 'qda';
  classes: string[];
  means: Matrix;
  priors: number[];
  accuracy: number;
  confusion: number[][];
  labels: string[];
  predicted: string[];
  coefficients: Matrix | null;
  /** Wilks' lambda (LDA only). */
  wilks: number;
  p: number;
}

function classStats(x: Matrix, groups: string[]): { classes: string[]; means: Matrix; covs: Matrix[]; priors: number[] } {
  const classes = [...new Set(groups)].sort();
  const means: Matrix = [];
  const covs: Matrix[] = [];
  const priors: number[] = [];
  for (const c of classes) {
    const rows = x.filter((_, i) => groups[i] === c);
    priors.push(rows.length / x.length);
    means.push(Array.from({ length: x[0]!.length }, (_, j) => mean(rows.map((r) => r[j]!))));
    covs.push(covarianceMatrix(rows, true));
  }
  return { classes, means, covs, priors };
}

function gaussianLogDensity(row: number[], mu: number[], cov: Matrix): number {
  const inv = invert(cov);
  if (!inv) return -Infinity;
  const d = row.map((v, i) => v - mu[i]!);
  let quad = 0;
  for (let i = 0; i < d.length; i += 1) for (let j = 0; j < d.length; j += 1) quad += d[i]! * inv[i]![j]! * d[j]!;
  let logDet = 0;
  // Symmetric positive-definite determinant via the Jacobi eigen-decomposition.
  const eig = jacobiEigen(cov);
  for (const v of eig.values) logDet += Math.log(Math.max(1e-30, v));
  return -0.5 * (d.length * Math.log(2 * Math.PI) + logDet + quad);
}

/** Linear / quadratic discriminant analysis. */
export function discriminant(x: Matrix, groups: string[], kind: 'lda' | 'qda' = 'lda'): DiscriminantResult | null {
  if (x.length < 4 || (x[0]?.length ?? 0) < 1) return null;
  const stats = classStats(x, groups);
  const p = x[0]!.length;
  const pooled = zeros(p, p);
  if (kind === 'lda') {
    stats.classes.forEach((c, ci) => {
      const n = groups.filter((g) => g === c).length;
      const cov = stats.covs[ci]!;
      for (let i = 0; i < p; i += 1) for (let j = 0; j < p; j += 1) pooled[i]![j]! += (Math.max(1, n - 1) * cov[i]![j]!) / Math.max(1, x.length - stats.classes.length);
    });
  }
  const predicted: string[] = [];
  const confusion = stats.classes.map(() => new Array<number>(stats.classes.length).fill(0));
  x.forEach((row, i) => {
    let best = 0;
    let bestScore = -Infinity;
    stats.classes.forEach((_, ci) => {
      const cov = kind === 'lda' ? pooled : stats.covs[ci]!;
      const score = gaussianLogDensity(row, stats.means[ci]!, cov) + Math.log(stats.priors[ci]! || 1e-12);
      if (score > bestScore) {
        bestScore = score;
        best = ci;
      }
    });
    const actual = stats.classes.indexOf(groups[i]!);
    confusion[actual]![best]! += 1;
    predicted.push(stats.classes[best]!);
  });
  let correct = 0;
  confusion.forEach((row, i) => (correct += row[i]!));
  // Wilks' lambda ~ prod(1/(1+canonical)) approximated from between/within.
  const grand = Array.from({ length: p }, (_, j) => mean(x.map((r) => r[j]!)));
  let between = 0;
  let within = 0;
  stats.classes.forEach((c, ci) => {
    const n = groups.filter((g) => g === c).length;
    stats.means[ci]!.forEach((m, j) => {
      between += n * (m - grand[j]!) ** 2;
    });
    within += (n - 1) * stats.covs[ci]![0]![0]!;
  });
  const lambda = within / Math.max(1e-30, within + between);
  const df = Math.max(1, (stats.classes.length - 1) * p);
  const chi = -Math.max(0, x.length - 1 - (p + stats.classes.length) / 2) * Math.log(Math.max(1e-30, lambda));
  const pValue = 1 - chiSquareCdf(chi, df);
  return {
    kind,
    classes: stats.classes,
    means: stats.means,
    priors: stats.priors,
    accuracy: correct / x.length,
    confusion,
    labels: groups,
    predicted,
    coefficients: kind === 'lda' ? invert(pooled) : null,
    wilks: lambda,
    p: pValue,
  };
}

export interface CcaResult {
  correlations: number[];
  xCoefficients: Matrix;
  yCoefficients: Matrix;
  xScores: Matrix;
  yScores: Matrix;
}

/** Canonical correlation analysis between two variable blocks. */
export function canonicalCorrelation(x: Matrix, y: Matrix): CcaResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const xs = standardizeRows(x.slice(0, n));
  const ys = standardizeRows(y.slice(0, n));
  const sxx = covarianceMatrix(xs, true);
  const syy = covarianceMatrix(ys, true);
  const sxy = matMul(transpose(xs), ys).map((row) => row.map((v) => v / Math.max(1, n - 1)));
  const ex = jacobiEigen(sxx);
  const ey = jacobiEigen(syy);
  const invSqrt = (eig: typeof ex): Matrix => {
    // V diag(λ^-1/2) Vᵀ  (columns of eig.vectors are eigenvectors).
    const v = eig.vectors;
    const scaled = v.map((row) => row.map((val, c) => (eig.values[c]! > 1e-12 ? val / Math.sqrt(eig.values[c]!) : 0)));
    return matMul(scaled, transpose(v));
  };
  const sx = invSqrt(ex);
  const sy = invSqrt(ey);
  const b = matMul(matMul(sx, sxy), sy);
  const btb = matMul(transpose(b), b);
  const eig = jacobiEigen(btb);
  const correlations = eig.values.map((v) => Math.sqrt(Math.max(0, v)));
  const xCoef = matMul(sx, matMul(b, eig.vectors));
  const yCoef = matMul(sy, eig.vectors);
  const k = correlations.length;
  const xScores = xs.map((row) => Array.from({ length: k }, (_, c) => row.reduce((s, v, j) => s + v * xCoef[j]![c]!, 0)));
  const yScores = ys.map((row) => Array.from({ length: k }, (_, c) => row.reduce((s, v, j) => s + v * yCoef[j]![c]!, 0)));
  return { correlations, xCoefficients: xCoef, yCoefficients: yCoef, xScores, yScores };
}

export interface OutlierResult {
  distances: number[];
  flagged: number[];
  threshold: number;
}

/** Mahalanobis distance with a chi-square cutoff. */
export function mahalanobisOutliers(x: Matrix, alpha = 0.975): OutlierResult {
  const p = x[0]?.length ?? 0;
  const cov = covarianceMatrix(x, true);
  const inv = invert(cov);
  const means = Array.from({ length: p }, (_, j) => mean(x.map((r) => r[j]!)));
  const threshold = chiSquareInvLocal(alpha, p);
  if (!inv) return { distances: new Array<number>(x.length).fill(NaN), flagged: [], threshold };
  const distances = x.map((row) => {
    const d = row.map((v, j) => v - means[j]!);
    let q = 0;
    for (let i = 0; i < p; i += 1) for (let j = 0; j < p; j += 1) q += d[i]! * inv[i]![j]! * d[j]!;
    return Math.sqrt(Math.max(0, q));
  });
  return { distances, flagged: distances.map((d, i) => (d > threshold ? i : -1)).filter((i) => i >= 0), threshold };
}

function chiSquareInvLocal(p: number, df: number): number {
  // Bisection on the shared chi-square CDF.
  let lo = 0;
  let hi = 1e4;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface MultivariateBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

function seededNormals(n: number, seed: number): number[] {
  let state = seed >>> 0;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const u = Math.max(1e-12, rand());
    out.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()));
  }
  return out;
}

/** Validation: recover two well-separated clusters and their first PC. */
export function runMultivariateBenchmark(): MultivariateBenchmark[] {
  const z1 = seededNormals(120, 12345);
  const z2 = seededNormals(120, 67890);
  const x: Matrix = [];
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    x.push([4 + z1[i]!, 4 + z1[i + 60]!]);
    groups.push('A');
    x.push([-4 + z2[i]!, -4 + z2[i + 60]!]);
    groups.push('B');
  }
  const model = pca(x, true);
  const km = kmeans(x, 2, 7);
  const lda = discriminant(x, groups, 'lda');
  const separation = km ? Math.min(...km.centers.map((c) => euclidean(c, [0, 0]))) : 0;
  const pc1 = model?.explained[0] ?? 0;
  return [
    {
      id: 'pca-pc1',
      passed: pc1 > 0.9,
      relErr: Math.abs(pc1 - 0.98),
      detail: `two-cluster data: PC1 explains ${fmt(pc1 * 100, 2)}% (≥90% threshold)`,
    },
    {
      id: 'kmeans-separation',
      passed: separation > 3,
      relErr: 0,
      detail: `k-means centres sit ${fmt(separation, 3)} from the origin (expected ≈5.66)`,
    },
    {
      id: 'lda-accuracy',
      passed: (lda?.accuracy ?? 0) > 0.99,
      relErr: 1 - (lda?.accuracy ?? 0),
      detail: `LDA resubstitution accuracy ${fmt((lda?.accuracy ?? 0) * 100, 2)}%`,
    },
  ];
}
