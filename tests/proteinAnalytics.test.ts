import { describe, expect, it } from 'vitest';
import {
  analyzeNetwork,
  assignHubs,
  buildAdjacency,
  clusteringCoefficients,
  components,
  degreeAssortativity,
  louvain,
} from '../src/plugins/builtin/proteinAnalytics';

/** Two tightly connected cliques joined by a single weak bridge: Louvain
 *  should recover exactly two dense communities with positive modularity. */
const TWO_CLIQUES: Array<{ a: number; b: number; weight: number }> = [
  // clique A: nodes 0..4 fully connected
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
  // clique B: nodes 5..9 fully connected
  [5, 6], [5, 7], [5, 8], [5, 9], [6, 7], [6, 8], [6, 9], [7, 8], [7, 9], [8, 9],
  // single weak bridge
  [0, 5, 1],
].map(([a, b, w = 1]) => ({ a: a as number, b: b as number, weight: w }));

describe('proteinAnalytics kernel', () => {
  it('buildAdjacency sums duplicate edges and drops self-loops', () => {
    const { adj, m } = buildAdjacency(3, [
      { a: 0, b: 1, weight: 2 },
      { a: 1, b: 0, weight: 3 },
      { a: 2, b: 2, weight: 9 }, // self-loop dropped
    ]);
    expect(m).toBe(5);
    expect(adj[0]).toEqual(expect.arrayContaining([{ j: 1, w: 5 }]));
    expect(adj[1]).toEqual(expect.arrayContaining([{ j: 0, w: 5 }]));
    expect(adj[2]).toHaveLength(0);
  });

  it('Louvain recovers two cliques with positive modularity', () => {
    const { community, q } = louvain(10, TWO_CLIQUES);
    expect(q).toBeGreaterThan(0.3);
    const c0 = community.slice(0, 5);
    const c1 = community.slice(5, 10);
    // each clique is internally consistent and the two are distinct
    expect(new Set(c0).size).toBe(1);
    expect(new Set(c1).size).toBe(1);
    expect(c0[0]).not.toBe(c1[0]);
  });

  it('Louvain is deterministic for the same input', () => {
    const a = louvain(10, TWO_CLIQUES);
    const b = louvain(10, TWO_CLIQUES);
    expect(a.community).toEqual(b.community);
    expect(a.q).toBeCloseTo(b.q, 12);
  });

  it('a path graph is weakly modular (Q well below a clique pair)', () => {
    const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]].map(([a, b]) => ({ a: a as number, b: b as number, weight: 1 }));
    const p = louvain(6, edges);
    const cliquePair = louvain(10, TWO_CLIQUES);
    // paths resolve to a few communities with modest modularity, far below the
    // tightly-clustered two-clique case, and never degenerate to one giant blob
    expect(p.q).toBeGreaterThanOrEqual(0);
    expect(p.q).toBeLessThan(cliquePair.q - 0.1);
    expect(p.q).toBeLessThan(0.4);
    // a node-less / edge-less graph is trivially 0
    expect(louvain(3, []).q).toBe(0);
  });

  it('hub ranking flags the high-degree bridge node', () => {
    const hubs = assignHubs(
      5,
      [
        { a: 0, b: 1, weight: 1 },
        { a: 0, b: 2, weight: 1 },
        { a: 0, b: 3, weight: 1 },
        { a: 0, b: 4, weight: 1 },
        { a: 1, b: 2, weight: 1 },
      ],
      [
        { id: 'p0', name: 'P0' },
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
        { id: 'p3', name: 'P3' },
        { id: 'p4', name: 'P4' },
      ],
    );
    expect(hubs.length).toBeGreaterThan(0);
    expect(hubs[0]!.id).toBe('p0');
    expect(hubs[0]!.degree).toBeGreaterThanOrEqual(4);
  });

  it('clustering coefficient is 1 for a triangle and 0 for a star leaf', () => {
    // triangle 0-1-2 (node 0 is fully embedded); node 3 hangs off node 0
    const cc = clusteringCoefficients(4, [
      { a: 0, b: 1, weight: 1 },
      { a: 0, b: 2, weight: 1 },
      { a: 1, b: 2, weight: 1 },
      { a: 0, b: 3, weight: 1 },
    ]);
    expect(cc[0]).toBeCloseTo(1 / 3, 9); // 1 triangle among its 3 neighbour pairs
    expect(cc[1]).toBeCloseTo(1, 9); // neighbours 0,2 are linked
    expect(cc[3]).toBe(0); // single neighbour
  });

  it('a hub-to-leaf network is disassortative, two uniform blocks assortative', () => {
    // hub node 0 touching many leaves → negative assortativity (r ≈ −0.71)
    const hubLeaf = degreeAssortativity(6, [
      { a: 0, b: 1, weight: 1 },
      { a: 0, b: 2, weight: 1 },
      { a: 0, b: 3, weight: 1 },
      { a: 1, b: 2, weight: 1 },
      { a: 1, b: 3, weight: 1 },
      { a: 2, b: 3, weight: 1 },
      { a: 3, b: 4, weight: 1 },
      { a: 3, b: 5, weight: 1 },
    ]);
    expect(hubLeaf).toBeLessThan(0);

    // two internally-uniform blocks (K4 all degree 3, K2 all degree 1), no
    // cross edges → r = 1 exactly (edges connect equal-degree nodes only)
    const blocks = degreeAssortativity(6, [
      { a: 0, b: 1, weight: 1 }, { a: 0, b: 2, weight: 1 }, { a: 0, b: 3, weight: 1 },
      { a: 1, b: 2, weight: 1 }, { a: 1, b: 3, weight: 1 }, { a: 2, b: 3, weight: 1 },
      { a: 4, b: 5, weight: 1 },
    ]);
    expect(blocks).toBeCloseTo(1, 6);
  });

  it('components splits a genuinely disconnected graph', () => {
    // remove the weak bridge → the two cliques become two components
    const disconnected = TWO_CLIQUES.filter((e) => !(e.a === 0 && e.b === 5));
    const c = components(10, disconnected);
    expect(c.components).toBe(2);
    expect(c.maxComponent).toBe(5);
  });

  it('analyzeNetwork returns a coherent, complete report', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, name: `P${i}` }));
    const r = analyzeNetwork(nodes, TWO_CLIQUES);
    expect(r.n).toBe(10);
    expect(r.modularity).toBeGreaterThan(0.3);
    expect(r.numCommunities).toBeGreaterThan(1);
    expect(r.community).toHaveLength(10);
    expect(r.hubs.length).toBeGreaterThan(0);
    expect(r.meanDegree).toBeGreaterThan(0);
    expect(r.m).toBeGreaterThan(0);
    expect(r.communities.length).toBeGreaterThan(1);
  });
});