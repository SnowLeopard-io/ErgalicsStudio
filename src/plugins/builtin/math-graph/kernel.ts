// ==========================================================================
// math-graph — graph theory kernel (pure, dependency-free, testable)
//
// Adjacency-matrix / edge-list parsing, a deterministic seeded graph layout,
// shortest paths (Dijkstra, Bellman-Ford, Floyd-Warshall), minimum spanning
// trees (Prim, Kruskal), maximum flow (Ford-Fulkerson and Edmonds-Karp with
// the residual minimum cut), greedy coloring, bipartite maximum matching with
// the König vertex cover, and Euler / Hamiltonian trail detection.
//
// Every algorithm is a pure function and optionally records an explicit
// step list (`GraphStep[]`) that drives the step-by-step animation in the
// UI. Built-in sample graphs (weighted directed and undirected) and the
// embedded validation suite live here as well, so the kernel unit-tests
// without a canvas or DOM. The unified error metric throughout is
// |computed − analytic|/|analytic|.
// ==========================================================================

// ---- graph model ---------------------------------------------------------------

/** One weighted edge; `w` doubles as the capacity in flow algorithms. */
export interface GraphEdge {
  u: number;
  v: number;
  w: number;
}

export interface Graph {
  /** Number of nodes (indices 0 … n−1). */
  n: number;
  directed: boolean;
  /** One display label per node index. */
  labels: string[];
  edges: GraphEdge[];
}

/** One directed adjacency entry together with the owning edge index. */
export interface AdjEntry {
  to: number;
  weight: number;
  edge: number;
}

/**
 * Directed adjacency: every edge contributes `u → v`; an undirected edge
 * additionally contributes `v → u` (both share the same edge index).
 */
export function adjacency(g: Graph): AdjEntry[][] {
  const nb: AdjEntry[][] = Array.from({ length: g.n }, () => []);
  g.edges.forEach((e, idx) => {
    nb[e.u]!.push({ to: e.v, weight: e.w, edge: idx });
    if (!g.directed && e.v !== e.u) nb[e.v]!.push({ to: e.u, weight: e.w, edge: idx });
  });
  return nb;
}

/** Underlying undirected incidence: both endpoints of every edge, no duplicates for undirected input. */
function underlying(g: Graph): AdjEntry[][] {
  if (!g.directed) return adjacency(g);
  const nb: AdjEntry[][] = Array.from({ length: g.n }, () => []);
  g.edges.forEach((e, idx) => {
    nb[e.u]!.push({ to: e.v, weight: e.w, edge: idx });
    if (e.v !== e.u) nb[e.v]!.push({ to: e.u, weight: e.w, edge: idx });
  });
  return nb;
}

function clampIndex(v: number, n: number): number {
  if (!Number.isFinite(v)) return 0;
  const i = Math.floor(v);
  if (n <= 0) return 0;
  return Math.min(Math.max(0, i), n - 1);
}

/** Compact number rendering for step descriptions and node overlays. */
function fmtNum(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v < 0 ? '−∞' : '∞';
  return String(Number(v.toPrecision(6)));
}

/** Edge key that ignores orientation (undirected highlight matching). */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// ---- step records ---------------------------------------------------------------

export type GraphAlgorithm =
  | 'dijkstra'
  | 'bellman-ford'
  | 'floyd-warshall'
  | 'prim'
  | 'kruskal'
  | 'ford-fulkerson'
  | 'edmonds-karp'
  | 'coloring'
  | 'matching'
  | 'euler'
  | 'hamilton';

/**
 * One animation frame of an algorithm: a bilingual description plus the
 * nodes / edges to highlight and optional per-node overlays (distances,
 * colour ids, match partners, …). Empty strings hide an overlay.
 */
export interface GraphStep {
  descEn: string;
  descZh: string;
  nodes: number[];
  /** Highlighted node pairs (either orientation). */
  edges: Array<[number, number]>;
  labels?: string[];
  final?: boolean;
}

export type StepSink = (step: GraphStep) => void;

/** Upper bound on recorded steps per run (searches stay bounded). */
const MAX_STEPS = 400;

/** Wrap an optional sink so runaway algorithms stop recording after MAX_STEPS. */
function sink(onStep?: StepSink): StepSink {
  let count = 0;
  return (step) => {
    if (!onStep || count >= MAX_STEPS) return;
    count += 1;
    onStep(step);
  };
}

// ---- deterministic seeded layout ---------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutPoint {
  x: number;
  y: number;
}

/**
 * Fruchterman-Reingold style force layout with a fixed RNG seed: circular
 * start plus seeded jitter, a fixed number of repulsion / attraction
 * iterations with linear cooling, then clamping into the box. The output is
 * fully deterministic for a given graph and box, so redraws never jitter.
 */
export function layoutGraph(g: Graph, width: number, height: number, iterations = 300): LayoutPoint[] {
  const n = g.n;
  if (n <= 0) return [];
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) return [{ x: cx, y: cy }];
  const rng = mulberry32(0x9e3779b9);
  const radius = Math.max(1, Math.min(width, height) * 0.33);
  const pts: LayoutPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n + (rng() - 0.5) * 0.25;
    const r = radius * (0.8 + 0.35 * rng());
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }

  const ideal = Math.sqrt((width * height) / n);
  let temp = Math.min(width, height) / 8;
  const disp: LayoutPoint[] = pts.map(() => ({ x: 0, y: 0 }));
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < n; i += 1) {
      disp[i]!.x = 0;
      disp[i]!.y = 0;
    }
    // pairwise repulsion
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pts[i]!.x - pts[j]!.x;
        let dy = pts[i]!.y - pts[j]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-9) {
          // coincident points are broken deterministically (sign by index order)
          dx = i < j ? 1e-3 : -1e-3;
          dy = 1e-3;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (ideal * ideal) / d2;
        disp[i]!.x += (dx / d) * f;
        disp[i]!.y += (dy / d) * f;
        disp[j]!.x -= (dx / d) * f;
        disp[j]!.y -= (dy / d) * f;
      }
    }
    // attraction along edges (underlying undirected structure for digraphs)
    for (const e of g.edges) {
      if (e.u === e.v) continue;
      const dx = pts[e.u]!.x - pts[e.v]!.x;
      const dy = pts[e.u]!.y - pts[e.v]!.y;
      const d = Math.max(1e-6, Math.hypot(dx, dy));
      const f = (d * d) / ideal;
      disp[e.u]!.x -= (dx / d) * f;
      disp[e.u]!.y -= (dy / d) * f;
      disp[e.v]!.x += (dx / d) * f;
      disp[e.v]!.y += (dy / d) * f;
    }
    // apply displacement limited by the cooling temperature
    for (let i = 0; i < n; i += 1) {
      const dx = disp[i]!.x;
      const dy = disp[i]!.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;
      const scale = Math.min(len, temp) / len;
      pts[i]!.x += dx * scale;
      pts[i]!.y += dy * scale;
    }
    temp = Math.max(1, temp * 0.96);
  }

  // clamp into the box (room for the node disc and its overlay label)
  const pad = Math.max(4, Math.min(30, Math.min(width, height) / 8));
  for (const p of pts) {
    p.x = Math.min(Math.max(pad, p.x), Math.max(pad, width - pad));
    p.y = Math.min(Math.max(pad, p.y), Math.max(pad, height - pad));
  }
  return pts;
}

// ---- input parsing ----------------------------------------------------------------

export type ParseFormat = 'matrix' | 'edges';

export type ParseResult = { ok: true; graph: Graph } | { ok: false; error: string };

/**
 * Parse graph text in either format. Rows / entries are separated by a
 * newline or ';' so the text fits a single-line editor field. Segments that
 * start with '#' are directives or comments:
 *   `# directed` / `# undirected` — orientation (arrows imply directed),
 *   `# labels a b c` — node labels for the matrix format.
 *
 * Matrix: square, `0` (or an empty cell) means "no edge", non-zero entries
 * are weights; undirected matrices read the lower triangle. Edge list:
 * `u v [w]` or `u -> v [w]`, node names are free-form labels.
 */
export function parseGraph(text: string, format: ParseFormat): ParseResult {
  const segments = text
    .split(/[;\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let dirDirective: boolean | null = null;
  let labelDirective: string[] | null = null;
  let sawArrow = false;
  const data: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith('#')) {
      const body = seg.slice(1).trim();
      const low = body.toLowerCase();
      if (low === 'directed') dirDirective = true;
      else if (low === 'undirected') dirDirective = false;
      else if (low.startsWith('labels')) {
        labelDirective = body.slice(6).split(/[\s,]+/).filter((s) => s.length > 0);
      }
      continue; // any other '#' segment is a comment
    }
    if (/->|→/.test(seg)) sawArrow = true;
    data.push(seg);
  }
  if (data.length === 0) return { ok: false, error: 'no graph data found (only comments)' };
  const directed = dirDirective ?? sawArrow;
  return format === 'matrix' ? parseMatrix(data, directed, labelDirective) : parseEdges(data, directed);
}

