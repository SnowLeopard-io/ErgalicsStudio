// math-graph kernel tests — parser, shortest paths, MST, flow, coloring,
// matching, Euler/Hamilton trails, step lists and embedded benchmarks
import { describe, it, expect } from 'vitest';
import {
  GRAPH_BENCHMARK_ID,
  SAMPLE_GRAPHS,
  bipartiteMatching,
  bellmanFord,
  buildAlgorithmSteps,
  colorGraph,
  detectEuler,
  detectHamilton,
  dijkstra,
  edgeKey,
  floydWarshall,
  getSampleGraph,
  isBipartite,
  konigVertexCover,
  kruskal,
  layoutGraph,
  maxFlow,
  parseGraph,
  prim,
  runGraphBenchmarks,
  serializeGraph,
  type Graph,
  type GraphAlgorithm,
} from '../src/plugins/builtin/math/graph/kernel';

function mustParse(text: string, format: 'matrix' | 'edges'): Graph {
  const r = parseGraph(text, format);
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  return r.graph;
}

function edgeSet(g: Graph): Set<string> {
  return new Set(
    g.edges.map((e) => {
      const a = g.labels[e.u] ?? String(e.u);
      const b = g.labels[e.v] ?? String(e.v);
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
      return `${pair}@${e.w}`;
    }),
  );
}

describe('graph text parsing', () => {
  it('parses an adjacency matrix (lower/upper triangle, 0 = no edge)', () => {
    const g = mustParse('0 1 0; 1 0 2; 0 2 0', 'matrix');
    expect(g.n).toBe(3);
    expect(g.directed).toBe(false);
    expect(g.labels).toEqual(['0', '1', '2']);
    expect(g.edges).toEqual([
      { u: 0, v: 1, w: 1 },
      { u: 1, v: 2, w: 2 },
    ]);
  });

  it('honours # directed, # undirected and # labels directives', () => {
    const d = mustParse('# directed; 0 5 0; 0 0 3; 0 0 0', 'matrix');
    expect(d.directed).toBe(true);
    expect(d.edges).toEqual([
      { u: 0, v: 1, w: 5 },
      { u: 1, v: 2, w: 3 },
    ]);
    const l = mustParse('# labels s a t; 0 1 0; 0 0 2; 0 0 0', 'matrix');
    expect(l.labels).toEqual(['s', 'a', 't']);
    const u = mustParse('# undirected; 0 2; 2 0', 'matrix');
    expect(u.directed).toBe(false);
    expect(u.edges).toEqual([{ u: 0, v: 1, w: 2 }]);
  });

  it('parses edge lists with optional weights, arrows and comments', () => {
    const g = mustParse('# a comment; A B 7; B C; C A 2.5', 'edges');
    expect(g.n).toBe(3);
    expect(g.directed).toBe(false);
    expect(g.labels).toEqual(['A', 'B', 'C']);
    expect(g.edges).toEqual([
      { u: 0, v: 1, w: 7 },
      { u: 1, v: 2, w: 1 },
      { u: 2, v: 0, w: 2.5 },
    ]);
    const d = mustParse('s -> t 5; s -> a 4', 'edges');
    expect(d.directed).toBe(true);
    expect(d.n).toBe(3);
    expect(d.edges[0]).toEqual({ u: 0, v: 1, w: 5 });
  });

  it('rejects malformed input with a descriptive error', () => {
    expect(parseGraph('# only a comment', 'edges').ok).toBe(false);
    expect(parseGraph('0 1; 1 0 0', 'matrix').ok).toBe(false);
    expect(parseGraph('0 x; 1 0', 'matrix').ok).toBe(false);
    expect(parseGraph('A A 4', 'edges').ok).toBe(false);
    expect(parseGraph('A B abc', 'edges').ok).toBe(false);
    expect(parseGraph('A B 1 2 3', 'edges').ok).toBe(false);
    expect(parseGraph('', 'matrix').ok).toBe(false);
  });

  it('round-trips every sample through serialize + parse', () => {
    for (const s of SAMPLE_GRAPHS) {
      const text = serializeGraph(s.graph, s.format);
      expect(text, s.id).not.toContain('\n');
      const again = mustParse(text, s.format);
      expect(again.n, s.id).toBe(s.graph.n);
      expect(again.directed, s.id).toBe(s.graph.directed);
      expect(again.labels.slice().sort(), s.id).toEqual(s.graph.labels.slice().sort());
      expect(edgeSet(again), s.id).toEqual(edgeSet(s.graph));
    }
  });
});

