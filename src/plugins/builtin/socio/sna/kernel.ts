// ==========================================================================
// socio-sna — social network analysis kernel (pure, testable)
//
// Deterministic graph analytics on weighted networks stored as flat CSR
// adjacency arrays:
//   - centrality: degree (strength), betweenness (Brandes 1978), closeness
//     (Wasserman-Faust scaled), eigenvector (shifted power iteration),
//     PageRank (damped, dangling-aware)
//   - communities: Louvain modularity optimisation (Blondel et al. 2008,
//     seeded node order, smallest-id tie-breaking), label propagation,
//     Girvan-Newman edge-betweenness peeling (Girvan & Newman 2002,
//     step-limited for small graphs)
//   - influence: independent cascade and linear threshold (seeded rng),
//     adopted-per-step series
//   - structural holes: Burt's constraint (neighbourhood form), brokerage
//     score, bridge-edge detection
// All functions are pure — no canvas, no DOM, no Math.random.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type MeasureKind = 'degree' | 'betweenness' | 'closeness' | 'eigenvector' | 'pagerank';
export type CommunityKind = 'none' | 'louvain' | 'label-prop' | 'girvan-newman';
export type CascadeKind = 'none' | 'independent-cascade' | 'linear-threshold';
export type SampleKind = 'star' | 'path' | 'planted' | 'random';

// ---- graph representation ---------------------------------------------------

/** One weighted edge between integer node indices. */
export interface RawEdge {
  source: number;
  target: number;
  weight: number;
}

/**
 * CSR-style adjacency: flat arrays, arcs sorted by source node. Undirected
 * graphs store both directions (weights symmetric); `edgeCount` counts
 * canonical edges (each undirected pair once, each directed arc once).
 */
export interface Graph {
  readonly n: number;
  readonly directed: boolean;
  /** Number of stored arcs (undirected: 2 per edge). */
  readonly m: number;
  /** Canonical edge count. */
  readonly edgeCount: number;
  readonly offsets: Int32Array; // n + 1
  readonly sources: Int32Array; // m
  readonly targets: Int32Array; // m
  readonly weights: Float64Array; // m
  /** Canonical edge id per arc; the two arcs of an undirected edge share it. */
  readonly edgeIds: Int32Array; // m
}

/**
 * Build a graph from an edge list. Duplicate (u, v) pairs merge by weight
 * summation; self-loops and non-positive weights are dropped so every
 * downstream routine sees a clean non-negative weighted adjacency.
 */
export function buildGraph(n: number, edges: readonly RawEdge[], directed: boolean): Graph {
  // Canonical edges: keyed pair -> merged weight (insertion order = deterministic).
  const canon: Array<{ u: number; v: number; w: number }> = [];
  const keyToId = new Map<number, number>();
  for (const e of edges) {
    const u = e.source;
    const v = e.target;
    if (!Number.isInteger(u) || !Number.isInteger(v)) continue;
    if (u < 0 || v < 0 || u >= n || v >= n || u === v) continue;
    const w = Math.max(0, Number(e.weight) || 0);
    if (w <= 0) continue;
    const key = directed ? u * n + v : Math.min(u, v) * n + Math.max(u, v);
    const id = keyToId.get(key);
    if (id === undefined) {
      keyToId.set(key, canon.length);
      canon.push({ u: Math.min(u, v), v: Math.max(u, v), w });
    } else {
      canon[id]!.w += w;
    }
  }

  // Expand to arcs (both directions when undirected) and counting-sort by source.
  const arcU = new Int32Array(directed ? canon.length : canon.length * 2);
  const arcV = new Int32Array(arcU.length);
  const arcW = new Float64Array(arcU.length);
  const arcE = new Int32Array(arcU.length);
  let a = 0;
  for (let e = 0; e < canon.length; e += 1) {
    const { u, v, w } = canon[e]!;
    arcU[a] = u; arcV[a] = v; arcW[a] = w; arcE[a] = e; a += 1;
    if (!directed) {
      arcU[a] = v; arcV[a] = u; arcW[a] = w; arcE[a] = e; a += 1;
    }
  }
  const deg = new Int32Array(n + 1);
  for (let i = 0; i < a; i += 1) deg[arcU[i]! + 1]! += 1;
  for (let i = 0; i < n; i += 1) deg[i + 1]! += deg[i]!;
  const offsets = Int32Array.from(deg);
  const sources = new Int32Array(a);
  const targets = new Int32Array(a);
  const weights = new Float64Array(a);
  const edgeIds = new Int32Array(a);
  const cursor = Int32Array.from(offsets);
  // Stable fill in arc order keeps a deterministic arc order within each node.
  for (let i = 0; i < a; i += 1) {
    const u = arcU[i]!;
    const p = cursor[u]!;
    cursor[u] = p + 1;
    sources[p] = u;
    targets[p] = arcV[i]!;
    weights[p] = arcW[i]!;
    edgeIds[p] = arcE[i]!;
  }
  return {
    n,
    directed,
    m: a,
    edgeCount: canon.length,
    offsets,
    sources,
    targets,
    weights,
    edgeIds,
  };
}

/** Canonical undirected-view edge list (each pair once; directed arcs as-is). */
export function undirectedEdges(g: Graph): Array<{ u: number; v: number; w: number }> {
  const out: Array<{ u: number; v: number; w: number }> = [];
  if (g.directed) {
    for (let a = 0; a < g.m; a += 1) out.push({ u: g.sources[a]!, v: g.targets[a]!, w: g.weights[a]! });
    return out;
  }
  for (let e = 0; e < g.edgeCount; e += 1) {
    let u = -1;
    let v = -1;
    let w = 0;
    for (let a = 0; a < g.m; a += 1) {
      if (g.edgeIds[a] === e) {
        u = g.sources[a]!;
        v = g.targets[a]!;
        w = g.weights[a]!;
        if (u > v) {
          u = g.targets[a]!;
          v = g.sources[a]!;
        }
        break;
      }
    }
    out.push({ u, v, w });
  }
  return out;
}

// ---- sample network builders --------------------------------------------------

/** Star K_{1,n-1}: node 0 is the hub. */
export function starGraph(n: number): RawEdge[] {
  const edges: RawEdge[] = [];
  for (let i = 1; i < n; i += 1) edges.push({ source: 0, target: i, weight: 1 });
  return edges;
}

/** Path P_n: 0-1-...-(n-1). */
export function pathGraph(n: number): RawEdge[] {
  const edges: RawEdge[] = [];
  for (let i = 0; i + 1 < n; i += 1) edges.push({ source: i, target: i + 1, weight: 1 });
  return edges;
}

/**
 * Two-block planted partition: within each block a cycle plus diametral
 * chords (dense, deterministic); exactly two cross-block edges. Ground-truth
 * communities are {0..bs-1} and {bs..n-1}.
 */