function parseMatrix(rows: string[], directed: boolean, labelDirective: string[] | null): ParseResult {
  const n = rows.length;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const cells = rows[i]!.split(/[\s,]+/).filter((c) => c.length > 0);
    if (cells.length !== n) return { ok: false, error: `row ${i + 1} has ${cells.length} entries, expected ${n}` };
    const row: number[] = [];
    for (const c of cells) {
      const v = Number(c);
      if (!Number.isFinite(v)) return { ok: false, error: `row ${i + 1}: '${c}' is not a number` };
      row.push(v);
    }
    matrix.push(row);
  }
  let labels: string[];
  if (labelDirective) {
    if (labelDirective.length !== n) {
      return { ok: false, error: `# labels has ${labelDirective.length} names, expected ${n}` };
    }
    const dup = labelDirective.find((l, i) => labelDirective!.indexOf(l) !== i);
    if (dup) return { ok: false, error: `duplicate node label '${dup}'` };
    labels = labelDirective;
  } else {
    labels = Array.from({ length: n }, (_, i) => String(i));
  }
  const edges: GraphEdge[] = [];
  if (directed) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue; // self loops are ignored in the matrix diagonal
        const w = matrix[i]![j]!;
        if (w !== 0) edges.push({ u: i, v: j, w });
      }
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const w = matrix[i]![j] !== 0 ? matrix[i]![j]! : matrix[j]![i]!;
        if (w !== 0) edges.push({ u: i, v: j, w });
      }
    }
  }
  return { ok: true, graph: { n, directed, labels, edges } };
}

function parseEdges(rows: string[], directed: boolean): ParseResult {
  const labels: string[] = [];
  const edges: GraphEdge[] = [];
  for (let k = 0; k < rows.length; k += 1) {
    const seg = rows[k]!;
    const body = seg.replace(/->|→/g, ' ');
    const tokens = body.split(/[\s,;:]+/).filter((t) => t.length > 0);
    if (tokens.length < 2) return { ok: false, error: `entry ${k + 1}: '${seg}' needs at least two node names` };
    if (tokens.length > 3) return { ok: false, error: `entry ${k + 1}: '${seg}' has too many fields` };
    const [us, vs, ws] = tokens as [string, string, string?];
    if (us === vs) return { ok: false, error: `entry ${k + 1}: self loop on '${us}' is not supported` };
    let w = 1;
    if (ws !== undefined) {
      w = Number(ws);
      if (!Number.isFinite(w)) return { ok: false, error: `entry ${k + 1}: '${ws}' is not a valid weight` };
    }
    for (const name of [us, vs]) if (!labels.includes(name)) labels.push(name);
    edges.push({ u: labels.indexOf(us), v: labels.indexOf(vs), w });
  }
  if (labels.length === 0) return { ok: false, error: 'no graph data found' };
  return { ok: true, graph: { n: labels.length, directed, labels, edges } };
}

/**
 * Serialize a graph back into editable single-line input text (round-trips
 * through `parseGraph`). Directed graphs carry the `# directed` directive;
 * the matrix form also emits `# labels …` so node names survive.
 */
export function serializeGraph(g: Graph, format: ParseFormat): string {
  const segs: string[] = [];
  if (format === 'matrix') {
    if (g.directed) segs.push('# directed');
    if (g.labels.some((l, i) => l !== String(i))) segs.push(`# labels ${g.labels.join(' ')}`);
    for (let i = 0; i < g.n; i += 1) {
      const row: string[] = [];
      for (let j = 0; j < g.n; j += 1) {
        let w = 0;
        if (g.directed) {
          if (i !== j) w = g.edges.find((e) => e.u === i && e.v === j)?.w ?? 0;
        } else {
          const lo = Math.min(i, j);
          const hi = Math.max(i, j);
          if (i !== j) w = g.edges.find((e) => (e.u === lo && e.v === hi) || (e.u === hi && e.v === lo))?.w ?? 0;
        }
        row.push(String(w));
      }
      segs.push(row.join(' '));
    }
    return segs.join('; ');
  }
  if (g.directed) segs.push('# directed');
  for (const e of g.edges) {
    const a = g.labels[e.u] ?? String(e.u);
    const b = g.labels[e.v] ?? String(e.v);
    segs.push(g.directed ? `${a} -> ${b} ${fmtNum(e.w)}` : `${a} ${b} ${fmtNum(e.w)}`);
  }
  return segs.join('; ');
}

// ---- shortest paths -----------------------------------------------------------------

export interface ShortestPathResult {
  source: number;
  /** Distances from `source`; `Infinity` = unreachable. */
  dist: number[];
  /** Predecessor on the shortest path (−1 = none). */
  prev: number[];
  /** Nodes in Dijkstra extraction order (empty for Bellman-Ford). */
  settle: number[];
  /** Bellman-Ford only: a negative cycle is reachable from the source. */
  negativeCycle: boolean;
}

