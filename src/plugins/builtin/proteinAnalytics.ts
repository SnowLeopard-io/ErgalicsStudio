// ==========================================================================
// proteinAnalytics — systems-biology metrics for protein interaction networks
//
// Pure TypeScript kernels (no canvas / DOM) so they unit-test in isolation:
//  1. Louvain community detection — greedy modularity maximisation with graph
//     aggregation, deterministic (tie-breaking by index order). Reports the
//     community assignment per node plus the final modularity Q.
//  2. Hub-protein ranking — weighted degree centrality; a node is a "hub"
//     when its degree exceeds μ + 2σ of the weighted degree distribution
//     (a common PPI threshold), reported along with degree-z scores.
//  3. Network descriptors — local clustering coefficient, degree assortativity
//     (Pearson r over edges), connected-component size distribution.
// All functions take an identical shape of nodes + weighted edges (indices)
// so they drop cleanly into the protein plugin's working set.
// ==========================================================================

export interface WNode {
  id: string;
  name: string;
}

export interface WEdge {
  a: number; // index into nodes
  b: number;
  weight: number;
}

export interface NetworkMetrics {
  n: number;
  m: number; // total edge weight
  meanDegree: number;
  maxDegree: number;
  hubs: HubInfo[];
  /** local clustering coefficient (unweighted) per node, indexed by id. */
  clustering: number[];
  meanClustering: number;
  /** Pearson degree assortativity in [-1, 1]. */
  assortativity: number;
  /** connected components (union-find) and the largest component size. */
  components: number;
  maxComponent: number;
  /** top modularity partition. */
  community: number[];
  numCommunities: number;
  modularity: number;
  /** size of each community (by id), for the module-size palette legend. */
  communities: { id: number; count: number }[];
}

export interface HubInfo {
  id: string;
  name: string;
  degree: number;
  z: number; // z-score of degree within the distribution
}

// ---------------------------------------------------------------- adjacency

/** Aggregated undirected weighted adjacency: adj[i] = [{ j, w }], duplicate
 *  edges summed (self-loops dropped). Also returns the total weight m. */