describe('shortest paths', () => {
  const sp = getSampleGraph('weighted-undirected')!.graph; // CLRS figure, source A

  it('Dijkstra reproduces the hand-computed distances [0, 7, 9, 20, 20, 11]', () => {
    const r = dijkstra(sp, 0);
    expect(r.source).toBe(0);
    expect(r.dist).toEqual([0, 7, 9, 20, 20, 11]);
    expect(r.settle).toHaveLength(sp.n);
    expect(r.negativeCycle).toBe(false);
    // reconstruct A -> E: A-C-F-E with total 20
    const path: number[] = [];
    for (let v = 4; v >= 0; v = r.prev[v]!) {
      path.push(v);
      if (r.prev[v] === -1) break;
    }
    path.reverse();
    expect(path.map((i) => sp.labels[i])).toEqual(['A', 'C', 'F', 'E']);
    expect(r.dist[4]).toBe(20);
  });

  it('Floyd-Warshall agrees with Dijkstra on every source row', () => {
    const fw = floydWarshall(sp).dist;
    for (let s = 0; s < sp.n; s += 1) {
      expect(dijkstra(sp, s).dist, `source ${s}`).toEqual(fw[s]);
    }
  });

  it('Bellman-Ford handles negative weights without a negative cycle', () => {
    const neg = getSampleGraph('negative-directed')!.graph;
    const r = bellmanFord(neg, 0);
    expect(r.dist).toEqual([0, 4, 1, 3, 1]);
    expect(r.negativeCycle).toBe(false);
  });

  it('flags a reachable negative cycle', () => {
    const g: Graph = {
      n: 3,
      directed: true,
      labels: ['a', 'b', 'c'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 1, v: 2, w: -3 },
        { u: 2, v: 1, w: 1 },
      ],
    };
    expect(bellmanFord(g, 0).negativeCycle).toBe(true);
  });
});

describe('minimum spanning trees', () => {
  const mst = getSampleGraph('mst-reference')!.graph; // CLRS MST figure, Σ = 37

  it('Prim and Kruskal both return the known weight 37 with n−1 edges', () => {
    const p = prim(mst, 0);
    const k = kruskal(mst);
    expect(p.connected).toBe(true);
    expect(k.connected).toBe(true);
    expect(p.edges).toHaveLength(mst.n - 1);
    expect(k.edges).toHaveLength(mst.n - 1);
    expect(p.total).toBe(37);
    expect(k.total).toBe(37);
  });

  it('reports a spanning forest when the graph is disconnected', () => {
    const g: Graph = {
      n: 4,
      directed: false,
      labels: ['a', 'b', 'c', 'd'],
      edges: [
        { u: 0, v: 1, w: 2 },
        { u: 2, v: 3, w: 5 },
      ],
    };
    const r = prim(g, 0);
    expect(r.connected).toBe(false);
    expect(r.edges).toHaveLength(1); // Prim only spans the start component
    expect(r.total).toBe(2);
  });
});

describe('maximum flow', () => {
  const flow = getSampleGraph('flow-directed')!.graph; // known max flow = 7

  it('Edmonds-Karp and Ford-Fulkerson both reach the known value 7', () => {
    const ek = maxFlow(flow, 0, 4, 'bfs');
    const ff = maxFlow(flow, 0, 4, 'dfs');
    expect(ek.value).toBe(7);
    expect(ff.value).toBe(7);
    expect(ek.cutCapacity).toBe(ek.value);
    expect(ff.cutCapacity).toBe(ff.value);
    expect(ek.augmentations).toBeGreaterThan(0);
  });

  it('reports a minimum cut separating the source from the sink', () => {
    const r = maxFlow(flow, 0, 4, 'bfs');
    expect(r.reachable[0]).toBe(true);
    expect(r.reachable[4]).toBe(false);
    const cut = flow.edges.filter((e) => r.reachable[e.u] && !r.reachable[e.v]);
    const cap = cut.reduce((acc, e) => acc + e.w, 0);
    expect(cap).toBe(7);
  });

  it('conserves flow: the source nets exactly the flow value', () => {
    const r = maxFlow(flow, 0, 4, 'bfs');
    let net = 0;
    flow.edges.forEach((e, i) => {
      if (e.u === 0) net += r.flow[i]!;
      if (e.v === 0) net -= r.flow[i]!;
    });
    expect(net).toBe(r.value);
  });
});