/** Dijkstra with an array-based priority queue (O(V²), ideal for the small sample graphs). */
export function dijkstra(g: Graph, source: number, onStep?: StepSink): ShortestPathResult {
  const emit = sink(onStep);
  const nb = adjacency(g);
  const s = clampIndex(source, g.n);
  const dist: number[] = new Array(g.n).fill(Infinity);
  const prev: number[] = new Array(g.n).fill(-1);
  const done: boolean[] = new Array(g.n).fill(false);
  const settle: number[] = [];
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const overlay = (): string[] => dist.map((d) => (Number.isFinite(d) ? fmtNum(d) : '∞'));

  dist[s] = 0;
  emit({ descEn: `Initialize d(${lbl(s)}) = 0, every other distance = ∞`, descZh: `初始化 d(${lbl(s)}) = 0，其余距离 = ∞`, nodes: [s], edges: [], labels: overlay() });
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < g.n; i += 1) {
      if (!done[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = true;
    settle.push(u);
    emit({
      descEn: `Extract minimum d(${lbl(u)}) = ${fmtNum(best)} — final`,
      descZh: `抽取最小值 d(${lbl(u)}) = ${fmtNum(best)} — 已确定`,
      nodes: [...settle],
      edges: [],
      labels: overlay(),
    });
    for (const a of nb[u]!) {
      if (done[a.to]) continue;
      const nd = dist[u]! + a.weight;
      if (nd < dist[a.to]!) {
        const before = dist[a.to]!;
        dist[a.to] = nd;
        prev[a.to] = u;
        emit({
          descEn: `Relax ${lbl(u)} → ${lbl(a.to)}: d = ${fmtNum(before)} → ${fmtNum(nd)}`,
          descZh: `松弛 ${lbl(u)} → ${lbl(a.to)}：d = ${fmtNum(before)} → ${fmtNum(nd)}`,
          nodes: [u, a.to],
          edges: [[u, a.to]],
          labels: overlay(),
        });
      }
    }
  }
  const reached = settle.length;
  emit({
    descEn: `Settled ${reached}/${g.n} nodes — all shortest paths from ${lbl(s)} final`,
    descZh: `已确定 ${reached}/${g.n} 个节点 — ${lbl(s)} 的全部最短路完成`,
    nodes: settle,
    edges: [],
    labels: overlay(),
    final: true,
  });
  return { source: s, dist, prev, settle, negativeCycle: false };
}

/** Bellman-Ford: passes over every edge, reports a reachable negative cycle. */
export function bellmanFord(g: Graph, source: number, onStep?: StepSink): ShortestPathResult {
  const emit = sink(onStep);
  const s = clampIndex(source, g.n);
  const dist: number[] = new Array(g.n).fill(Infinity);
  const prev: number[] = new Array(g.n).fill(-1);
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const overlay = (): string[] => dist.map((d) => (Number.isFinite(d) ? fmtNum(d) : '∞'));

  dist[s] = 0;
  emit({ descEn: `Initialize d(${lbl(s)}) = 0, every other distance = ∞; ${g.edges.length} edges per pass`, descZh: `初始化 d(${lbl(s)}) = 0，其余距离 = ∞；每轮扫描 ${g.edges.length} 条边`, nodes: [s], edges: [], labels: overlay() });
  let stablePass = -1;
  for (let pass = 1; pass <= g.n - 1; pass += 1) {
    let changed = false;
    for (const e of g.edges) {
      const pairs: Array<[number, number]> = g.directed ? [[e.u, e.v]] : [[e.u, e.v], [e.v, e.u]];
      for (const [a, b] of pairs) {
        if (!Number.isFinite(dist[a]!)) continue;
        const nd = dist[a]! + e.w;
        if (nd < dist[b]!) {
          const before = dist[b]!;
          dist[b] = nd;
          prev[b] = a;
          changed = true;
          emit({
            descEn: `Pass ${pass}: relax ${lbl(a)} → ${lbl(b)} (w = ${fmtNum(e.w)}), d = ${fmtNum(before)} → ${fmtNum(nd)}`,
            descZh: `第 ${pass} 轮：松弛 ${lbl(a)} → ${lbl(b)}（w = ${fmtNum(e.w)}），d = ${fmtNum(before)} → ${fmtNum(nd)}`,
            nodes: [a, b],
            edges: [[a, b]],
            labels: overlay(),
          });
        }
      }
    }
    if (!changed) {
      stablePass = pass;
      emit({
        descEn: `Pass ${pass}: no relaxation — distances are stable`,
        descZh: `第 ${pass} 轮：无松弛发生 — 距离已稳定`,
        nodes: Array.from({ length: g.n }, (_, i) => i),
        edges: [],
        labels: overlay(),
      });
      break;
    }
  }
  let negativeCycle = false;
  for (const e of g.edges) {
    const pairs: Array<[number, number]> = g.directed ? [[e.u, e.v]] : [[e.u, e.v], [e.v, e.u]];
    for (const [a, b] of pairs) {
      if (!Number.isFinite(dist[a]!)) continue;
      if (dist[a]! + e.w < dist[b]! - 1e-12) {
        negativeCycle = true;
        emit({
          descEn: `Negative cycle reachable: ${lbl(a)} → ${lbl(b)} still relaxes — distances undefined`,
          descZh: `检测到可达负环：${lbl(a)} → ${lbl(b)} 仍可松弛 — 距离无定义`,
          nodes: [a, b],
          edges: [[a, b]],
          labels: overlay(),
          final: true,
        });
        break;
      }
    }
    if (negativeCycle) break;
  }
  if (!negativeCycle) {
    emit({
      descEn: `Bellman-Ford finished${stablePass > 0 ? ` after ${stablePass} passes` : ''} — no negative cycle`,
      descZh: `Bellman-Ford 完成${stablePass > 0 ? `（${stablePass} 轮收敛）` : ''} — 无负权环`,
      nodes: Array.from({ length: g.n }, (_, i) => i).filter((i) => Number.isFinite(dist[i]!)),
      edges: [],
      labels: overlay(),
      final: true,
    });
  }
  return { source: s, dist, prev, settle: [], negativeCycle };
}

export interface AllPairsResult {
  /** `dist[i][j]` — all-pairs shortest paths (`Infinity` = unreachable). */
  dist: number[][];
}

/** Floyd-Warshall: n³ dynamic programming over the intermediate node. */
export function floydWarshall(g: Graph, onStep?: StepSink, rowSource = 0): AllPairsResult {
  const emit = sink(onStep);
  const n = g.n;
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i += 1) dist[i]![i] = 0;
  for (const e of g.edges) {
    if (e.w < dist[e.u]![e.v]!) dist[e.u]![e.v] = e.w;
    if (!g.directed && e.w < dist[e.v]![e.u]!) dist[e.v]![e.u] = e.w;
  }
  emit({
    descEn: `Initialize the ${n}×${n} distance matrix from the edge weights`,
    descZh: `由边权初始化 ${n}×${n} 距离矩阵`,
    nodes: Array.from({ length: n }, (_, i) => i),
    edges: [],
  });
  for (let k = 0; k < n; k += 1) {
    const updated: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) {
      const ik = dist[i]![k]!;
      if (!Number.isFinite(ik)) continue;
      for (let j = 0; j < n; j += 1) {
        const via = ik + dist[k]![j]!;
        if (via < dist[i]![j]!) {
          dist[i]![j] = via;
          if (i !== j) updated.push([i, j]);
        }
      }
    }
    const sample = updated
      .slice(0, 6)
      .map(([i, j]) => `${lbl(i)}→${lbl(j)}=${fmtNum(dist[i]![j]!)}`)
      .join(', ');
    emit({
      descEn: `Intermediate ${lbl(k)}: ${updated.length} pair(s) improved${sample ? ` (${sample}${updated.length > 6 ? ', …' : ''})` : ''}`,
      descZh: `中转节点 ${lbl(k)}：${updated.length} 对距离被更新${sample ? `（${sample}${updated.length > 6 ? '，…' : ''}）` : ''}`,
      nodes: [k],
      edges: updated.slice(0, 40),
    });
  }
  const row = clampIndex(rowSource, n);
  const overlay = (): string[] => dist[row]!.map((d) => (Number.isFinite(d) ? fmtNum(d) : '∞'));
  emit({
    descEn: `All-pairs shortest paths complete — row ${lbl(row)} shown on the nodes`,
    descZh: `全对最短路完成 — 节点下方显示 ${lbl(row)} 所在行的距离`,
    nodes: Array.from({ length: n }, (_, i) => i),
    edges: [],
    labels: overlay(),
    final: true,
  });
  return { dist };
}

// ---- minimum spanning trees ----------------------------------------------------------

export interface MstResult {
  /** Selected edge indices (of `g.edges`). */
  edges: number[];
  /** Total weight of the selected edges. */
  total: number;
  /** True when a single spanning tree covers every node. */
  connected: boolean;
}

function mstPairs(g: Graph, edges: number[]): Array<[number, number]> {
  return edges.map((i) => [g.edges[i]!.u, g.edges[i]!.v] as [number, number]);
}

function mstWeight(g: Graph, edges: number[]): number {
  return edges.reduce((acc, i) => acc + g.edges[i]!.w, 0);
}

/** Prim from `start`; the edge set is treated as undirected (standard MST). */
export function prim(g: Graph, start = 0, onStep?: StepSink): MstResult {
  const emit = sink(onStep);
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const nb = underlying(g);
  const s = clampIndex(start, g.n);
  const key: number[] = new Array(g.n).fill(Infinity);
  const inTree: boolean[] = new Array(g.n).fill(false);
  const attach: number[] = new Array(g.n).fill(-1);
  const edges: number[] = [];
  let connected = true;

  if (g.n === 0) return { edges, total: 0, connected: true };
  key[s] = 0;
  emit({ descEn: `Start from ${lbl(s)} (key = 0), all other keys = ∞`, descZh: `从 ${lbl(s)} 出发（key = 0），其余 key = ∞`, nodes: [s], edges: [] });
  for (let it = 0; it < g.n; it += 1) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < g.n; i += 1) {
      if (!inTree[i] && key[i]! < best) {
        best = key[i]!;
        u = i;
      }
    }
    if (u < 0) {
      connected = false;
      break;
    }
    inTree[u] = true;
    if ((attach[u] ?? -1) >= 0) edges.push(attach[u]!);
    const treeNodes = Array.from({ length: g.n }, (_, i) => i).filter((i) => inTree[i]);
    emit({
      descEn: `Add ${lbl(u)} via ${(attach[u] ?? -1) >= 0 ? `edge w = ${fmtNum(best)}` : 'seed key 0'}: tree weight = ${fmtNum(mstWeight(g, edges))}`,
      descZh: `加入 ${lbl(u)}（${(attach[u] ?? -1) >= 0 ? `边权 w = ${fmtNum(best)}` : '种子 key 0'}）：树权和 = ${fmtNum(mstWeight(g, edges))}`,
      nodes: treeNodes,
      edges: mstPairs(g, edges),
    });
    for (const a of nb[u]!) {
      if (inTree[a.to]) continue;
      if (a.weight < key[a.to]!) {
        key[a.to] = a.weight;
        attach[a.to] = a.edge;
      }
    }
  }
  const covered = inTree.filter(Boolean).length;
  emit({
    descEn: connected ? `MST complete: ${edges.length} edges, total weight = ${fmtNum(mstWeight(g, edges))}` : `Spanning forest: only ${covered}/${g.n} nodes reachable, weight = ${fmtNum(mstWeight(g, edges))}`,
    descZh: connected ? `最小生成树完成：${edges.length} 条边，总权 = ${fmtNum(mstWeight(g, edges))}` : `生成森林：仅覆盖 ${covered}/${g.n} 个节点，总权 = ${fmtNum(mstWeight(g, edges))}`,
    nodes: Array.from({ length: g.n }, (_, i) => i).filter((i) => inTree[i]),
    edges: mstPairs(g, edges),
    final: true,
  });
  return { edges, total: mstWeight(g, edges), connected };
}