export function buildAdjacency(
  n: number,
  edges: WEdge[],
): { adj: Array<{ j: number; w: number }[]>; m: number } {
  const mat = new Array<Map<number, number>>(n);
  for (let i = 0; i < n; i += 1) mat[i] = new Map();
  let m = 0;
  for (const e of edges) {
    if (e.a === e.b || e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    const w = e.weight > 0 ? e.weight : 1;
    mat[e.a]!.set(e.b, (mat[e.a]!.get(e.b) ?? 0) + w);
    mat[e.b]!.set(e.a, (mat[e.b]!.get(e.a) ?? 0) + w);
    m += w;
  }
  const adj = mat.map((map) => Array.from(map, ([j, w]) => ({ j, w })));
  return { adj, m };
}

// ----------------------------------------------------------------- Louvain

/**
 * Deterministic Louvain community detection. Each local-move pass isolates a
 * node, scores every neighbouring community by the Blondel et al. modularity
 * gain, and moves it where the gain is positive and maximal. When a pass stops
 * improving, the graph is aggregated to its communities and the process repeats
 * until modularity plateaus (or `maxPasses`). Returns a community id per node
 * (renumbered 0..k-1) and the final modularity Q on the ORIGINAL graph.
 *
 * Modularity is always graded on the original graph, so the best partition is
 * tracked in original-node space even across aggregation passes (the coarsened
 * graph's identity partition carries the original modularity by construction).
 */
export function louvain(n: number, edges: WEdge[], maxPasses = 32): { community: number[]; q: number } {
  if (n === 0) return { community: [], q: 0 };
  const { adj, m } = buildAdjacency(n, edges);
  if (m <= 0) return { community: Array.from({ length: n }, (_, i) => i), q: 0 };
  const origN = n;
  const origEdges = edges;
  const m2 = 2 * m;

  // Weighted degree per node.
  const k = adj.map((nb) => nb.reduce((s, { w }) => s + w, 0));

  // Current (possibly coarsened) graph + its community state.
  let curN = n;
  let curEdges = edges;
  let curAdj = adj;
  let curK = k;
  let community = Array.from({ length: n }, (_, i) => i);
  let sumTot = k.slice();
  // Original node i currently lives in coarse node origToNode[i].
  let origToNode = Array.from({ length: origN }, (_, i) => i);

  let bestQ = modularityOf(origN, origEdges, Array.from({ length: origN }, (_, i) => i));
  let bestPartition = Array.from({ length: origN }, (_, i) => i);
  let improved = true;

  for (let pass = 0; pass < maxPasses && improved; pass += 1) {
    improved = false;
    // ---- local-move phase on the current graph ----
    const nbr = curAdj;
    for (let i = 0; i < curN; i += 1) {
      const ki = curK[i] ?? 0;
      const curCom = community[i] as number;
      // Drop i from its community (isolate it).
      sumTot[curCom] = (sumTot[curCom] ?? 0) - ki;
      community[i] = -1;

      let bestGain = 0;
      let bestCom = curCom;
      // Aggregate k_i,in per distinct neighbouring community in one sweep.
      const neighCom = new Map<number, number>();
      for (const { j, w } of nbr[i] ?? []) {
        if (j === i) continue;
        const c = community[j];
        if (c === -1 || c === undefined) continue;
        neighCom.set(c, (neighCom.get(c) ?? 0) + w);
      }
      for (const [c, kIn] of neighCom) {
        const st = sumTot[c] ?? 0;
        const gain = kIn / m - (st * ki) / (m2 * m);
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          bestCom = c;
        }
      }

      community[i] = bestCom;
      sumTot[bestCom] = (sumTot[bestCom] ?? 0) + ki;
      if (bestCom !== curCom) improved = true;
    }

    // Grade the composed partition on the ORIGINAL graph.
    const composed = new Array<number>(origN);
    for (let i = 0; i < origN; i += 1) composed[i] = community[origToNode[i] as number] as number;
    const q = modularityOf(origN, origEdges, composed);
    if (q > bestQ + 1e-12) {
      bestQ = q;
      bestPartition = composed;
    }

    // ---- aggregate phase ----
    const cmap = new Map<number, number>();
    const superOf = new Array(curN);
    let nextId = 0;
    for (let i = 0; i < curN; i += 1) {
      const c = community[i] as number;
      let s = cmap.get(c);
      if (s === undefined) {
        s = nextId;
        cmap.set(c, s);
        nextId += 1;
      }
      superOf[i] = s;
    }
    if (nextId === curN) break; // no coarser partition → converged.

    // Map original nodes into the new coarse graph.
    for (let i = 0; i < origN; i += 1) {
      origToNode[i] = superOf[origToNode[i] as number] as number;
    }

    // Rebuild weighted edges between super-nodes (self-loops reveal density).
    const emap = new Map<string, number>();
    const addE = (a: number, b: number, w: number) => {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo}@${hi}`;
      emap.set(key, (emap.get(key) ?? 0) + w);
    };
    for (const e of curEdges) {
      const ca = superOf[e.a] as number;
      const cb = superOf[e.b] as number;
      addE(ca, cb, e.weight);
    }
    const newEdges: WEdge[] = [];
    for (const [key, w] of emap) {
      const [aa, bb] = key.split('@').map(Number) as [number, number];
      newEdges.push({ a: aa, b: bb, weight: w });
    }

    // Rebuild weighted degrees for the coarsened graph (self-loop counts once
    // per endpoint via the adjacency, which matches degree semantics).
    const { adj: newAdj } = buildAdjacency(nextId, newEdges);
    const newK = new Array(nextId).fill(0);
    for (let i = 0; i < nextId; i += 1) {
      newK[i] = (newAdj[i] ?? []).reduce((s, { w }) => s + w, 0);
    }

    curN = nextId;
    curEdges = newEdges;
    curAdj = newAdj;
    curK = newK;
    community = Array.from({ length: curN }, (_, i) => i);
    sumTot = newK.slice();
  }

  // Renumber the best original partition into 0..k-1 by first appearance.
  const relabel = new Map<number, number>();
  const out: number[] = [];
  let next = 0;
  for (const c of bestPartition) {
    let r = relabel.get(c);
    if (r === undefined) {
      r = next;
      relabel.set(c, r);
      next += 1;
    }
    out.push(r);
  }
  return { community: out, q: bestQ };
}

/**
 * Correct Newman modularity Q = Σ_C [ L_C/m − (d_C/(2m))² ], evaluated on the
 * given graph (self-loops are already excluded downstream for this plugin's
 * inputs, which never contain them). L_C = internal edge weight of C (each
 * undirected edge counted once), d_C = sum of weighted degrees in C.
 */
function modularityOf(n: number, edges: WEdge[], community: number[]): number {
  const { m } = buildAdjacency(n, edges);
  if (m <= 0) return 0;
  const m2 = 2 * m;
  const d = new Map<number, number>();
  const add = (c: number, v: number) => d.set(c, (d.get(c) ?? 0) + v);
  let internalWeight = 0;
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    const ca = community[e.a]!;
    const cb = community[e.b]!;
    add(ca, e.weight);
    add(cb, e.weight);
    if (ca === cb) internalWeight += e.weight;
  }
  let q = internalWeight / m;
  for (const dc of d.values()) q -= (dc * dc) / (m2 * m2);
  return q;
}

// ------------------------------------------------------------------- hubs

/** Hub ranking: nodes with degree z ≥ 2 (i.e. degree > μ + 2σ) are hubs;
 *  falls back to the top-5 by degree for very heavy-tailed networks. */
export function assignHubs(n: number, edges: WEdge[], nodes: WNode[]): HubInfo[] {
  const deg = new Array<number>(n).fill(0);
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    deg[e.a] = (deg[e.a] ?? 0) + (e.weight > 0 ? e.weight : 1);
    deg[e.b] = (deg[e.b] ?? 0) + (e.weight > 0 ? e.weight : 1);
  }
  const mean = deg.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let varSum = 0;
  for (const d of deg) varSum += (d - mean) * (d - mean);
  const sigma = Math.sqrt(varSum / Math.max(1, n)) || 1;
  const ranked = deg
    .map((d, i) => ({ i, d, z: (d - mean) / sigma }))
    .sort((a, b) => b.d - a.d);
  const hubs = ranked.filter((r) => r.z >= 2);
  const chosen = hubs.length > 0 ? hubs : ranked.slice(0, 5);
  return chosen.map(({ i, d, z }) => ({
    id: nodes[i]?.id ?? String(i),
    name: nodes[i]?.name ?? String(i),
    degree: d,
    z,
  }));
}

// ------------------------------------------------------------ local metrics

/** Unweighted local clustering coefficient per node; NaN-combined to mean. */
export function clusteringCoefficients(n: number, edges: WEdge[]): number[] {
  const nbr = new Array<Set<number>>(n);
  for (let i = 0; i < n; i += 1) nbr[i] = new Set();
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n || e.a === e.b) continue;
    nbr[e.a]!.add(e.b);
    nbr[e.b]!.add(e.a);
  }
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const nb = nbr[i] ?? new Set<number>();
    const d = nb.size;
    if (d < 2) {
      out[i] = 0;
      continue;
    }
    const arr = Array.from(nb);
    let links = 0;
    for (let x = 0; x < arr.length; x += 1) {
      const nx = nbr[arr[x] as number]!;
      for (let y = x + 1; y < arr.length; y += 1) {
        if (nx.has(arr[y] as number)) links += 1;
      }
    }
    out[i] = (2 * links) / (d * (d - 1));
  }
  return out;
}

/** Pearson degree assortativity (Newman, 2002) over the edges. */
export function degreeAssortativity(n: number, edges: WEdge[]): number {
  const deg = new Array<number>(n).fill(0);
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    deg[e.a] = (deg[e.a] ?? 0) + 1;
    deg[e.b] = (deg[e.b] ?? 0) + 1;
  }
  let num = 0;
  let denom = 0;
  let dbar = 0;
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    dbar += deg[e.a]! + deg[e.b]!;
  }
  const M = edges.length;
  if (M === 0) return 0;
  dbar /= 2 * M;
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    num += (deg[e.a]! - dbar) * (deg[e.b]! - dbar);
    denom += 0.5 * ((deg[e.a]! - dbar) ** 2 + (deg[e.b]! - dbar) ** 2);
  }
  return denom > 0 ? num / denom : 0;
}

// ---------------------------------------------------------- full analysis

/** One-call analysis over the (possibly resampled) working network. */
export function analyzeNetwork(nodes: WNode[], edges: WEdge[]): NetworkMetrics {
  const n = nodes.length;
  const total = buildAdjacency(n, edges).m;
  const degrees = assignDegrees(n, edges);
  const meanDegree = degrees.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const maxDegree = degrees.length ? Math.max(...degrees) : 0;
  const hubs = assignHubs(n, edges, nodes);
  const clustering = clusteringCoefficients(n, edges);
  const meanClustering = clustering.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const assortativity = degreeAssortativity(n, edges);
  const comp = components(n, edges);
  const { community, q } = louvain(n, edges);
  const numCommunities = community.length ? Math.max(...community) + 1 : 0;
  const counts = new Map<number, number>();
  for (const c of community) counts.set(c, (counts.get(c) ?? 0) + 1);
  const communities = Array.from(counts, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  return {
    n,
    m: total,
    meanDegree,
    maxDegree,
    hubs,
    clustering,
    meanClustering,
    assortativity,
    components: comp.components,
    maxComponent: comp.maxComponent,
    community,
    numCommunities,
    modularity: q,
    communities,
  };
}

export function assignDegrees(n: number, edges: WEdge[]): number[] {
  const deg = new Array<number>(n).fill(0);
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n || e.a === e.b) continue;
    deg[e.a] = (deg[e.a] ?? 0) + 1;
    deg[e.b] = (deg[e.b] ?? 0) + 1;
  }
  return deg;
}

/** Union-find connected components. */
export function components(
  n: number,
  edges: WEdge[],
): { components: number; maxComponent: number } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x] as number] as number;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const e of edges) {
    if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
    union(e.a, e.b);
  }
  const comps = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    comps.set(r, (comps.get(r) ?? 0) + 1);
  }
  let max = 0;
  for (const v of comps.values()) max = Math.max(max, v);
  return { components: comps.size, maxComponent: max };
}