export function plantedPartitionGraph(totalNodes: number): RawEdge[] {
  const edges: RawEdge[] = [];
  const bs = Math.max(2, Math.ceil(totalNodes / 2));
  const addBlock = (base: number, size: number): void => {
    for (let i = 0; i < size; i += 1) edges.push({ source: base + i, target: base + ((i + 1) % size), weight: 1 });
    const half = Math.floor(size / 2);
    if (half > 1) {
      for (let i = 0; i < half; i += 1) edges.push({ source: base + i, target: base + i + half, weight: 1 });
    }
  };
  addBlock(0, Math.min(bs, totalNodes));
  if (totalNodes > bs) addBlock(bs, totalNodes - bs);
  if (totalNodes >= 4) {
    edges.push({ source: bs - 1, target: bs, weight: 1 });
    edges.push({ source: 0, target: totalNodes - 1, weight: 1 });
  }
  return edges;
}

/** Erdos-Renyi G(n, m) with m = round(avgDegree * n / 2) distinct pairs. */
export function randomGraph(n: number, avgDegree: number, rand: () => number): RawEdge[] {
  const target = Math.max(0, Math.min((n * (n - 1)) / 2, Math.round((avgDegree * n) / 2)));
  const seen = new Set<number>();
  const edges: RawEdge[] = [];
  let guard = target * 40 + 1000;
  while (edges.length < target && guard > 0) {
    guard -= 1;
    const u = Math.floor(rand() * n);
    const v = Math.floor(rand() * n);
    if (u === v) continue;
    const key = Math.min(u, v) * n + Math.max(u, v);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: u, target: v, weight: 1 });
  }
  return edges;
}

// ---- centrality ----------------------------------------------------------------

/**
 * Weighted degree (node strength). Undirected: incident weight once.
 * Directed: in-strength + out-strength.
 */
export function degreeCentrality(g: Graph): number[] {
  const deg = new Float64Array(g.n);
  if (g.directed) {
    for (let a = 0; a < g.m; a += 1) {
      deg[g.sources[a]!]! += g.weights[a]!;
      deg[g.targets[a]!]! += g.weights[a]!;
    }
  } else {
    for (let a = 0; a < g.m; a += 1) deg[g.sources[a]!]! += g.weights[a]!;
  }
  return Array.from(deg);
}

/**
 * Betweenness centrality via Brandes' algorithm (Brandes 2001) on unweighted
 * shortest paths. Undirected graphs use the unordered-pair convention
 * (each pair counted once). Handles directed graphs and disconnected nodes.
 */
export function betweennessCentrality(g: Graph): number[] {
  const n = g.n;
  const bc = new Float64Array(n);
  if (n < 3) return Array.from(bc);
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n);
  const delta = new Float64Array(n);
  const queue = new Int32Array(n);
  const stack = new Int32Array(n);
  const preds: number[][] = new Array(n);
  for (let i = 0; i < n; i += 1) preds[i] = [];
  for (let s = 0; s < n; s += 1) {
    sigma.fill(0);
    dist.fill(-1);
    delta.fill(0);
    for (let i = 0; i < n; i += 1) preds[i]!.length = 0;
    sigma[s] = 1;
    dist[s] = 0;
    let head = 0;
    let tail = 0;
    let top = 0;
    queue[tail] = s;
    tail += 1;
    while (head < tail) {
      const v = queue[head]!;
      head += 1;
      stack[top] = v;
      top += 1;
      const dv = dist[v]!;
      for (let a = g.offsets[v]!; a < g.offsets[v + 1]!; a += 1) {
        const w = g.targets[a]!;
        if (dist[w]! < 0) {
          dist[w] = dv + 1;
          queue[tail] = w;
          tail += 1;
        }
        if (dist[w] === dv + 1) {
          sigma[w]! += sigma[v]!;
          preds[w]!.push(v);
        }
      }
    }
    while (top > 0) {
      top -= 1;
      const w = stack[top]!;
      const pw = preds[w]!;
      for (let i = 0; i < pw.length; i += 1) {
        const v = pw[i]!;
        delta[v]! += (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      if (w !== s) bc[w]! += delta[w]!;
    }
  }
  if (!g.directed) for (let i = 0; i < n; i += 1) bc[i]! /= 2;
  return Array.from(bc);
}

/**
 * Closeness centrality with Wasserman-Faust scaling for disconnected graphs:
 * C(v) = (k / (n-1)) * (k / sum of distances), k = reachable others.
 */
export function closenessCentrality(g: Graph): number[] {
  const n = g.n;
  const out = new Float64Array(n);
  if (n < 2) return Array.from(out);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s += 1) {
    dist.fill(-1);
    dist[s] = 0;
    let head = 0;
    let tail = 0;
    queue[tail] = s;
    tail += 1;
    let sum = 0;
    let k = 0;
    while (head < tail) {
      const v = queue[head]!;
      head += 1;
      const dv = dist[v]!;
      for (let a = g.offsets[v]!; a < g.offsets[v + 1]!; a += 1) {
        const w = g.targets[a]!;
        if (dist[w]! < 0) {
          dist[w] = dv + 1;
          queue[tail] = w;
          tail += 1;
          sum += dv + 1;
          k += 1;
        }
      }
    }
    if (k > 0 && sum > 0) out[s] = (k / (n - 1)) * (k / sum);
  }
  return Array.from(out);
}

/**
 * Eigenvector centrality by power iteration on A + I (the unit shift removes
 * the lambda = -lambda_1 oscillation of bipartite graphs such as stars).
 * Fixed iteration budget with an L1 early stop; result is L2-normalised.
 * Directed graphs use in-edges (x = A^T x).
 */
export function eigenvectorCentrality(g: Graph, iterations = 200): number[] {
  const n = g.n;
  if (n === 0) return [];
  let v = new Float64Array(n).fill(1 / Math.sqrt(n));
  const next = new Float64Array(n);
  for (let it = 0; it < iterations; it += 1) {
    next.fill(0);
    for (let i = 0; i < n; i += 1) next[i]! += v[i]!; // + I shift
    for (let a = 0; a < g.m; a += 1) next[g.targets[a]!]! += v[g.sources[a]!]! * g.weights[a]!;
    let norm = 0;
    for (let i = 0; i < n; i += 1) norm += next[i]! * next[i]!;
    norm = Math.sqrt(norm);
    if (norm === 0) return Array.from(next);
    let diff = 0;
    for (let i = 0; i < n; i += 1) {
      next[i]! /= norm;
      diff += Math.abs(next[i]! - v[i]!);
    }
    v = Float64Array.from(next);
    if (diff < 1e-12) break;
  }
  return Array.from(v);
}