/** Kruskal via union-find, edges sorted by weight (ties broken by index). */
export function kruskal(g: Graph, onStep?: StepSink): MstResult {
  const emit = sink(onStep);
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const parent: number[] = Array.from({ length: g.n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    let c = x;
    while (parent[c] !== c) {
      const nxt = parent[c]!;
      parent[c] = r;
      c = nxt;
    }
    return r;
  };
  const order = g.edges.map((_, i) => i).sort((a, b) => (g.edges[a]!.w - g.edges[b]!.w) || a - b);
  const edges: number[] = [];
  emit({
    descEn: `Sort ${g.edges.length} edges by weight — smallest first is w = ${order.length > 0 ? fmtNum(g.edges[order[0]!]!.w) : '—'}`,
    descZh: `按边权升序排列 ${g.edges.length} 条边 — 最小 w = ${order.length > 0 ? fmtNum(g.edges[order[0]!]!.w) : '—'}`,
    nodes: [],
    edges: [],
  });
  for (const idx of order) {
    const e = g.edges[idx]!;
    const ru = find(e.u);
    const rv = find(e.v);
    const accepted = ru !== rv && edges.length < Math.max(0, g.n - 1);
    if (ru !== rv) parent[ru] = rv;
    if (accepted) edges.push(idx);
    emit({
      descEn: `${accepted ? 'Accept' : 'Reject'} ${lbl(e.u)} — ${lbl(e.v)} (w = ${fmtNum(e.w)})${accepted ? `: ${ru === rv ? 'cycle' : 'different components'}, total = ${fmtNum(mstWeight(g, edges))}` : ru === rv ? ': would close a cycle' : ': tree already has n−1 edges'}`,
      descZh: `${accepted ? '选入' : '跳过'} ${lbl(e.u)} — ${lbl(e.v)}（w = ${fmtNum(e.w)}）${accepted ? `：${ru === rv ? '无环' : '连接不同连通分量'}，总权 = ${fmtNum(mstWeight(g, edges))}` : ru === rv ? '：会形成环' : '：树已有 n−1 条边'}`,
      nodes: [e.u, e.v],
      edges: mstPairs(g, edges),
    });
  }
  const covered = new Set(edges.flatMap((i) => [g.edges[i]!.u, g.edges[i]!.v])).size;
  emit({
    descEn: `Kruskal finished: ${edges.length} edges, total weight = ${fmtNum(mstWeight(g, edges))} (${covered}/${g.n} nodes covered)`,
    descZh: `Kruskal 完成：${edges.length} 条边，总权 = ${fmtNum(mstWeight(g, edges))}（覆盖 ${covered}/${g.n} 个节点）`,
    nodes: Array.from({ length: g.n }, (_, i) => i).filter((i) => edges.some((k) => g.edges[k]!.u === i || g.edges[k]!.v === i)),
    edges: mstPairs(g, edges),
    final: true,
  });
  return { edges, total: mstWeight(g, edges), connected: covered === g.n };
}

// ---- maximum flow -----------------------------------------------------------------------

export interface FlowResult {
  /** Value of the maximum flow. */
  value: number;
  /** Net flow per edge, oriented `u → v` (may be negative when undirected). */
  flow: number[];
  /** Residual-reachable nodes from the source: the min-cut side S. */
  reachable: boolean[];
  /** Number of augmentations performed. */
  augmentations: number;
  /** Capacity of the reported minimum cut (equals `value` at optimality). */
  cutCapacity: number;
}

interface ResidualArc {
  from: number;
  to: number;
  cap0: number;
  flow: number;
}

/**
 * Maximum flow with an explicit residual network. `method: 'bfs'` is
 * Edmonds-Karp (polynomial); `'dfs'` is plain Ford-Fulkerson. Arcs are
 * stored in pairs (2i = forward, 2i+1 = backward) so an undirected edge
 * carries capacity in both directions. The iteration cap guards against
 * non-terminating irrational-capacity instances.
 */
export function maxFlow(
  g: Graph,
  source: number,
  target: number,
  method: 'bfs' | 'dfs' = 'bfs',
  onStep?: StepSink,
): FlowResult {
  const emit = sink(onStep);
  const n = g.n;
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const s = clampIndex(source, n);
  const t = clampIndex(target, n);
  const arcs: ResidualArc[] = [];
  g.edges.forEach((e) => {
    arcs.push({ from: e.u, to: e.v, cap0: Math.max(0, e.w), flow: 0 });
    arcs.push({ from: e.v, to: e.u, cap0: g.directed ? 0 : Math.max(0, e.w), flow: 0 });
  });
  const out: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => out[a.from]!.push(i));
  // Classic residual model: for a directed edge the reverse arc carries the
  // current forward flow (augmenting backward cancels flow). Undirected
  // pairs keep independent capacities in both orientations.
  const residual = (i: number): number =>
    g.directed && i % 2 === 1 ? arcs[i - 1]!.flow : arcs[i]!.cap0 - arcs[i]!.flow;
  const EPS = 1e-12;

  const empty = (): FlowResult => ({
    value: 0,
    flow: g.edges.map(() => 0),
    reachable: new Array(n).fill(false),
    augmentations: 0,
    cutCapacity: 0,
  });
  if (n === 0 || s === t) {
    emit({ descEn: 'Source equals sink — maximum flow is 0', descZh: '源点与汇点相同 — 最大流为 0', nodes: [s], edges: [], final: true });
    return empty();
  }

  const findBfsPath = (): number[] | null => {
    const prevArc: number[] = new Array(n).fill(-1);
    const seen: boolean[] = new Array(n).fill(false);
    seen[s] = true;
    const queue: number[] = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      if (u === t) break;
      for (const ai of out[u]!) {
        const v = arcs[ai]!.to;
        if (!seen[v] && residual(ai) > EPS) {
          seen[v] = true;
          prevArc[v] = ai;
          queue.push(v);
        }
      }
    }
    if (!seen[t]) return null;
    const path: number[] = [];
    let v = t;
    while (v !== s) {
      const ai = prevArc[v]!;
      if (ai < 0) return null;
      path.unshift(ai);
      v = arcs[ai]!.from;
    }
    return path;
  };

  const findDfsPath = (): number[] | null => {
    const seen: boolean[] = new Array(n).fill(false);
    const stackArc: number[] = [];
    const stackNode: number[] = [s];
    seen[s] = true;
    while (stackNode.length > 0) {
      const u = stackNode[stackNode.length - 1]!;
      if (u === t) return stackArc.slice();
      let advanced = false;
      for (const ai of out[u]!) {
        const v = arcs[ai]!.to;
        if (!seen[v] && residual(ai) > EPS) {
          seen[v] = true;
          stackArc.push(ai);
          stackNode.push(v);
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        stackNode.pop();
        stackArc.pop();
      }
    }
    return null;
  };

  let value = 0;
  let augmentations = 0;
  emit({ descEn: `Residual network ready (${arcs.length} arcs) — flow = 0`, descZh: `残差网络就绪（${arcs.length} 条弧）— 流量 = 0`, nodes: [s, t], edges: [] });
  const ITER_CAP = 10000;
  while (augmentations < ITER_CAP) {
    const path = method === 'bfs' ? findBfsPath() : findDfsPath();
    if (!path || path.length === 0) break;
    let bottleneck = Infinity;
    for (const ai of path) bottleneck = Math.min(bottleneck, residual(ai));
    for (const ai of path) {
      if (g.directed && ai % 2 === 1) arcs[ai - 1]!.flow -= bottleneck; // cancel forward flow
      else arcs[ai]!.flow += bottleneck;
    }
    value += bottleneck;
    augmentations += 1;
    const nodes = [s, ...path.map((ai) => arcs[ai]!.to)];
    const pairs: Array<[number, number]> = path.map((ai) => [arcs[ai]!.from, arcs[ai]!.to]);
    emit({
      descEn: `Augment +${fmtNum(bottleneck)} along ${nodes.map(lbl).join(' → ')} (${method === 'bfs' ? 'BFS' : 'DFS'} path): flow = ${fmtNum(value)}`,
      descZh: `沿 ${nodes.map(lbl).join(' → ')} 增广 +${fmtNum(bottleneck)}（${method === 'bfs' ? 'BFS' : 'DFS'} 路径）：流量 = ${fmtNum(value)}`,
      nodes,
      edges: pairs,
    });
  }

  // min-cut side: nodes reachable from the source in the residual graph
  const reachable: boolean[] = new Array(n).fill(false);
  reachable[s] = true;
  const queue: number[] = [s];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    for (const ai of out[u]!) {
      const v = arcs[ai]!.to;
      if (!reachable[v] && residual(ai) > EPS) {
        reachable[v] = true;
        queue.push(v);
      }
    }
  }
  const cutEdges: Array<[number, number]> = [];
  let cutCapacity = 0;
  g.edges.forEach((e) => {
    const w = Math.max(0, e.w);
    if (reachable[e.u] && !reachable[e.v]) {
      cutEdges.push([e.u, e.v]);
      cutCapacity += w;
    } else if (!g.directed && reachable[e.v] && !reachable[e.u]) {
      cutEdges.push([e.v, e.u]);
      cutCapacity += w;
    }
  });
  const flow: number[] = g.edges.map((_, i) => (g.directed ? arcs[2 * i]!.flow : arcs[2 * i]!.flow - arcs[2 * i + 1]!.flow));
  const side = Array.from({ length: n }, (_, i) => i)
    .filter((i) => reachable[i])
    .map(lbl)
    .join(', ');
  emit({
    descEn: `Maximum flow = ${fmtNum(value)} after ${augmentations} augmentation(s); min-cut S = {${side}}, capacity = ${fmtNum(cutCapacity)}`,
    descZh: `最大流 = ${fmtNum(value)}（${augmentations} 次增广）；最小割 S = {${side}}，容量 = ${fmtNum(cutCapacity)}`,
    nodes: Array.from({ length: n }, (_, i) => i).filter((i) => reachable[i]),
    edges: cutEdges,
    final: true,
  });
  return { value, flow, reachable, augmentations, cutCapacity };
}