describe('coloring and bipartite matching', () => {
  it('produces a proper greedy coloring (adjacent nodes differ)', () => {
    for (const s of SAMPLE_GRAPHS) {
      const r = colorGraph(s.graph);
      expect(r.colors.every((c) => c >= 0), s.id).toBe(true);
      expect(r.used, s.id).toBeGreaterThanOrEqual(1);
      for (const e of s.graph.edges) {
        expect(r.colors[e.u], `${s.id} edge ${e.u}-${e.v}`).not.toBe(r.colors[e.v]);
      }
    }
    // triangle needs three colours
    const k3: Graph = {
      n: 3,
      directed: false,
      labels: ['a', 'b', 'c'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 1, v: 2, w: 1 },
        { u: 0, v: 2, w: 1 },
      ],
    };
    expect(colorGraph(k3).used).toBe(3);
    expect(isBipartite(k3).bipartite).toBe(false);
  });

  it('finds the maximum matching of size 3 and the König cover', () => {
    const bip = getSampleGraph('bipartite')!.graph;
    const m = bipartiteMatching(bip);
    expect(m.bipartite).toBe(true);
    expect(m.size).toBe(3);
    // matching pairs are mutually consistent
    m.partner.forEach((p, i) => {
      if (p >= 0) expect(m.partner[p]).toBe(i);
    });
    const cover = konigVertexCover(bip, m.side, m.partner);
    expect(cover).toHaveLength(m.size);
    const uncovered = bip.edges.filter((e) => !cover.includes(e.u) && !cover.includes(e.v));
    expect(uncovered).toHaveLength(0);
  });

  it('rejects matching on a non-bipartite graph', () => {
    const k3: Graph = {
      n: 3,
      directed: false,
      labels: ['a', 'b', 'c'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 1, v: 2, w: 1 },
        { u: 0, v: 2, w: 1 },
      ],
    };
    const m = bipartiteMatching(k3);
    expect(m.bipartite).toBe(false);
    expect(m.size).toBe(0);
  });
});

describe('Euler and Hamiltonian trails', () => {
  const sample = getSampleGraph('euler-hamilton')!.graph; // cycle p-q-r-s with chord p-r

  it('detects an Euler path (exactly two odd-degree nodes) and traces every edge', () => {
    const r = detectEuler(sample);
    expect(r.kind).toBe('path');
    expect(r.connected).toBe(true);
    expect(r.odd.sort((a, b) => a - b)).toEqual([0, 2]); // p and r
    expect(r.path).toHaveLength(sample.edges.length + 1);
    // every consecutive pair of the trail is an edge of the graph
    const pairs = new Set(
      sample.edges.flatMap((e) => [edgeKey(e.u, e.v), edgeKey(e.v, e.u)]),
    );
    for (let i = 1; i < r.path.length; i += 1) {
      expect(pairs.has(edgeKey(r.path[i - 1]!, r.path[i]!))).toBe(true);
    }
  });

  it('detects an Euler circuit when every degree is even', () => {
    const g: Graph = {
      n: 3,
      directed: true,
      labels: ['a', 'b', 'c'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 1, v: 2, w: 1 },
        { u: 2, v: 0, w: 1 },
      ],
    };
    const r = detectEuler(g);
    expect(r.kind).toBe('circuit');
    expect(r.path).toHaveLength(4);
    expect(r.odd).toHaveLength(0);
  });

  it('reports no Euler trail with four odd-degree nodes', () => {
    const star: Graph = {
      n: 4,
      directed: false,
      labels: ['c', 'l1', 'l2', 'l3'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 0, v: 2, w: 1 },
        { u: 0, v: 3, w: 1 },
      ],
    };
    expect(detectEuler(star).kind).toBe('none');
  });

  it('finds a Hamiltonian cycle in the sample and none in a star', () => {
    const h = detectHamilton(sample);
    expect(h.exists).toBe(true);
    expect(h.cycle).toBe(true);
    expect(h.path).toHaveLength(sample.n);
    expect(new Set(h.path).size).toBe(sample.n);

    const star: Graph = {
      n: 4,
      directed: false,
      labels: ['c', 'l1', 'l2', 'l3'],
      edges: [
        { u: 0, v: 1, w: 1 },
        { u: 0, v: 2, w: 1 },
        { u: 0, v: 3, w: 1 },
      ],
    };
    const none = detectHamilton(star);
    expect(none.exists).toBe(false);
    expect(none.path).toHaveLength(0);
  });
});