/**
 * PageRank with damping (dangling mass redistributed uniformly). The result
 * sums to 1. Transition probabilities are weight-based (w / out-strength).
 */
export function pagerankCentrality(g: Graph, damping = 0.85, iterations = 100): number[] {
  const n = g.n;
  if (n === 0) return [];
  const outStrength = new Float64Array(n);
  for (let a = 0; a < g.m; a += 1) outStrength[g.sources[a]!]! += g.weights[a]!;
  let pr = new Float64Array(n).fill(1 / n);
  const next = new Float64Array(n);
  for (let it = 0; it < iterations; it += 1) {
    let dangling = 0;
    for (let i = 0; i < n; i += 1) if (outStrength[i] === 0) dangling += pr[i]!;
    const base = (1 - damping) / n + (damping * dangling) / n;
    next.fill(base);
    for (let a = 0; a < g.m; a += 1) {
      const s = g.sources[a]!;
      if (outStrength[s]! > 0) next[g.targets[a]!]! += (damping * g.weights[a]! * pr[s]!) / outStrength[s]!;
    }
    let diff = 0;
    for (let i = 0; i < n; i += 1) diff += Math.abs(next[i]! - pr[i]!);
    pr = Float64Array.from(next);
    if (diff < 1e-13) break;
  }
  return Array.from(pr);
}

/** Compute any measure by kind (dispatch helper for the plugin). */
export function computeMeasure(g: Graph, kind: MeasureKind): number[] {
  switch (kind) {
    case 'degree':
      return degreeCentrality(g);
    case 'betweenness':
      return betweennessCentrality(g);
    case 'closeness':
      return closenessCentrality(g);
    case 'eigenvector':
      return eigenvectorCentrality(g);
    case 'pagerank':
      return pagerankCentrality(g);
  }
}

// ---- modularity & communities ----------------------------------------------------

/** Weighted modularity of a partition (symmetrised view; resolution gamma). */
export function modularity(g: Graph, communityOf: ArrayLike<number>, gamma = 1): number {
  const n = g.n;
  if (n === 0) return 0;
  const deg = new Float64Array(n);
  for (let a = 0; a < g.m; a += 1) {
    deg[g.sources[a]!]! += g.weights[a]!;
    deg[g.targets[a]!]! += g.weights[a]!;
  }
  let twoM = 0;
  for (let i = 0; i < n; i += 1) twoM += deg[i]!;
  if (twoM === 0) return 0;
  const intra = new Float64Array(n);
  const degSum = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = communityOf[i]!;
    degSum[c]! += deg[i]!;
  }
  for (let a = 0; a < g.m; a += 1) {
    const u = g.sources[a]!;
    const v = g.targets[a]!;
    if (u !== v && communityOf[u] === communityOf[v]) intra[communityOf[u]!]! += g.weights[a]!;
  }
  let q = 0;
  for (let c = 0; c < n; c += 1) {
    if (degSum[c] === 0) continue;
    q += intra[c]! / twoM - (gamma * (degSum[c]! / twoM)) ** 2;
  }
  return q;
}

interface WeightedAdj {
  size: number;
  /** adj[i].get(j) = A_ij (symmetric, self-loops included once). */
  adj: Array<Map<number, number>>;
  strength: Float64Array;
  /** 2m = total strength. */
  twoM: number;
}

function buildWeightedAdj(n: number, edges: Array<{ u: number; v: number; w: number }>): WeightedAdj {
  const adj: Array<Map<number, number>> = new Array(n);
  for (let i = 0; i < n; i += 1) adj[i] = new Map();
  for (const { u, v, w } of edges) {
    if (u === v) {
      adj[u]!.set(u, (adj[u]!.get(u) ?? 0) + 2 * w);
      continue;
    }
    adj[u]!.set(v, (adj[u]!.get(v) ?? 0) + w);
    adj[v]!.set(u, (adj[v]!.get(u) ?? 0) + w);
  }
  const strength = new Float64Array(n);
  let twoM = 0;
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (const w of adj[i]!.values()) s += w;
    strength[i] = s;
    twoM += s;
  }
  return { size: n, adj, strength, twoM };
}

function shuffle(order: Int32Array, rand: () => number): void {
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
}

/** One level of Louvain local moving; returns labels and whether anything moved. */
function louvainLocalMoving(net: WeightedAdj, rand: () => number, gamma: number): { labels: Int32Array; moved: boolean } {
  const n = net.size;
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i += 1) labels[i] = i;
  const tot = Float64Array.from(net.strength);
  const order = Int32Array.from({ length: n }, (_, i) => i);
  let moved = false;
  for (let pass = 0; pass < 30; pass += 1) {
    shuffle(order, rand);
    let passMoves = 0;
    for (let oi = 0; oi < n; oi += 1) {
      const i = order[oi]!;
      const ci = labels[i]!;
      // Weights from i into each neighbouring community (excluding i itself).
      const links = new Map<number, number>();
      for (const [j, w] of net.adj[i]!) {
        if (j === i) continue;
        const cj = labels[j]!;
        links.set(cj, (links.get(cj) ?? 0) + w);
      }
      // Remove i from its community.
      tot[ci]! -= net.strength[i]!;
      // Evaluate candidate communities in ascending id order (deterministic).
      const candidates = Array.from(links.keys()).sort((a, b) => a - b);
      if (!candidates.includes(ci)) candidates.push(ci);
      let best = ci;
      let bestGain = 0; // strict: ties keep the smaller community id visited first
      for (const c of candidates) {
        const gain = (links.get(c) ?? 0) - (gamma * tot[c]! * net.strength[i]!) / net.twoM;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          best = c;
        }
      }
      labels[i] = best;
      tot[best]! += net.strength[i]!;
      if (best !== ci) passMoves += 1;
    }
    if (passMoves === 0) break;
    moved = true;
  }
  return { labels, moved };
}

export interface CommunityResult {
  /** Community id per original node. */
  communityOf: Int32Array;
  communities: number;
  modularity: number;
}

/**
 * Louvain modularity optimisation (Blondel et al. 2008): greedy local moving
 * with seeded node-order shuffles and smallest-id tie-breaking, followed by
 * community aggregation, repeated until no move improves the partition.
 */