// ---- coloring ------------------------------------------------------------------------------

export interface ColoringResult {
  /** Colour index per node (−1 = uncoloured). */
  colors: number[];
  /** Number of colours actually used (greedy upper bound for χ). */
  used: number;
  /** Vertex processing order (descending degree, index as tie-break). */
  order: number[];
}

/** Greedy first-fit coloring in descending-degree order. */
export function colorGraph(g: Graph, onStep?: StepSink): ColoringResult {
  const emit = sink(onStep);
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const nb = underlying(g);
  const order = Array.from({ length: g.n }, (_, i) => i).sort((a, b) => nb[b]!.length - nb[a]!.length || a - b);
  const colors: number[] = new Array(g.n).fill(-1);
  const overlay = (): string[] => colors.map((c) => (c >= 0 ? `c${c + 1}` : ''));
  emit({
    descEn: `Greedy first-fit in degree order: ${order.map(lbl).join(' → ')}`,
    descZh: `按度数降序贪心着色：${order.map(lbl).join(' → ')}`,
    nodes: [],
    edges: [],
    labels: overlay(),
  });
  for (const u of order) {
    const usedByNeighbors = new Set<number>();
    for (const a of nb[u]!) if (colors[a.to]! >= 0) usedByNeighbors.add(colors[a.to]!);
    let c = 0;
    while (usedByNeighbors.has(c)) c += 1;
    colors[u] = c;
    emit({
      descEn: `Colour ${lbl(u)} with c${c + 1} (neighbours already use ${usedByNeighbors.size === 0 ? 'no colour' : [...usedByNeighbors].map((x) => `c${x + 1}`).join(', ')})`,
      descZh: `给 ${lbl(u)} 着色 c${c + 1}（邻居已用 ${usedByNeighbors.size === 0 ? '无颜色' : [...usedByNeighbors].map((x) => `c${x + 1}`).join('、')}）`,
      nodes: [u, ...nb[u]!.map((a) => a.to)],
      edges: nb[u]!.map((a) => [u, a.to] as [number, number]),
      labels: overlay(),
    });
  }
  const used = colors.reduce((m, c) => Math.max(m, c + 1), 0);
  emit({
    descEn: `Used ${used} colours — greedy upper bound for the chromatic number`,
    descZh: `共使用 ${used} 种颜色 — 色数的贪心上界`,
    nodes: Array.from({ length: g.n }, (_, i) => i),
    edges: [],
    labels: overlay(),
    final: true,
  });
  return { colors, used, order };
}

// ---- bipartite matching & König -----------------------------------------------------------

export interface BipartiteCheck {
  bipartite: boolean;
  /** Partition id per node (0 / 1); −1 before assignment (never bipartite graphs). */
  side: number[];
}

/** BFS 2-colouring on the underlying undirected graph. */
export function isBipartite(g: Graph): BipartiteCheck {
  const nb = underlying(g);
  const side: number[] = new Array(g.n).fill(-1);
  for (let root = 0; root < g.n; root += 1) {
    if ((side[root] ?? -1) >= 0) continue;
    side[root] = 0;
    const queue = [root];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      for (const a of nb[u]!) {
        if ((side[a.to] ?? -1) < 0) {
          side[a.to] = 1 - side[u]!;
          queue.push(a.to);
        } else if (side[a.to] === side[u]) {
          return { bipartite: false, side };
        }
      }
    }
  }
  return { bipartite: true, side };
}

export interface MatchingResult {
  bipartite: boolean;
  side: number[];
  /** Symmetric partner per node (−1 = unmatched). */
  partner: number[];
  size: number;
  left: number[];
}

/** Hungarian augmenting-path search on the bipartition produced by `isBipartite`. */
export function bipartiteMatching(g: Graph, onStep?: StepSink): MatchingResult {
  const emit = sink(onStep);
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const nb = underlying(g);
  const check = isBipartite(g);
  const base = (): MatchingResult => ({
    bipartite: check.bipartite,
    side: check.bipartite ? check.side : [],
    partner: new Array(g.n).fill(-1),
    size: 0,
    left: [],
  });
  if (!check.bipartite) {
    emit({
      descEn: 'Graph is not bipartite (an odd cycle exists) — bipartite matching does not apply',
      descZh: '图不是二部图（存在奇环）— 二部图匹配不适用',
      nodes: [],
      edges: [],
      final: true,
    });
    return base();
  }
  const side = check.side;
  const left = Array.from({ length: g.n }, (_, i) => i).filter((i) => side[i] === 0);
  const right = Array.from({ length: g.n }, (_, i) => i).filter((i) => side[i] === 1);
  const partnerRight: number[] = new Array(g.n).fill(-1); // right node → left partner
  const overlay = (): string[] => {
    const out: string[] = new Array(g.n).fill('');
    for (const r of right) {
      const l = partnerRight[r]!;
      if (l >= 0) {
        out[r] = lbl(l);
        out[l] = lbl(r);
      }
    }
    return out;
  };
  const matchedPairs = (): Array<[number, number]> =>
    right.filter((r) => partnerRight[r]! >= 0).map((r) => [partnerRight[r]!, r] as [number, number]);
  const matchedNodes = (): number[] => right.filter((r) => partnerRight[r]! >= 0).flatMap((r) => [partnerRight[r]!, r]);

  emit({
    descEn: `Bipartition: left = {${left.map(lbl).join(', ')}}, right = {${right.map(lbl).join(', ')}} — matching empty`,
    descZh: `二部划分：左部 = {${left.map(lbl).join('、')}}，右部 = {${right.map(lbl).join('、')}} — 初始匹配为空`,
    nodes: [],
    edges: [],
    labels: overlay(),
  });

  let size = 0;
  for (const u of left) {
    const seen: boolean[] = new Array(g.n).fill(false);
    const dfs = (x: number): boolean => {
      for (const a of nb[x]!) {
        const v = a.to;
        if (side[v] !== 1 || seen[v]) continue;
        seen[v] = true;
        if (partnerRight[v]! < 0 || dfs(partnerRight[v]!)) {
          partnerRight[v] = x;
          return true;
        }
      }
      return false;
    };
    const ok = dfs(u);
    if (ok) size += 1;
    emit({
      descEn: ok
        ? `Augment through ${lbl(u)}: matching size = ${size}`
        : `No augmenting path from ${lbl(u)} — stays unmatched`,
      descZh: ok ? `经 ${lbl(u)} 增广：匹配大小 = ${size}` : `从 ${lbl(u)} 出发无增广路 — 保持未匹配`,
      nodes: ok ? matchedNodes() : [u],
      edges: matchedPairs(),
      labels: overlay(),
    });
  }

  const partner: number[] = new Array(g.n).fill(-1);
  for (const r of right) {
    const l = partnerRight[r]!;
    if (l >= 0) {
      partner[r] = l;
      partner[l] = r;
    }
  }
  const cover = konigVertexCover(g, side, partner);
  emit({
    descEn: `Maximum matching = ${size}; by König's theorem the minimum vertex cover also has size ${size}: {${cover.map(lbl).join(', ')}}`,
    descZh: `最大匹配 = ${size}；由 König 定理，最小点覆盖也等于 ${size}：{${cover.map(lbl).join('、')}}`,
    nodes: cover,
    edges: matchedPairs(),
    labels: overlay(),
    final: true,
  });
  return { bipartite: true, side, partner, size, left };
}

/**
 * König's construction: alternate from unmatched left vertices (free edges
 * rightwards, matched edges leftwards) and take cover = (left \ Z) ∪ (right ∩ Z).
 * Exact when `partner` is a maximum matching of a bipartite graph.
 */
export function konigVertexCover(g: Graph, side: number[], partner: number[]): number[] {
  const nb = underlying(g);
  const inZ: boolean[] = new Array(g.n).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < g.n; i += 1) {
    if (side[i] === 0 && partner[i]! < 0) {
      inZ[i] = true;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    if (side[u] === 0) {
      // left → right along non-matching edges
      for (const a of nb[u]!) {
        const v = a.to;
        if (side[v] === 1 && partner[v] !== u && !inZ[v]) {
          inZ[v] = true;
          queue.push(v);
        }
      }
    } else {
      // right → left along the matching edge
      const l = partner[u]!;
      if (l >= 0 && !inZ[l]) {
        inZ[l] = true;
        queue.push(l);
      }
    }
  }
  const cover: number[] = [];
  for (let i = 0; i < g.n; i += 1) {
    if (side[i] === 0 && !inZ[i]) cover.push(i);
    else if (side[i] === 1 && inZ[i]) cover.push(i);
  }
  return cover;
}

