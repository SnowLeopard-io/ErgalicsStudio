import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/repro/random';
import {
  SNA_KNOWN_GRAPH,
  burtConstraint,
  brokerageScore,
  buildGraph,
  classifyStructure,
  closenessCentrality,
  computeMeasure,
  degreeCentrality,
  eigenvectorCentrality,
  findBridges,
  forceLayout,
  girvanNewman,
  graphDensity,
  labelPropagation,
  louvainCommunities,
  makeIndependentCascade,
  makeLinearThreshold,
  modularity,
  pagerankCentrality,
  parseEdgeList,
  pathGraph,
  plantedPartitionGraph,
  randomGraph,
  runCascadeToCompletion,
  runSnaBenchmark,
  starGraph,
  betweennessCentrality,
} from '../src/plugins/builtin/socio/sna/kernel';
import { snaFigurePanels } from '../src/plugins/builtin/socio/sna/figure';
import { snaManifest } from '../src/plugins/builtin/socio/sna/manifest';

const knownEdges = SNA_KNOWN_GRAPH.edges.map(([u, v]) => ({ source: u, target: v, weight: 1 }));
const knownGraph = buildGraph(SNA_KNOWN_GRAPH.n, knownEdges, false);

describe('socio-sna kernel · graph construction', () => {
  it('builds a symmetric CSR adjacency for undirected graphs', () => {
    const g = knownGraph;
    expect(g.n).toBe(6);
    expect(g.edgeCount).toBe(7);
    expect(g.m).toBe(14); // both directions
    for (let a = 0; a < g.m; a += 1) {
      const u = g.sources[a]!;
      const v = g.targets[a]!;
      // symmetric weight
      let found = 0;
      for (let b = 0; b < g.m; b += 1) {
        if (g.sources[b] === v && g.targets[b] === u) found = g.weights[b]!;
      }
      expect(found).toBe(g.weights[a]!);
    }
  });

  it('merges duplicate edges and drops self-loops and non-positive weights', () => {
    const g = buildGraph(
      3,
      [
        { source: 0, target: 1, weight: 1 },
        { source: 1, target: 0, weight: 2 },
        { source: 1, target: 1, weight: 5 },
        { source: 1, target: 2, weight: 0 },
      ],
      false,
    );
    expect(g.edgeCount).toBe(1);
    expect(g.weights[0]).toBe(3);
  });

  it('parses networkGraph-compatible CSV and JSON edge lists', () => {
    const csv = parseEdgeList('source,target,weight\nalice,bob,2\nbob,carol');
    expect(csv.labels).toEqual(['alice', 'bob', 'carol']);
    expect(csv.edges).toEqual([
      { source: 0, target: 1, weight: 2 },
      { source: 1, target: 2, weight: 1 },
    ]);
    const json = parseEdgeList(
      '{"nodes":[{"id":"a"},{"id":"b"}],"edges":[{"source":"a","target":"b","weight":3}]}',
    );
    expect(json.labels).toEqual(['a', 'b']);
    expect(json.edges).toEqual([{ source: 0, target: 1, weight: 3 }]);
  });
});