export function louvainCommunities(g: Graph, seed: number, gamma = 1): CommunityResult {
  const rand = mulberry32(seed >>> 0 || 1);
  const n = g.n;
  const assign = Int32Array.from({ length: n }, (_, i) => i);
  if (n === 0) return { communityOf: assign, communities: 0, modularity: 0 };
  let net = buildWeightedAdj(n, undirectedEdges(g));
  for (let level = 0; level < 15; level += 1) {
    const { labels, moved } = louvainLocalMoving(net, rand, gamma);
    if (!moved) break;
    // Renumber communities (ascending first-appearance order) and aggregate.
    const remap = new Map<number, number>();
    for (let i = 0; i < net.size; i += 1) {
      const c = labels[i]!;
      if (!remap.has(c)) remap.set(c, remap.size);
    }
    const aggEdges: Array<{ u: number; v: number; w: number }> = [];
    const aggKey = new Map<number, number>();
    for (let i = 0; i < net.size; i += 1) {
      const ci = remap.get(labels[i]!)!;
      for (const [j, w] of net.adj[i]!) {
        const cj = remap.get(labels[j]!)!;
        const key = ci * net.size + cj;
        aggKey.set(key, (aggKey.get(key) ?? 0) + w);
      }
    }
    for (const [key, w] of aggKey) {
      const u = Math.floor(key / net.size);
      const v = key % net.size;
      if (u <= v) aggEdges.push({ u, v, w: v === u ? w / 2 : w });
    }
    for (let i = 0; i < n; i += 1) assign[i] = remap.get(labels[assign[i]!]!)!;
    net = buildWeightedAdj(remap.size, aggEdges);
    if (net.size === 1) break;
  }
  let communities = 0;
  for (let i = 0; i < n; i += 1) communities = Math.max(communities, assign[i]! + 1);
  return { communityOf: assign, communities, modularity: modularity(g, assign, gamma) };
}

/**
 * Label propagation: seeded asynchronous updates (most frequent neighbour
 * label, weighted, ties to the smallest label id). Converges or stops after
 * `maxIterations` sweeps.
 */
export function labelPropagation(g: Graph, seed: number, maxIterations = 60): Int32Array {
  const rand = mulberry32(seed >>> 0 || 1);
  const n = g.n;
  const labels = Int32Array.from({ length: n }, (_, i) => i);
  if (n === 0) return labels;
  const net = buildWeightedAdj(n, undirectedEdges(g));
  const order = Int32Array.from({ length: n }, (_, i) => i);
  for (let it = 0; it < maxIterations; it += 1) {
    shuffle(order, rand);
    let changed = 0;
    for (let oi = 0; oi < n; oi += 1) {
      const i = order[oi]!;
      const tally = new Map<number, number>();
      for (const [j, w] of net.adj[i]!) {
        if (j === i) continue;
        const lj = labels[j]!;
        tally.set(lj, (tally.get(lj) ?? 0) + w);
      }
      if (tally.size === 0) continue;
      let best = -1;
      let bestW = -1;
      for (const c of Array.from(tally.keys()).sort((a, b) => a - b)) {
        const w = tally.get(c)!;
        if (w > bestW + 1e-12) {
          bestW = w;
          best = c;
        }
      }
      if (best >= 0 && best !== labels[i]) {
        labels[i] = best;
        changed += 1;
      }
    }
    if (changed === 0) break;
  }
  return labels;
}

export interface GirvanNewmanResult {
  communityOf: Int32Array;
  communities: number;
  /** Edges removed, in order: endpooints and their edge betweenness. */
  removed: Array<{ u: number; v: number; betweenness: number }>;
  steps: number;
}

/**
 * Girvan-Newman community detection (Girvan & Newman 2002): repeatedly
 * remove the edge with the highest edge betweenness (Brandes accumulation,
 * unweighted). Step-limited — intended for small graphs. Undirected view;
 * ties break on the smaller (u, v).
 */
export function girvanNewman(g: Graph, maxSteps: number): GirvanNewmanResult {
  const n = g.n;
  const edges = undirectedEdges(g);
  const alive = new Uint8Array(edges.length).fill(1);
  const inc: number[][] = new Array(n);
  for (let i = 0; i < n; i += 1) inc[i] = [];
  for (let e = 0; e < edges.length; e += 1) {
    inc[edges[e]!.u]!.push(e);
    inc[edges[e]!.v]!.push(e);
  }
  const communityOf = new Int32Array(n);
  const removed: Array<{ u: number; v: number; betweenness: number }> = [];
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n);
  const delta = new Float64Array(n);
  const queue = new Int32Array(n);
  const stack = new Int32Array(n);
  const edgeScore = new Float64Array(edges.length);
  const sourceTotals = new Float64Array(edges.length);
  let steps = 0;
  const markComponents = (): number => {
    const comp = new Int32Array(n).fill(-1);
    let c = 0;
    const bfsQueue = new Int32Array(n);
    for (let s = 0; s < n; s += 1) {
      if (comp[s]! >= 0) continue;
      let head = 0;
      let tail = 0;
      comp[s] = c;
      bfsQueue[tail] = s;
      tail += 1;
      while (head < tail) {
        const v = bfsQueue[head]!;
        head += 1;
        for (const e of inc[v]!) {
          if (!alive[e]) continue;
          const nb = edges[e]!.u === v ? edges[e]!.v : edges[e]!.u;
          if (comp[nb]! < 0) {
            comp[nb] = c;
            bfsQueue[tail] = nb;
            tail += 1;
          }
        }
      }
      c += 1;
    }
    communityOf.set(comp);
    return c;
  };
  let communities = markComponents();
  for (let step = 0; step < maxSteps; step += 1) {
    let bestScore = -1;
    let bestEdge = -1;
    // Edge betweenness via Brandes accumulation on the alive subgraph.
    for (let s = 0; s < n; s += 1) {
      sigma.fill(0);
      dist.fill(-1);
      delta.fill(0);
      edgeScore.fill(0);
      sigma[s] = 1;
      dist[s] = 0;
      let head = 0;
      let tail = 0;
      let top = 0;
      queue[tail] = s;
      tail += 1;
      while (head < tail) {
        const v = queue[head]!;
        head += 1;
        stack[top] = v;
        top += 1;
        const dv = dist[v]!;
        for (const e of inc[v]!) {
          if (!alive[e]) continue;
          const w = edges[e]!.u === v ? edges[e]!.v : edges[e]!.u;
          if (dist[w]! < 0) {
            dist[w] = dv + 1;
            queue[tail] = w;
            tail += 1;
          }
          if (dist[w] === dv + 1) sigma[w]! += sigma[v]!;
        }
      }
      while (top > 0) {
        top -= 1;
        const w = stack[top]!;
        for (const e of inc[w]!) {
          if (!alive[e]) continue;
          const u = edges[e]!.u;
          const v = edges[e]!.v;
          const pred = u === w ? v : u;
          // pred is a valid predecessor iff dist[pred] = dist[w] - 1.
          if (dist[pred] !== dist[w]! - 1) continue;
          const c = (sigma[pred]! / sigma[w]!) * (1 + delta[w]!);
          edgeScore[e]! += c;
          delta[pred]! += c;
        }
      }
      for (let e = 0; e < edges.length; e += 1) {
        if (alive[e] && edgeScore[e]! > 0) sourceTotals[e]! += edgeScore[e]!;
      }
    }
    for (let e = 0; e < edges.length; e += 1) {
      if (!alive[e]) continue;
      const score = sourceTotals[e]! / 2;
      if (score > bestScore + 1e-12) {
        bestScore = score;
        bestEdge = e;
      }
    }
    sourceTotals.fill(0);
    if (bestEdge < 0 || bestScore <= 0) break;
    alive[bestEdge] = 0;
    const { u, v } = edges[bestEdge]!;
    removed.push({ u, v, betweenness: bestScore });
    steps += 1;
    communities = markComponents();
    if (communities >= n) break;
  }
  return { communityOf, communities, removed, steps };
}