// ---- Euler / Hamiltonian trails ------------------------------------------------------------

export interface EulerResult {
  kind: 'circuit' | 'path' | 'none';
  /** Start vertex of the trail (−1 when none). */
  start: number;
  /** Odd-degree vertices (undirected) / imbalanced vertices (directed). */
  odd: number[];
  /** Vertex sequence of the trail (empty when none). */
  path: number[];
  connected: boolean;
}

/** Euler circuit / path detection + Hierholzer trail construction. */
export function detectEuler(g: Graph, onStep?: StepSink): EulerResult {
  const emit = sink(onStep);
  const n = g.n;
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const arcs: Array<{ from: number; to: number }> = [];
  const outDeg: number[] = new Array(n).fill(0);
  const inDeg: number[] = new Array(n).fill(0);
  g.edges.forEach((e) => {
    arcs.push({ from: e.u, to: e.v });
    outDeg[e.u] = outDeg[e.u]! + 1;
    inDeg[e.v] = inDeg[e.v]! + 1;
    if (!g.directed) {
      arcs.push({ from: e.v, to: e.u });
      outDeg[e.v] = outDeg[e.v]! + 1;
      inDeg[e.u] = inDeg[e.u]! + 1;
    }
  });
  const outArcs: number[][] = Array.from({ length: n }, () => []);
  const inArcs: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => {
    outArcs[a.from]!.push(i);
    inArcs[a.to]!.push(i);
  });
  const active = Array.from({ length: n }, (_, i) => i).filter((i) => outArcs[i]!.length > 0 || inArcs[i]!.length > 0);
  const degreeLabels = (): string[] =>
    Array.from({ length: n }, (_, i) =>
      outArcs[i]!.length + inArcs[i]!.length === 0 ? '' : g.directed ? `${outDeg[i]}/${inDeg[i]}` : `deg=${outDeg[i]}`,
    );

  if (active.length === 0) {
    emit({ descEn: 'Graph has no edges — nothing to trace', descZh: '图中没有边 — 无可追踪的轨迹', nodes: [], edges: [], final: true });
    return { kind: 'none', start: -1, odd: [], path: [], connected: false };
  }

  const odd = g.directed
    ? Array.from({ length: n }, (_, i) => i).filter((i) => outDeg[i] !== inDeg[i])
    : active.filter((i) => outDeg[i]! % 2 === 1);
  emit({
    descEn: g.directed
      ? `In/out degrees: ${odd.filter((i) => outDeg[i] !== inDeg[i]).length} imbalanced node(s)`
      : `Degrees: ${odd.length} odd-degree node(s) (an Euler trail needs 0 or 2)`,
    descZh: g.directed ? `入/出度：${odd.length} 个不平衡节点` : `度数：${odd.length} 个奇度节点（欧拉轨迹要求 0 或 2 个）`,
    nodes: odd.length > 0 ? odd : active,
    edges: [],
    labels: degreeLabels(),
  });

  // connectivity among active vertices (undirected reachability; both arcs for directed)
  const bfs = (useIncoming: boolean): boolean => {
    const seen: boolean[] = new Array(n).fill(false);
    const start = active[0]!;
    seen[start] = true;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      const list = useIncoming ? inArcs[u]! : outArcs[u]!;
      for (const ai of list) {
        const v = useIncoming ? arcs[ai]!.from : arcs[ai]!.to;
        if (!seen[v]) {
          seen[v] = true;
          queue.push(v);
        }
      }
    }
    return active.every((i) => seen[i]);
  };
  const connected = g.directed ? bfs(false) && bfs(true) : bfs(false);
  emit({
    descEn: connected ? 'All vertices with edges are connected' : 'Vertices with edges are disconnected — no Euler trail',
    descZh: connected ? '含边顶点全部连通' : '含边顶点不连通 — 不存在欧拉轨迹',
    nodes: active,
    edges: [],
    labels: degreeLabels(),
    final: !connected,
  });
  if (!connected) return { kind: 'none', start: -1, odd, path: [], connected: false };

  let kind: EulerResult['kind'] = 'none';
  let start = -1;
  if (g.directed) {
    const excessOut = active.filter((i) => outDeg[i] === inDeg[i]! + 1);
    const excessIn = active.filter((i) => inDeg[i] === outDeg[i]! + 1);
    const balanced = active.every((i) => outDeg[i] === inDeg[i]);
    if (balanced) {
      kind = 'circuit';
      start = active[0]!;
    } else if (excessOut.length === 1 && excessIn.length === 1) {
      kind = 'path';
      start = excessOut[0]!;
    }
  } else if (odd.length === 0) {
    kind = 'circuit';
    start = active[0]!;
  } else if (odd.length === 2) {
    kind = 'path';
    start = odd[0]!;
  }
  if (kind === 'none') {
    emit({
      descEn: `No Euler trail: ${odd.length} odd/imbalanced node(s), degree conditions require 0 or 2`,
      descZh: `不存在欧拉轨迹：${odd.length} 个奇度/不平衡节点，条件要求 0 或 2 个`,
      nodes: odd,
      edges: [],
      labels: degreeLabels(),
      final: true,
    });
    return { kind, start: -1, odd, path: [], connected: true };
  }

  // Hierholzer: iterative circuit extraction, then reverse.
  const used: boolean[] = new Array(arcs.length).fill(false);
  const stack: number[] = [start];
  const circuit: number[] = [];
  while (stack.length > 0) {
    const u = stack[stack.length - 1]!;
    let found = -1;
    for (const ai of outArcs[u]!) {
      if (!used[ai]) {
        found = ai;
        break;
      }
    }
    if (found >= 0) {
      used[found] = true;
      if (!g.directed) used[found ^ 1] = true; // paired arcs share one undirected edge
      stack.push(arcs[found]!.to);
    } else {
      stack.pop();
      circuit.push(u);
    }
  }
  const trail = circuit.reverse();
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < trail.length; i += 1) pairs.push([trail[i]!, trail[i + 1]!]);
  const trailText = `${trail.slice(0, 14).map(lbl).join(' → ')}${trail.length > 14 ? ' …' : ''}`;
  emit({
    descEn: `Hierholzer: Euler ${kind} of ${pairs.length} edge(s): ${trailText}`,
    descZh: `Hierholzer 算法：欧拉${kind === 'circuit' ? '回路' : '路径'}共 ${pairs.length} 条边：${trailText}`,
    nodes: trail,
    edges: pairs,
    labels: degreeLabels(),
    final: true,
  });
  return { kind, start, odd, path: trail, connected: true };
}

export interface HamiltonResult {
  exists: boolean;
  /** True when the trail closes back into a cycle. */
  cycle: boolean;
  path: number[];
}

/**
 * Hamiltonian cycle-first backtracking; falls back to an open path search
 * when no cycle exists. A visit budget keeps pathological custom graphs from
 * hanging the UI (the search is exponential in the worst case).
 */