describe('deterministic layout', () => {
  it('keeps every node inside the box and is reproducible', () => {
    for (const s of SAMPLE_GRAPHS) {
      const a = layoutGraph(s.graph, 760, 420);
      expect(a, s.id).toHaveLength(s.graph.n);
      const b = layoutGraph(s.graph, 760, 420);
      for (let i = 0; i < a.length; i += 1) {
        const p = a[i]!;
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), s.id).toBe(true);
        expect(p.x >= 0 && p.x <= 760, `${s.id} x = ${p.x}`).toBe(true);
        expect(p.y >= 0 && p.y <= 420, `${s.id} y = ${p.y}`).toBe(true);
        expect(b[i]!.x, s.id).toBe(p.x);
        expect(b[i]!.y, s.id).toBe(p.y);
      }
    }
  });
});

describe('step-by-step animation records', () => {
  const algos: GraphAlgorithm[] = [
    'dijkstra',
    'bellman-ford',
    'floyd-warshall',
    'prim',
    'kruskal',
    'ford-fulkerson',
    'edmonds-karp',
    'coloring',
    'matching',
    'euler',
    'hamilton',
  ];

  it('produces valid non-empty step lists for every sample and algorithm', () => {
    for (const s of SAMPLE_GRAPHS) {
      for (const algo of algos) {
        const steps = buildAlgorithmSteps(s.graph, algo, { source: s.source, target: s.target });
        const tag = `${s.id}/${algo}`;
        expect(steps.length, tag).toBeGreaterThanOrEqual(1);
        expect(steps.length, tag).toBeLessThanOrEqual(400);
        for (const st of steps) {
          expect(st.descEn.length, tag).toBeGreaterThan(0);
          expect(st.descZh.length, tag).toBeGreaterThan(0);
          for (const v of st.nodes) {
            expect(v, tag).toBeGreaterThanOrEqual(0);
            expect(v, tag).toBeLessThan(s.graph.n);
          }
          for (const [u, v] of st.edges) {
            expect(u, tag).toBeGreaterThanOrEqual(0);
            expect(u, tag).toBeLessThan(s.graph.n);
            expect(v, tag).toBeGreaterThanOrEqual(0);
            expect(v, tag).toBeLessThan(s.graph.n);
          }
          if (st.labels) expect(st.labels, tag).toHaveLength(s.graph.n);
        }
        // A truncated long search (400-step cap) records no closing step.
        if (steps.length < 400) {
          expect(steps.some((st) => st.final), `${tag} has a final step`).toBe(true);
        }
      }
    }
  });
});

describe('embedded validation benchmarks', () => {
  it('exposes the graph-benchmarks suite id', () => {
    expect(GRAPH_BENCHMARK_ID).toBe('graph-benchmarks');
  });

  it('passes all five benchmarks with the unified relative error', () => {
    const bench = runGraphBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'sp-pairs-consistency',
      'mst-prim-kruskal',
      'maxflow-edmonds-karp',
      'bellman-ford-negative',
      'konig-bipartite',
    ]);
    for (const b of bench) {
      expect(b.passed, b.id).toBe(true);
      expect(b.relErr, b.id).toBeLessThan(1e-12);
      expect(b.labelZh.length, b.id).toBeGreaterThan(0);
      expect(b.labelEn.length, b.id).toBeGreaterThan(0);
      expect(b.detailZh.length, b.id).toBeGreaterThan(0);
      expect(b.detailEn.length, b.id).toBeGreaterThan(0);
    }
  });

  it('resolves known sample ids and rejects unknown ones', () => {
    expect(getSampleGraph('flow-directed')).toBeDefined();
    expect(getSampleGraph('missing-graph')).toBeUndefined();
    expect(SAMPLE_GRAPHS).toHaveLength(6);
  });
});