// ---- influence propagation --------------------------------------------------------

export interface CascadeSim {
  /** Advance one wave; returns the number of newly adopted nodes. */
  step(): number;
  /** Cumulative adopted count after each step; index 0 = seeds. */
  readonly series: number[];
  /** 1 for adopted nodes. */
  readonly adopted: Uint8Array;
  /** Step index at which each node was adopted (-1 = never). */
  readonly adoptedStep: Int32Array;
  readonly finished: boolean;
  readonly total: number;
}

/**
 * Independent cascade (Goldenberg et al.): each newly active node gets one
 * attempt per out-edge, succeeding with probability `p` (seeded rng).
 * `p` is clamped to [0, 1].
 */
export function makeIndependentCascade(g: Graph, seeds: number[], p: number, seed: number): CascadeSim {
  const rand = mulberry32(seed >>> 0 || 1);
  const prob = Math.min(1, Math.max(0, p));
  const adopted = new Uint8Array(g.n);
  const adoptedStep = new Int32Array(g.n).fill(-1);
  const series: number[] = [];
  let frontier: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < g.n && !adopted[s]) {
      adopted[s] = 1;
      adoptedStep[s] = 0;
      frontier.push(s);
    }
  }
  series.push(frontier.length);
  let stepIndex = 0;
  return {
    step() {
      if (frontier.length === 0) return 0;
      stepIndex += 1;
      const next: number[] = [];
      for (const u of frontier) {
        for (let a = g.offsets[u]!; a < g.offsets[u + 1]!; a += 1) {
          const v = g.targets[a]!;
          if (!adopted[v] && rand() < prob) {
            adopted[v] = 1;
            adoptedStep[v] = stepIndex;
            next.push(v);
          }
        }
      }
      frontier = next;
      // Record only productive waves: a wave that adopts nothing is terminal,
      // so the series stays at the last adoption (seed-only runs keep [nSeeds]).
      if (next.length > 0) series.push(adopted.reduce((acc, f) => acc + f, 0));
      return next.length;
    },
    series,
    adopted,
    adoptedStep,
    get finished() {
      return frontier.length === 0;
    },
    get total() {
      return adopted.reduce((acc, f) => acc + f, 0);
    },
  };
}

/**
 * Linear threshold (Granovetter / Kempe-Kleinberg): node v adopts when the
 * total weight of active in-neighbours reaches its threshold. Thresholds are
 * theta_v = thresholdScale * rand() with a seeded rng, so `thresholdScale`
 * grades the cascade from easy (small) to hard (near 1).
 */
export function makeLinearThreshold(g: Graph, seeds: number[], thresholdScale: number, seed: number): CascadeSim {
  const rand = mulberry32(seed >>> 0 || 1);
  const scale = Math.max(0, thresholdScale);
  const theta = new Float64Array(g.n);
  for (let i = 0; i < g.n; i += 1) theta[i] = scale * rand();
  const adopted = new Uint8Array(g.n);
  const adoptedStep = new Int32Array(g.n).fill(-1);
  const series: number[] = [];
  const activeWeight = new Float64Array(g.n);
  let frontier: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < g.n && !adopted[s]) {
      adopted[s] = 1;
      adoptedStep[s] = 0;
      frontier.push(s);
    }
  }
  series.push(frontier.length);
  let stepIndex = 0;
  return {
    step() {
      if (frontier.length === 0) return 0;
      stepIndex += 1;
      const next: number[] = [];
      for (const u of frontier) {
        for (let a = g.offsets[u]!; a < g.offsets[u + 1]!; a += 1) {
          const v = g.targets[a]!;
          if (adopted[v]) continue;
          activeWeight[v]! += g.weights[a]!;
          if (activeWeight[v]! >= theta[v]! && theta[v]! >= 0) {
            adopted[v] = 1;
            adoptedStep[v] = stepIndex;
            next.push(v);
          }
        }
      }
      frontier = next;
      // Record only productive waves (see makeIndependentCascade.step).
      if (next.length > 0) series.push(adopted.reduce((acc, f) => acc + f, 0));
      return next.length;
    },
    series,
    adopted,
    adoptedStep,
    get finished() {
      return frontier.length === 0;
    },
    get total() {
      return adopted.reduce((acc, f) => acc + f, 0);
    },
  };
}

/** Run any cascade to completion (bounded by `maxSteps`). */
export function runCascadeToCompletion(sim: CascadeSim, maxSteps = 10000): number[] {
  let steps = 0;
  while (!sim.finished && steps < maxSteps) {
    sim.step();
    steps += 1;
  }
  return sim.series;
}

/** Default cascade seeds: the highest-degree node (ties to the smallest id). */
export function pickCascadeSeed(g: Graph): number {
  let best = 0;
  const deg = degreeCentrality(g);
  for (let i = 1; i < g.n; i += 1) if (deg[i]! > deg[best]!) best = i;
  return best;
}

// ---- structural holes ---------------------------------------------------------------

/**
 * Burt's network constraint (simplified neighbourhood form, Burt 1992):
 * c_ij = (p_ij + sum_k p_ik p_kj)^2 over i's neighbours, C_i = sum_j c_ij.
 * Low constraint = i spans structural holes. Isolated nodes get 0.
 */
export function burtConstraint(g: Graph): number[] {
  const n = g.n;
  const out = new Float64Array(n);
  const edges = undirectedEdges(g);
  const adj: Array<Map<number, number>> = new Array(n);
  for (let i = 0; i < n; i += 1) adj[i] = new Map();
  for (const { u, v, w } of edges) {
    adj[u]!.set(v, (adj[u]!.get(v) ?? 0) + w);
    adj[v]!.set(u, (adj[v]!.get(u) ?? 0) + w);
  }
  for (let i = 0; i < n; i += 1) {
    const s = adj[i]!.size === 0 ? 0 : Array.from(adj[i]!.values()).reduce((a, b) => a + b, 0);
    if (s <= 0) continue;
    const p = new Map<number, number>();
    for (const [j, w] of adj[i]!) p.set(j, w / s);
    let c = 0;
    for (const [j, pij] of p) {
      let inner = pij;
      for (const [k, pik] of p) {
        if (k === j) continue;
        const pkj = adj[k]!.get(j) ?? 0;
        const sk = Array.from(adj[k]!.values()).reduce((a, b) => a + b, 0);
        if (sk > 0) inner += pik * (pkj / sk);
      }
      c += inner * inner;
    }
    out[i] = c;
  }
  return Array.from(out);
}