export function detectHamilton(g: Graph, onStep?: StepSink): HamiltonResult {
  const emit = sink(onStep);
  const n = g.n;
  const lbl = (i: number): string => g.labels[i] ?? String(i);
  const nb = underlying(g);
  const linked = (a: number, b: number): boolean => nb[a]!.some((x) => x.to === b);
  const path: number[] = [];
  const used: boolean[] = new Array(n).fill(false);
  let budget = 50000;

  const overlay = (): string[] => {
    const out: string[] = new Array(n).fill('');
    path.forEach((v, k) => {
      out[v] = String(k + 1);
    });
    return out;
  };
  const pairsNow = (): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 1 < path.length; i += 1) out.push([path[i]!, path[i + 1]!]);
    return out;
  };

  emit({
    descEn: 'Backtracking search: place one new node per position (cycle preferred)',
    descZh: '回溯搜索：每个位置尝试放入一个新节点（优先寻找回路）',
    nodes: [],
    edges: [],
  });

  const dfs = (requireCycle: boolean): boolean => {
    if (budget <= 0) return false;
    budget -= 1;
    const u = path[path.length - 1]!;
    if (path.length === n) return requireCycle ? linked(u, path[0]!) : true;
    for (let v = 0; v < n; v += 1) {
      if (used[v]) continue;
      if (path.length > 0 && !linked(u, v)) continue;
      path.push(v);
      used[v] = true;
      emit({
        descEn: `Place ${lbl(v)} at position ${path.length} (${requireCycle ? 'cycle' : 'path'} mode)`,
        descZh: `将 ${lbl(v)} 放入第 ${path.length} 位（${requireCycle ? '回路' : '路径'}模式）`,
        nodes: [...path],
        edges: pairsNow(),
        labels: overlay(),
      });
      if (dfs(requireCycle)) return true;
      path.pop();
      used[v] = false;
      emit({
        descEn: `Dead end after ${lbl(v)} — backtrack`,
        descZh: `走到 ${lbl(v)} 后无路可走 — 回溯`,
        nodes: [...path],
        edges: pairsNow(),
        labels: overlay(),
      });
    }
    return false;
  };

  const search = (requireCycle: boolean): boolean => {
    for (let s = 0; s < n; s += 1) {
      path.length = 0;
      used.fill(false);
      path.push(s);
      used[s] = true;
      emit({
        descEn: `Start the ${requireCycle ? 'cycle' : 'path'} search at ${lbl(s)}`,
        descZh: `从 ${lbl(s)} 开始搜索${requireCycle ? '回路' : '路径'}`,
        nodes: [s],
        edges: [],
        labels: overlay(),
      });
      if (dfs(requireCycle)) return true;
      path.length = 0;
      used.fill(false);
      if (budget <= 0) return false;
    }
    return false;
  };

  const cycleFound = n > 1 ? search(true) : false;
  if (cycleFound) {
    const result = [...path];
    const text = `${[...result, result[0]!].map(lbl).join(' → ')}`;
    emit({
      descEn: `Hamiltonian cycle found: ${text}`,
      descZh: `找到哈密顿回路：${text}`,
      nodes: result,
      edges: [...pairsNow(), [result[result.length - 1]!, result[0]!]],
      labels: overlay(),
      final: true,
    });
    return { exists: true, cycle: true, path: result };
  }
  emit({
    descEn: budget <= 0 ? 'Search budget exhausted without a cycle — retrying as an open path' : 'No Hamiltonian cycle — retrying as an open path',
    descZh: budget <= 0 ? '回路搜索预算耗尽 — 改为开放路径搜索' : '不存在哈密顿回路 — 改为开放路径搜索',
    nodes: [],
    edges: [],
  });
  const pathFound = search(false);
  if (pathFound) {
    const text = path.map(lbl).join(' → ');
    emit({
      descEn: `Hamiltonian path found: ${text}`,
      descZh: `找到哈密顿路径：${text}`,
      nodes: [...path],
      edges: pairsNow(),
      labels: overlay(),
      final: true,
    });
    return { exists: true, cycle: false, path: [...path] };
  }
  emit({
    descEn: budget <= 0 ? 'Search budget exhausted — no Hamiltonian trail certified' : 'Every branch failed — the graph has no Hamiltonian path',
    descZh: budget <= 0 ? '搜索预算耗尽 — 未能确认哈密顿轨迹' : '所有分支均失败 — 图中不存在哈密顿路径',
    nodes: [],
    edges: [],
    final: true,
  });
  return { exists: false, cycle: false, path: [] };
}

// ---- step-list dispatcher ------------------------------------------------------------------

export interface StepOptions {
  source?: number;
  target?: number;
}

/** Run one algorithm and collect its explicit animation step list. */
export function buildAlgorithmSteps(g: Graph, algo: GraphAlgorithm, opts: StepOptions = {}): GraphStep[] {
  const steps: GraphStep[] = [];
  const emit = (step: GraphStep): void => {
    if (steps.length < MAX_STEPS) steps.push(step);
  };
  const source = clampIndex(opts.source ?? 0, g.n);
  const target = clampIndex(opts.target ?? Math.max(0, g.n - 1), g.n);
  switch (algo) {
    case 'dijkstra':
      dijkstra(g, source, emit);
      break;
    case 'bellman-ford':
      bellmanFord(g, source, emit);
      break;
    case 'floyd-warshall':
      floydWarshall(g, emit, source);
      break;
    case 'prim':
      prim(g, source, emit);
      break;
    case 'kruskal':
      kruskal(g, emit);
      break;
    case 'ford-fulkerson':
      maxFlow(g, source, target, 'dfs', emit);
      break;
    case 'edmonds-karp':
      maxFlow(g, source, target, 'bfs', emit);
      break;
    case 'coloring':
      colorGraph(g, emit);
      break;
    case 'matching':
      bipartiteMatching(g, emit);
      break;
    case 'euler':
      detectEuler(g, emit);
      break;
    case 'hamilton':
      detectHamilton(g, emit);
      break;
  }
  if (steps.length === 0) {
    emit({ descEn: 'No steps recorded — empty graph', descZh: '未记录步骤 — 空图', nodes: [], edges: [] });
  }
  return steps;
}

// ---- built-in sample graphs -----------------------------------------------------------------

export interface SampleGraph {
  id: string;
  labelEn: string;
  labelZh: string;
  /** Text format used when the sample is serialized into the editor field. */
  format: ParseFormat;
  graph: Graph;
  /** Default source node index (shortest paths / flow). */
  source: number;
  /** Default sink node index (flow). */
  target: number;
  defaultAlgo: GraphAlgorithm;
}

/**
 * Built-in sample graphs: weighted undirected, weighted directed (including
 * a negative-weight digraph and a flow network), a bipartite instance and an
 * Euler/Hamilton demo. `source` / `target` / `defaultAlgo` seed the UI.
 */
export const SAMPLE_GRAPHS: SampleGraph[] = [
  {
    id: 'weighted-undirected',
    labelEn: 'Weighted undirected — Dijkstra reference (6 nodes)',
    labelZh: '带权无向图 — Dijkstra 参考图（6 节点）',
    format: 'edges',
    graph: {
      n: 6,
      directed: false,
      labels: ['A', 'B', 'C', 'D', 'E', 'F'],
      edges: [
        { u: 0, v: 1, w: 7 },
        { u: 0, v: 2, w: 9 },
        { u: 0, v: 5, w: 14 },
        { u: 1, v: 2, w: 10 },
        { u: 1, v: 3, w: 15 },
        { u: 2, v: 3, w: 11 },
        { u: 2, v: 5, w: 2 },
        { u: 3, v: 4, w: 6 },
        { u: 4, v: 5, w: 9 },
      ],
    },
    source: 0,
    target: 4,
    defaultAlgo: 'dijkstra',
  },
  {
    id: 'mst-reference',
    labelEn: 'MST reference — Prim vs Kruskal (9 nodes, Σ = 37)',
    labelZh: 'MST 参考图 — Prim 对照 Kruskal（9 节点，Σ = 37）',
    format: 'matrix',
    graph: {
      n: 9,
      directed: false,
      labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      edges: [
        { u: 0, v: 1, w: 4 },
        { u: 0, v: 7, w: 8 },
        { u: 1, v: 2, w: 8 },
        { u: 1, v: 7, w: 11 },
        { u: 2, v: 3, w: 7 },
        { u: 2, v: 8, w: 2 },
        { u: 2, v: 5, w: 4 },
        { u: 3, v: 4, w: 9 },
        { u: 3, v: 5, w: 14 },
        { u: 4, v: 5, w: 10 },
        { u: 5, v: 6, w: 2 },
        { u: 6, v: 7, w: 1 },
        { u: 6, v: 8, w: 6 },
        { u: 7, v: 8, w: 7 },
      ],
    },
    source: 0,
    target: 4,
    defaultAlgo: 'kruskal',
  },
  {
    id: 'flow-directed',
    labelEn: 'Flow network — directed, max flow = 7',
    labelZh: '最大流网络 — 有向，最大流 = 7',
    format: 'edges',
    graph: {
      n: 5,
      directed: true,
      labels: ['s', 'a', 'b', 'c', 't'],
      edges: [
        { u: 0, v: 1, w: 5 },
        { u: 0, v: 2, w: 4 },
        { u: 1, v: 2, w: 2 },
        { u: 1, v: 3, w: 6 },
        { u: 2, v: 3, w: 3 },
        { u: 3, v: 4, w: 7 },
      ],
    },
    source: 0,
    target: 4,
    defaultAlgo: 'edmonds-karp',
  },
  {
    id: 'negative-directed',
    labelEn: 'Negative weights (no cycle) — Bellman-Ford',
    labelZh: '负权图（无负环）— Bellman-Ford',
    format: 'edges',
    graph: {
      n: 5,
      directed: true,
      labels: ['s', 'v', 'w', 'x', 'y'],
      edges: [
        { u: 0, v: 1, w: 4 },
        { u: 0, v: 2, w: 5 },
        { u: 1, v: 2, w: -3 },
        { u: 1, v: 3, w: 7 },
        { u: 2, v: 3, w: 2 },
        { u: 3, v: 4, w: -2 },
      ],
    },
    source: 0,
    target: 4,
    defaultAlgo: 'bellman-ford',
  },
  {
    id: 'bipartite',
    labelEn: 'Bipartite — matching vs vertex cover (König)',
    labelZh: '二部图 — 最大匹配对照最小点覆盖（König）',
    format: 'matrix',
    graph: {
      n: 8,
      directed: false,
      labels: ['a', 'b', 'c', 'd', 'w', 'x', 'y', 'z'],
      edges: [
        { u: 0, v: 4, w: 1 },
        { u: 0, v: 5, w: 1 },
        { u: 1, v: 5, w: 1 },
        { u: 1, v: 6, w: 1 },
        { u: 2, v: 6, w: 1 },
        { u: 3, v: 6, w: 1 },
      ],
    },
    source: 0,
    target: 7,
    defaultAlgo: 'matching',
  },
  {
    id: 'euler-hamilton',
    labelEn: 'Euler path + Hamiltonian cycle (cycle with chord)',
    labelZh: '欧拉路径 + 哈密顿回路（带弦环）',
    format: 'matrix',
    graph: {
      n: 4,
      directed: false,
      labels: ['p', 'q', 'r', 's'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 1, v: 2, w: 1 },
        { u: 2, v: 3, w: 1 },
        { u: 3, v: 0, w: 1 },
        { u: 0, v: 2, w: 1 },
      ],
    },
    source: 0,
    target: 2,
    defaultAlgo: 'euler',
  },
];