describe('socio-sna kernel · centrality', () => {
  it('star-graph betweenness: hub = n-1 (K1,3), leaves = 0; K1,7 hub = 15', () => {
    const bc3 = betweennessCentrality(buildGraph(4, starGraph(4), false));
    expect(bc3[0]).toBeCloseTo(3, 9);
    expect(bc3.slice(1).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    const bc7 = betweennessCentrality(buildGraph(7, starGraph(7), false));
    expect(bc7[0]).toBeCloseTo(15, 9);
    expect(bc7.slice(1).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('path-graph closeness is exact (P5: centre 2/3, end 0.4, second 4/7)', () => {
    const cc = closenessCentrality(buildGraph(5, pathGraph(5), false));
    expect(cc[2]!).toBeCloseTo(2 / 3, 9);
    expect(cc[0]!).toBeCloseTo(0.4, 9);
    expect(cc[1]!).toBeCloseTo(4 / 7, 9);
  });

  it('matches the hand-computed betweenness on the reference graph', () => {
    const bc = betweennessCentrality(knownGraph);
    SNA_KNOWN_GRAPH.betweenness.forEach((want, i) => expect(bc[i]).toBeCloseTo(want, 9));
  });

  it('degree centrality counts incident weight once (undirected)', () => {
    const deg = degreeCentrality(knownGraph);
    expect(deg).toEqual([2, 3, 3, 3, 2, 1]);
  });

  it('eigenvector centrality: star hub dominates all leaves (shifted power iteration)', () => {
    const ev = eigenvectorCentrality(buildGraph(7, starGraph(7), false));
    expect(ev[0]!).toBeGreaterThan(ev[1]!);
    for (let i = 2; i < 7; i += 1) expect(ev[i]).toBeCloseTo(ev[1]!, 6);
  });

  it('PageRank sums to 1 and ranks the star hub first', () => {
    const pr = pagerankCentrality(knownGraph);
    expect(pr.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const star = pagerankCentrality(buildGraph(7, starGraph(7), false));
    expect(star[0]).toBeGreaterThan(star[1]!);
  });

  it('computeMeasure dispatches all five kinds with finite values', () => {
    for (const kind of ['degree', 'betweenness', 'closeness', 'eigenvector', 'pagerank'] as const) {
      const vals = computeMeasure(knownGraph, kind);
      expect(vals).toHaveLength(6);
      expect(vals.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('socio-sna kernel · communities', () => {
  it('Louvain recovers the 2-block planted partition exactly', () => {
    const n = 16;
    const g = buildGraph(n, plantedPartitionGraph(n), false);
    const truth = Array.from({ length: n }, (_, i) => (i < 8 ? 0 : 1));
    const res = louvainCommunities(g, 11);
    expect(res.communities).toBe(2);
    for (let i = 0; i < 8; i += 1) {
      expect(res.communityOf[i]).toBe(res.communityOf[(i + 1) % 8]); // first block coherent
      expect(res.communityOf[i]).not.toBe(res.communityOf[8 + i]); // blocks differ
    }
    expect(res.modularity).toBeGreaterThanOrEqual(modularity(g, truth) - 1e-9);
  });

  it('label propagation keeps the planted blocks coherent', () => {
    const n = 16;
    const g = buildGraph(n, plantedPartitionGraph(n), false);
    const labels = labelPropagation(g, 11);
    for (let i = 0; i < 8; i += 1) expect(labels[i]).toBe(labels[(i + 1) % 8]);
    expect(labels[0]).not.toBe(labels[8]);
  });

  it('Girvan-Newman peels the bridge first; a bridge chain yields 3 communities in 2 steps', () => {
    // Reference graph: the highest edge betweenness is the bridge 3-4 (8 pairs cross it).
    const res1 = girvanNewman(knownGraph, 1);
    expect(res1.removed[0]).toEqual({ u: 3, v: 4, betweenness: 8 });
    expect(res1.communities).toBe(2);
    // On a bridge chain P4 each step cuts the current max-betweenness edge,
    // so two steps split the graph into 3 communities.
    const chain = buildGraph(4, pathGraph(4), false);
    const res2 = girvanNewman(chain, 2);
    expect(res2.communities).toBe(3);
    expect(res2.removed[0]).toEqual({ u: 1, v: 2, betweenness: 4 });
    expect(res2.communityOf[0]).not.toBe(res2.communityOf[1]);
    expect(res2.communityOf[2]).toBe(res2.communityOf[3]);
  });
});

describe('socio-sna kernel · influence cascades', () => {
  it('independent cascade: p=0 stays at the seed, p=1 floods the component', () => {
    const g = knownGraph;
    const p0 = runCascadeToCompletion(makeIndependentCascade(g, [0], 0, 42));
    expect(p0).toEqual([1]);
    const p1 = runCascadeToCompletion(makeIndependentCascade(g, [0], 1, 42));
    expect(p1[p1.length - 1]).toBe(6);
    expect(p1[0]).toBe(1);
  });

  it('cascade series are monotone and bounded by n', () => {
    const g = buildGraph(20, randomGraph(20, 3, mulberry32(7)), false);
    for (const p of [0.2, 0.5, 0.9]) {
      const s = runCascadeToCompletion(makeIndependentCascade(g, [0], p, 42));
      expect(s[0]).toBe(1);
      expect(s.every((v) => v >= 1 && v <= 20)).toBe(true);
      expect(s.every((v, i) => i === 0 || v >= s[i - 1]!)).toBe(true);
    }
  });

  it('linear threshold: tiny thresholds flood the star, huge ones stop at the seed', () => {
    const g = buildGraph(7, starGraph(7), false);
    const easy = runCascadeToCompletion(makeLinearThreshold(g, [0], 0.001, 42));
    expect(easy[easy.length - 1]).toBe(7);
    const hard = runCascadeToCompletion(makeLinearThreshold(g, [1], 2.5, 42));
    expect(hard).toEqual([1]);
  });

  it('same seed reproduces cascades exactly', () => {
    const a = runCascadeToCompletion(makeIndependentCascade(knownGraph, [0], 0.4, 9));
    const b = runCascadeToCompletion(makeIndependentCascade(knownGraph, [0], 0.4, 9));
    expect(a).toEqual(b);
  });
});

describe('socio-sna kernel · structural holes', () => {
  it('Burt constraint: star hub is far less constrained than its leaves', () => {
    const c = burtConstraint(buildGraph(7, starGraph(7), false));
    expect(c[0]!).toBeCloseTo(1 / 6, 9);
    expect(c[1]!).toBeCloseTo(1, 9);
    expect(c[0]!).toBeLessThan(c[1]!);
  });

  it('brokerage: star hub spans every hole, leaves none', () => {
    const b = brokerageScore(buildGraph(7, starGraph(7), false));
    expect(b[0]).toBeCloseTo(1, 9);
    expect(b[1]).toBe(0);
  });

  it('bridge detection finds exactly the cut edges of the reference graph', () => {
    const bridges = findBridges(knownGraph);
    expect(bridges).toContainEqual({ u: 3, v: 4 });
    expect(bridges).toContainEqual({ u: 4, v: 5 });
    expect(bridges).toHaveLength(2);
  });
});

describe('socio-sna kernel · misc', () => {
  it('density follows 2m/(n(n-1)) for undirected graphs', () => {
    expect(graphDensity(knownGraph)).toBeCloseTo(14 / 30, 9);
    expect(graphDensity(buildGraph(7, starGraph(7), false))).toBeCloseTo(12 / 42, 9);
  });

  it('layout is deterministic and inside the requested frame', () => {
    const a = forceLayout(knownGraph, 400, 300, 5);
    const b = forceLayout(knownGraph, 400, 300, 5);
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
  });

  it('structure verdict thresholds follow the share bands', () => {
    expect(classifyStructure(0.5).key).toBe('hub-dominated');
    expect(classifyStructure(0.2).key).toBe('heterogeneous');
    expect(classifyStructure(0.05).key).toBe('decentralized');
  });

  it('embedded benchmark passes in full', () => {
    const b = runSnaBenchmark();
    expect(b).toMatchObject({
      starBetweenness: true,
      pathCloseness: true,
      knownBetweennessErr: 0,
      brandesMatchesBruteForce: true,
      pagerankSumsTo1: true,
      louvainPlantedRecovery: true,
      cascadeBounds: true,
      deterministic: true,
    });
    expect(b.pass).toBe(true);
  });
});

describe('socio-sna figure panels & manifest', () => {
  it('produces bar / line / field panels with consistent geometry', () => {
    const n = 6;
    const adjacency = new Array<number>(n * n).fill(0);
    for (let a = 0; a < knownGraph.m; a += 1) adjacency[knownGraph.sources[a]! * n + knownGraph.targets[a]!] = knownGraph.weights[a]!;
    const labels = Array.from({ length: n }, (_, i) => `n${i}`);
    const panels = snaFigurePanels({
      labels,
      adjacency,
      n,
      communityOf: [0, 0, 0, 0, 1, 1],
      ranked: [
        { id: 3, value: 6 },
        { id: 4, value: 4 },
        { id: 1, value: 1.5 },
      ],
      cascadeSeries: [1, 3, 4, 6],
    });
    expect(panels.map((p) => p.spec.series[0]!.kind)).toEqual(['bar', 'line', 'field']);
    const field = panels[2]!.spec.series[0]!.field!;
    expect(field.rows).toBe(field.cols);
    expect(field.values).toHaveLength(field.rows * field.cols);
    expect(panels[0]!.spec.series[0]!.bars).toHaveLength(3);
    expect(panels[1]!.spec.series[0]!.points![3]!.y).toBeCloseTo(1, 9);
  });

  it('the manifest declares quasi-research tier, benchmarks and formats', () => {
    expect(snaManifest.id).toBe('example.socio-sna');
    expect(snaManifest.name).toBe('Social Network Analyzer');
    expect(snaManifest.nameI18n?.['zh-CN']).toBe('社会网络分析器');
    expect(snaManifest.research?.tier).toBe('quasi-research');
    expect(snaManifest.research?.reproducible).toBe(true);
    expect(snaManifest.research?.benchmarks).toEqual(['centrality-exact', 'louvain-known-communities']);
    expect(snaManifest.formats?.map((f) => f.extension)).toEqual(['.csv', '.json']);
    expect(snaManifest.signature?.alg).toBe('ed25519');
  });
});