/**
 * Brokerage score: fraction of a node's neighbour pairs that are NOT directly
 * connected (the extent to which the node spans structural holes). 0 for
 * nodes with fewer than two neighbours, 1 for a pure brokerage hub.
 */
export function brokerageScore(g: Graph): number[] {
  const n = g.n;
  const out = new Float64Array(n);
  const edges = undirectedEdges(g);
  const nbrs: Array<Set<number>> = new Array(n);
  for (let i = 0; i < n; i += 1) nbrs[i] = new Set();
  for (const { u, v } of edges) {
    nbrs[u]!.add(v);
    nbrs[v]!.add(u);
  }
  for (let i = 0; i < n; i += 1) {
    const k = nbrs[i]!.size;
    if (k < 2) continue;
    let holes = 0;
    let pairs = 0;
    const list = Array.from(nbrs[i]!);
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        pairs += 1;
        if (!nbrs[list[a]!]!.has(list[b]!)) holes += 1;
      }
    }
    out[i] = holes / pairs;
  }
  return Array.from(out);
}

/** Bridge edges: removal increases the number of connected components. */
export function findBridges(g: Graph): Array<{ u: number; v: number }> {
  const n = g.n;
  const edges = undirectedEdges(g);
  const inc: number[][] = new Array(n);
  for (let i = 0; i < n; i += 1) inc[i] = [];
  for (let e = 0; e < edges.length; e += 1) {
    inc[edges[e]!.u]!.push(e);
    inc[edges[e]!.v]!.push(e);
  }
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const bridges: Array<{ u: number; v: number }> = [];
  let timer = 0;
  for (let s = 0; s < n; s += 1) {
    if (disc[s]! >= 0) continue;
    // Iterative DFS: stack of (node, incoming edge, child-cursor).
    const nodeStack: number[] = [s];
    const edgeStack: number[] = [-1];
    const cursors: number[] = [0];
    disc[s] = timer;
    low[s] = timer;
    timer += 1;
    while (nodeStack.length > 0) {
      const v = nodeStack[nodeStack.length - 1]!;
      const cur = cursors[cursors.length - 1]!;
      if (cur < inc[v]!.length) {
        cursors[cursors.length - 1] = cur + 1;
        const e = inc[v]![cur]!;
        if (e === edgeStack[edgeStack.length - 1]) continue;
        const w = edges[e]!.u === v ? edges[e]!.v : edges[e]!.u;
        if (disc[w]! < 0) {
          disc[w] = timer;
          low[w] = timer;
          timer += 1;
          nodeStack.push(w);
          edgeStack.push(e);
          cursors.push(0);
        } else if (disc[w]! < low[v]!) {
          low[v] = disc[w]!;
        }
      } else {
        nodeStack.pop();
        edgeStack.pop();
        cursors.pop();
        const parent = nodeStack[nodeStack.length - 1];
        if (parent !== undefined) {
          if (low[v]! < low[parent]!) low[parent] = low[v]!;
          if (low[v]! > disc[parent]!) bridges.push({ u: Math.min(parent, v), v: Math.max(parent, v) });
        }
      }
    }
  }
  return bridges;
}

// ---- layout, density, verdict ----------------------------------------------------------

export interface LayoutPoint {
  x: number;
  y: number;
}

/**
 * Deterministic Fruchterman-Reingold force-directed layout: seeded initial
 * positions, fixed iteration budget, linearly cooled temperature.
 */
export function forceLayout(g: Graph, width: number, height: number, seed: number, iterations = 320): LayoutPoint[] {
  const rand = mulberry32(seed >>> 0 || 1);
  const n = g.n;
  const pts: LayoutPoint[] = new Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;
  for (let i = 0; i < n; i += 1) {
    const ang = rand() * Math.PI * 2;
    const r = radius * Math.sqrt(rand());
    pts[i] = { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
  }
  if (n === 0) return pts;
  const k = Math.sqrt((width * height) / n);
  const edges = undirectedEdges(g);
  let temp = Math.min(width, height) * 0.12;
  const cool = temp / Math.max(1, iterations);
  const disp = new Float64Array(n * 2);
  for (let it = 0; it < iterations; it += 1) {
    disp.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pts[i]!.x - pts[j]!.x;
        let dy = pts[i]!.y - pts[j]!.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) {
          dx = (rand() - 0.5) * 0.1;
          dy = (rand() - 0.5) * 0.1;
          d = Math.sqrt(dx * dx + dy * dy);
        }
        const f = (k * k) / d;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        disp[i * 2]! += ux;
        disp[i * 2 + 1]! += uy;
        disp[j * 2]! -= ux;
        disp[j * 2 + 1]! -= uy;
      }
    }
    for (const { u, v, w } of edges) {
      const dx = pts[u]!.x - pts[v]!.x;
      const dy = pts[u]!.y - pts[v]!.y;
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const f = (d * d) / k * Math.min(1, w);
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      disp[u * 2]! -= ux;
      disp[u * 2 + 1]! -= uy;
      disp[v * 2]! += ux;
      disp[v * 2 + 1]! += uy;
    }
    for (let i = 0; i < n; i += 1) {
      const dx = disp[i * 2]!;
      const dy = disp[i * 2 + 1]!;
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const cap = Math.min(d, temp);
      pts[i]!.x += (dx / d) * cap;
      pts[i]!.y += (dy / d) * cap;
      pts[i]!.x = Math.max(4, Math.min(width - 4, pts[i]!.x));
      pts[i]!.y = Math.max(4, Math.min(height - 4, pts[i]!.y));
    }
    temp = Math.max(0.5, temp - cool);
  }
  return pts;
}

/** Density: undirected 2m/(n(n-1)); directed m/(n(n-1)). */
export function graphDensity(g: Graph): number {
  const pairs = g.n * (g.n - 1);
  if (pairs <= 0) return 0;
  return g.directed ? g.edgeCount / pairs : (2 * g.edgeCount) / pairs;
}

export interface StructureVerdict {
  key: 'hub-dominated' | 'heterogeneous' | 'decentralized';
  en: string;
  zh: string;
}

/**
 * Qualitative verdict on the concentration of the chosen centrality:
 * share of the top node in the total centrality mass.
 */