export function getSampleGraph(id: string): SampleGraph | undefined {
  return SAMPLE_GRAPHS.find((s) => s.id === id);
}

// ---- embedded validation benchmarks ------------------------------------------------------------

export const GRAPH_BENCHMARK_ID = 'graph-benchmarks';

export interface GraphBenchmark {
  id: string;
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  passed: boolean;
}

/** Relative difference against an analytic reference (0 vs 0 counts as exact). */
function relErr(computed: number, reference: number): number {
  if (reference === 0) return computed === 0 ? 0 : Infinity;
  return Math.abs(computed - reference) / Math.abs(reference);
}

const TOL = 1e-12;

/**
 * Embedded validation suite (all references are hand-computed constants of
 * the built-in sample graphs; the unified error metric is
 * |computed − analytic|/|analytic|):
 *  1. Dijkstra vs Floyd-Warshall all-pairs distances on the weighted sample
 *     (integer weights → identical sums, relErr = 0).
 *  2. Prim vs Kruskal MST total weight against the known value 37.
 *  3. Edmonds-Karp (and Ford-Fulkerson) max flow against the known value 7,
 *     cross-checked with the residual min-cut capacity.
 *  4. Bellman-Ford distances on the negative-weight digraph against the
 *     hand-computed vector [0, 4, 1, 3, 1].
 *  5. König's theorem: maximum matching = minimum vertex cover = 3 on the
 *     sample bipartite graph.
 */
export function runGraphBenchmarks(): GraphBenchmark[] {
  const out: GraphBenchmark[] = [];
  const sp = getSampleGraph('weighted-undirected')!.graph;
  const mst = getSampleGraph('mst-reference')!.graph;
  const flow = getSampleGraph('flow-directed')!.graph;
  const neg = getSampleGraph('negative-directed')!.graph;
  const bip = getSampleGraph('bipartite')!.graph;

  // 1 — Dijkstra vs Floyd-Warshall (all pairs of the weighted sample).
  {
    const fw = floydWarshall(sp).dist;
    let err = 0;
    let mismatch = 0;
    let pairs = 0;
    for (let s = 0; s < sp.n; s += 1) {
      const d = dijkstra(sp, s).dist;
      for (let t = 0; t < sp.n; t += 1) {
        const a = d[t]!;
        const b = fw[s]![t]!;
        if (a === Infinity && b === Infinity) continue;
        pairs += 1;
        if (a === Infinity || b === Infinity) {
          mismatch += 1;
          err = Math.max(err, 1);
          continue;
        }
        err = Math.max(err, relErr(a, b));
      }
    }
    out.push({
      id: 'sp-pairs-consistency',
      labelZh: 'Dijkstra 与 Floyd-Warshall 全对最短路一致（relErr = 0）',
      labelEn: 'Dijkstra vs Floyd-Warshall all-pairs distances (relErr = 0)',
      relErr: err,
      passed: mismatch === 0 && err < TOL,
      detailZh: `${sp.n}×${sp.n} 个顶点对中 ${pairs} 对有限距离，最大相对差 = ${err.toExponential(2)}（整数权重，浮点求和完全一致）`,
      detailEn: `${pairs} finite pairs of ${sp.n}×${sp.n}, max relative difference = ${err.toExponential(2)} (integer weights, identical float sums)`,
    });
  }

  // 2 — Prim vs Kruskal against the known MST weight 37.
  {
    const p = prim(mst, 0);
    const k = kruskal(mst);
    const err = Math.max(relErr(p.total, 37), relErr(k.total, 37), relErr(p.total, k.total));
    out.push({
      id: 'mst-prim-kruskal',
      labelZh: 'Prim 与 Kruskal MST 总权一致且等于已知值 37',
      labelEn: 'Prim vs Kruskal MST total weight equals the known 37',
      relErr: err,
      passed: p.connected && k.connected && p.edges.length === mst.n - 1 && k.edges.length === mst.n - 1 && err < TOL,
      detailZh: `Prim = ${fmtNum(p.total)}，Kruskal = ${fmtNum(k.total)}，解析参考 = 37；均选入 ${mst.n - 1} 条边`,
      detailEn: `Prim = ${fmtNum(p.total)}, Kruskal = ${fmtNum(k.total)}, analytic reference = 37; both select ${mst.n - 1} edges`,
    });
  }

  // 3 — Edmonds-Karp / Ford-Fulkerson against the known max-flow value 7.
  {
    const ek = maxFlow(flow, 0, 4, 'bfs');
    const ff = maxFlow(flow, 0, 4, 'dfs');
    const err = Math.max(relErr(ek.value, 7), relErr(ff.value, 7), relErr(ek.cutCapacity, ek.value), relErr(ff.value, ek.value));
    out.push({
      id: 'maxflow-edmonds-karp',
      labelZh: 'Edmonds-Karp 最大流对照已知样例值 7（含最小割校验）',
      labelEn: 'Edmonds-Karp max flow vs the known sample value 7 (with min-cut check)',
      relErr: err,
      passed: err < TOL,
      detailZh: `Edmonds-Karp = ${fmtNum(ek.value)}（${ek.augmentations} 次增广，最小割容量 ${fmtNum(ek.cutCapacity)}），Ford-Fulkerson = ${fmtNum(ff.value)}，解析参考 = 7`,
      detailEn: `Edmonds-Karp = ${fmtNum(ek.value)} (${ek.augmentations} augmentations, min-cut capacity ${fmtNum(ek.cutCapacity)}), Ford-Fulkerson = ${fmtNum(ff.value)}, analytic reference = 7`,
    });
  }

  // 4 — Bellman-Ford on the negative-weight digraph vs [0, 4, 1, 3, 1].
  {
    const ref = [0, 4, 1, 3, 1];
    const r = bellmanFord(neg, 0);
    let err = 0;
    for (let i = 0; i < ref.length; i += 1) err = Math.max(err, relErr(r.dist[i]!, ref[i]!));
    const vector = r.dist.map((d) => fmtNum(d)).join(', ');
    out.push({
      id: 'bellman-ford-negative',
      labelZh: 'Bellman-Ford 负权图最短路对照已知值 [0, 4, 1, 3, 1]',
      labelEn: 'Bellman-Ford distances on negative weights vs [0, 4, 1, 3, 1]',
      relErr: err,
      passed: !r.negativeCycle && err < TOL,
      detailZh: `计算 = [${vector}]，解析参考 = [${ref.join(', ')}]，无负权环`,
      detailEn: `computed = [${vector}], analytic reference = [${ref.join(', ')}], no negative cycle`,
    });
  }

  // 5 — König's theorem: maximum matching equals the minimum vertex cover.
  {
    const m = bipartiteMatching(bip);
    const cover = konigVertexCover(bip, m.side, m.partner);
    let err = Math.max(relErr(m.size, 3), relErr(cover.length, m.size));
    // the cover must actually cover every edge
    const uncovered = bip.edges.filter((e) => !cover.includes(e.u) && !cover.includes(e.v)).length;
    if (uncovered > 0) err = Math.max(err, 1);
    out.push({
      id: 'konig-bipartite',
      labelZh: 'König 定理：二部图最大匹配 = 最小点覆盖（已知值 3）',
      labelEn: "König's theorem: maximum matching = minimum vertex cover (known value 3)",
      relErr: err,
      passed: m.bipartite && m.size === 3 && uncovered === 0 && err < TOL,
      detailZh: `最大匹配 = ${m.size}，König 点覆盖 = ${cover.length}（{${cover.map((i) => bip.labels[i]).join(', ')}}，未覆盖边 = ${uncovered}），解析参考 = 3`,
      detailEn: `maximum matching = ${m.size}, König vertex cover = ${cover.length} ({${cover.map((i) => bip.labels[i]).join(', ')}}), uncovered edges = ${uncovered}, analytic reference = 3`,
    });
  }

  return out;
}