export function classifyStructure(maxShare: number): StructureVerdict {
  if (maxShare >= 0.3) {
    return {
      key: 'hub-dominated',
      en: 'hub-dominated structure (top-node share >= 0.30)',
      zh: '中心节点主导（首位占比 ≥ 0.30）',
    };
  }
  if (maxShare >= 0.12) {
    return {
      key: 'heterogeneous',
      en: 'heterogeneous structure (0.12 <= share < 0.30)',
      zh: '异质结构（0.12 ≤ 占比 < 0.30）',
    };
  }
  return {
    key: 'decentralized',
    en: 'decentralized structure (top-node share < 0.12)',
    zh: '去中心化结构（首位占比 < 0.12）',
  };
}

// ---- data import (networkGraph-compatible formats) ---------------------------------------

export interface ParsedNetwork {
  /** Node labels in first-appearance order (index = node id). */
  labels: string[];
  edges: RawEdge[];
}

/**
 * Parse an edge list in either format:
 *   - CSV/whitespace text: `source,target[,weight]` per line, optional header;
 *   - JSON: `{ nodes: [{id}], edges|links: [{source, target, weight?}] }`.
 * This matches the Network Graph plugin's data conventions.
 */
export function parseEdgeList(text: string, maxNodes = 500): ParsedNetwork {
  const trimmed = text.trim();
  const labels: string[] = [];
  const idOf = new Map<string, number>();
  const intern = (raw: unknown): number => {
    const s = String(raw ?? '').trim();
    if (!s) return -1;
    let id = idOf.get(s);
    if (id === undefined) {
      if (labels.length >= maxNodes) return -1;
      id = labels.length;
      labels.push(s);
      idOf.set(s, id);
    }
    return id;
  };
  const edges: RawEdge[] = [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const rawNodes = (obj.nodes ?? obj.vertices ?? []) as Array<Record<string, unknown>>;
      for (const nd of rawNodes) intern(nd.id ?? nd.name ?? nd.label);
      const rawLinks = (obj.edges ?? obj.links ?? []) as Array<Record<string, unknown>>;
      for (const l of rawLinks) {
        const u = intern(l.source ?? l.from);
        const v = intern(l.target ?? l.to);
        if (u < 0 || v < 0) continue;
        const w = Number(l.weight ?? l.value ?? 1);
        edges.push({ source: u, target: v, weight: Number.isFinite(w) && w > 0 ? w : 1 });
      }
      return { labels, edges };
    } catch {
      // Fall through to CSV parsing.
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = (t.includes(',') ? t.split(',') : t.split(/\s+/)).map((p) => p.trim());
    if (parts.length < 2) continue;
    if (/^(source|from|node1)$/i.test(parts[0]!) && /^(target|to|node2)$/i.test(parts[1]!)) continue;
    const u = intern(parts[0]);
    const v = intern(parts[1]);
    if (u < 0 || v < 0) continue;
    const parsed = Number.parseFloat(parts[2] ?? '');
    const w = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    edges.push({ source: u, target: v, weight: w });
  }
  return { labels, edges };
}

// ---- embedded validation benchmark --------------------------------------------------------

/**
 * Fixed reference graph with hand-computed betweenness (unordered-pair
 * convention). Edges: 0-1, 0-2, 1-2, 1-3, 2-3, 3-4, 4-5.
 *   b(0) = 0, b(1) = 1.5, b(2) = 1.5, b(3) = 6, b(4) = 4, b(5) = 0.
 */
export const SNA_KNOWN_GRAPH = {
  n: 6,
  edges: [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [4, 5],
  ] as ReadonlyArray<readonly [number, number]>,
  betweenness: [0, 1.5, 1.5, 6, 4, 0] as const,
} as const;

export interface SnaBenchmark {
  /** Star K1,7: hub betweenness = 15, every leaf 0. */
  starBetweenness: boolean;
  /** Path P5 closeness: centre 2/3, end 0.4, second node 4/7. */
  pathCloseness: boolean;
  /** Max |betweenness - hand reference| over SNA_KNOWN_GRAPH (criterion: 0). */
  knownBetweennessErr: number;
  /** Brandes matches an independent explicit-path-enumeration count. */
  brandesMatchesBruteForce: boolean;
  /** PageRank sums to 1 on the reference graph (criterion: |err| < 1e-9). */
  pagerankSumsTo1: boolean;
  /** Louvain recovers the 2-block planted partition. */
  louvainPlantedRecovery: boolean;
  /** Cascade reachability bounds (p=0 stays, p=1 floods, monotone series). */
  cascadeBounds: boolean;
  /** Same-seed reruns reproduce every kernel output exactly. */
  deterministic: boolean;
  pass: boolean;
}

/** Fraction of nodes whose community label agrees with the ground truth. */
function partitionAgreement(recovered: ArrayLike<number>, truth: ArrayLike<number>): number {
  const tally = new Map<number, Map<number, number>>();
  for (let i = 0; i < recovered.length; i += 1) {
    const a = recovered[i]!;
    const b = truth[i]!;
    if (!tally.has(a)) tally.set(a, new Map());
    const inner = tally.get(a)!;
    inner.set(b, (inner.get(b) ?? 0) + 1);
  }
  let agree = 0;
  for (const inner of tally.values()) {
    let max = 0;
    for (const c of inner.values()) max = Math.max(max, c);
    agree += max;
  }
  return agree / recovered.length;
}

/**
 * Independent betweenness check: explicitly enumerates every shortest path
 * between every pair (backward DFS over the BFS DAG) — a different code path
 * from Brandes' dependency accumulation. Unordered-pair convention.
 */
function bruteForceBetweenness(n: number, edges: ReadonlyArray<readonly [number, number]>): number[] {
  const adj: number[][] = new Array(n);
  for (let i = 0; i < n; i += 1) adj[i] = [];
  for (const [u, v] of edges) {
    adj[u]!.push(v);
    adj[v]!.push(u);
  }
  const bc = new Float64Array(n);
  const dist = new Int32Array(n);
  for (let s = 0; s < n; s += 1) {
    dist.fill(-1);
    dist[s] = 0;
    const queue = [s];
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head]!;
      for (const w of adj[v]!) {
        if (dist[w]! < 0) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
      }
    }
    for (let t = 0; t < n; t += 1) {
      if (t === s || dist[t]! < 0) continue;
      let total = 0;
      const through = new Float64Array(n);
      const onPath: number[] = [t];
      const walk = (v: number): void => {
        if (v === s) {
          total += 1;
          for (const x of onPath) through[x]! += 1;
          return;
        }
        for (const w of adj[v]!) {
          if (dist[w] !== dist[v]! - 1) continue;
          onPath.push(w);
          walk(w);
          onPath.pop();
        }
      };
      walk(t);
      if (total === 0) continue;
      for (let v = 0; v < n; v += 1) {
        if (v === s || v === t) continue;
        bc[v]! += through[v]! / total;
      }
    }
  }
  // Ordered pairs were enumerated; undirected convention counts each once.
  for (let v = 0; v < n; v += 1) bc[v]! /= 2;
  return Array.from(bc);
}

/**
 * Run the embedded SNA validation battery: hand-computed centralities
 * (star betweenness, path closeness, reference-graph betweenness), an
 * independent brute-force betweenness cross-check, PageRank normalisation,
 * planted-partition Louvain recovery, cascade reachability bounds and
 * same-seed determinism.
 */
export function runSnaBenchmark(): SnaBenchmark {
  // (1) star betweenness: hub = C(n-1, 2), leaves 0.
  let starBetweenness = false;
  {
    const g = buildGraph(7, starGraph(7), false);
    const bc = betweennessCentrality(g);
    starBetweenness = Math.abs(bc[0]! - 15) < 1e-9 && bc.slice(1).every((v) => Math.abs(v) < 1e-9);
  }

  // (2) path closeness: exact values on P5.
  let pathCloseness = false;
  {
    const g = buildGraph(5, pathGraph(5), false);
    const cc = closenessCentrality(g);
    pathCloseness =
      Math.abs(cc[2]! - 2 / 3) < 1e-9 && Math.abs(cc[0]! - 0.4) < 1e-9 && Math.abs(cc[1]! - 4 / 7) < 1e-9;
  }

  // (3) hand-computed reference betweenness + brute-force cross-check.
  let knownBetweennessErr = 0;
  let brandesMatchesBruteForce = false;
  {
    const refEdges = SNA_KNOWN_GRAPH.edges.map(([u, v]) => ({ source: u, target: v, weight: 1 }));
    const g = buildGraph(SNA_KNOWN_GRAPH.n, refEdges, false);
    const bc = betweennessCentrality(g);
    for (let i = 0; i < SNA_KNOWN_GRAPH.n; i += 1) {
      knownBetweennessErr = Math.max(knownBetweennessErr, Math.abs(bc[i]! - SNA_KNOWN_GRAPH.betweenness[i]!));
    }
    const brute = bruteForceBetweenness(SNA_KNOWN_GRAPH.n, SNA_KNOWN_GRAPH.edges);
    brandesMatchesBruteForce = bc.every((v, i) => Math.abs(v - brute[i]!) < 1e-9);
  }

  // (4) PageRank normalisation.
  let pagerankSumsTo1 = false;
  {
    const refEdges = SNA_KNOWN_GRAPH.edges.map(([u, v]) => ({ source: u, target: v, weight: 1 }));
    const g = buildGraph(SNA_KNOWN_GRAPH.n, refEdges, false);
    const pr = pagerankCentrality(g);
    const sum = pr.reduce((a, b) => a + b, 0);
    pagerankSumsTo1 = Math.abs(sum - 1) < 1e-9;
  }

  // (5) Louvain planted-partition recovery (2 blocks of 8).
  let louvainPlantedRecovery = false;
  {
    const n = 16;
    const g = buildGraph(n, plantedPartitionGraph(n), false);
    const res = louvainCommunities(g, 11);
    const truth = Int32Array.from({ length: n }, (_, i) => (i < 8 ? 0 : 1));
    const agreement = partitionAgreement(res.communityOf, truth);
    const qGround = modularity(g, truth);
    louvainPlantedRecovery = agreement >= 0.875 && res.modularity >= qGround - 1e-9;
  }

  // (6) cascade reachability bounds.
  let cascadeBounds = false;
  {
    const g = buildGraph(SNA_KNOWN_GRAPH.n, SNA_KNOWN_GRAPH.edges.map(([u, v]) => ({ source: u, target: v, weight: 1 })), false);
    const p0 = runCascadeToCompletion(makeIndependentCascade(g, [0], 0, 42));
    const p1 = runCascadeToCompletion(makeIndependentCascade(g, [0], 1, 42));
    const mid = runCascadeToCompletion(makeIndependentCascade(g, [0], 0.4, 42));
    const ltEasy = runCascadeToCompletion(makeLinearThreshold(g, [0], 0.001, 42));
    const monotone = (s: number[]): boolean => s.every((v, i) => i === 0 || v >= s[i - 1]!);
    cascadeBounds =
      p0.length === 1 && p0[0] === 1 &&
      p1[p1.length - 1] === 6 &&
      mid.every((v) => v >= 1 && v <= 6) &&
      ltEasy[ltEasy.length - 1] === 6 &&
      monotone(p0) && monotone(p1) && monotone(mid) && monotone(ltEasy);
  }

  // (7) determinism: identical seeds reproduce every kernel output exactly.
  let deterministic = true;
  {
    const n = 20;
    const mk = (): Graph => buildGraph(n, randomGraph(n, 3, mulberry32(20260922)), false);
    const a = mk();
    const b = mk();
    deterministic = deterministic && a.m === b.m;
    const layoutA = forceLayout(a, 400, 300, 7);
    const layoutB = forceLayout(b, 400, 300, 7);
    deterministic = deterministic && layoutA.every((p, i) => p.x === layoutB[i]!.x && p.y === layoutB[i]!.y);
    const louvA = louvainCommunities(a, 5);
    const louvB = louvainCommunities(b, 5);
    deterministic = deterministic && Array.from(louvA.communityOf).every((v, i) => v === louvB.communityOf[i]);
    const lpaA = Array.from(labelPropagation(a, 5));
    const lpaB = Array.from(labelPropagation(b, 5));
    deterministic = deterministic && lpaA.every((v, i) => v === lpaB[i]);
    const icA = runCascadeToCompletion(makeIndependentCascade(a, [0], 0.3, 9));
    const icB = runCascadeToCompletion(makeIndependentCascade(b, [0], 0.3, 9));
    deterministic = deterministic && icA.length === icB.length && icA.every((v, i) => v === icB[i]);
    const ltA = runCascadeToCompletion(makeLinearThreshold(a, [0], 0.5, 9));
    const ltB = runCascadeToCompletion(makeLinearThreshold(b, [0], 0.5, 9));
    deterministic = deterministic && ltA.length === ltB.length && ltA.every((v, i) => v === ltB[i]);
  }

  return {
    starBetweenness,
    pathCloseness,
    knownBetweennessErr,
    brandesMatchesBruteForce,
    pagerankSumsTo1,
    louvainPlantedRecovery,
    cascadeBounds,
    deterministic,
    pass:
      starBetweenness &&
      pathCloseness &&
      knownBetweennessErr === 0 &&
      brandesMatchesBruteForce &&
      pagerankSumsTo1 &&
      louvainPlantedRecovery &&
      cascadeBounds &&
      deterministic,
  };
}
