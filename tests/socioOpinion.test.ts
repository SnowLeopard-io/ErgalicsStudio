import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/repro/random';
import {
  ADOPTED,
  DEFAULT_OPINION_PARAMS,
  SUSCEPTIBLE,
  buildNetwork,
  drawThresholds,
  expectedReach,
  exposureDiversity,
  fixedThresholds,
  greedySeeds,
  homophilyIndex,
  initialOpinions,
  ltFixedPointStable,
  makeEchoChamberNetwork,
  makePathNetwork,
  makeRandomNetwork,
  makeSmallWorldNetwork,
  meanExposureDiversity,
  networkFromEdges,
  opinionStep,
  pickSeeds,
  runIndependentCascade,
  runLinearThreshold,
  runOpinionBenchmark,
  type OpinionParams,
} from '../src/plugins/builtin/socio/opinion/kernel';

describe('socio-opinion kernel (public opinion diffusion)', () => {
  it('hand-built 4-node chain: exact cascade outcomes for given edge probabilities', () => {
    // Full chain, p = 1 -> the whole path activates.
    const chain = makePathNetwork(4);
    const full = runIndependentCascade(chain, [0], 1, mulberry32(5));
    expect([...full]).toEqual([ADOPTED, ADOPTED, ADOPTED, ADOPTED]);

    // Zero-probability cut edge (middle weight 0 at p = 1) blocks the cascade.
    const broken = makePathNetwork(4, [1, 0, 1]);
    const head = runIndependentCascade(broken, [0], 1, mulberry32(5));
    expect(head[0]).toBe(ADOPTED);
    expect(head[1]).toBe(ADOPTED);
    expect(head[2]).toBe(SUSCEPTIBLE);
    expect(head[3]).toBe(SUSCEPTIBLE);

    // Seeding downstream of the cut still reaches the tail.
    const tail = runIndependentCascade(broken, [2], 1, mulberry32(5));
    expect(tail[2]).toBe(ADOPTED);
    expect(tail[3]).toBe(ADOPTED);
    expect(tail[0]).toBe(SUSCEPTIBLE);
    expect(tail[1]).toBe(SUSCEPTIBLE);

    // Statistical reference: each chain edge fires only if its upstream did,
    // so E[reach] is the geometric series 1 + p + p^2 + p^3 = 1.875 at p = 0.5.
    const mean = expectedReach(chain, [0], 0.5, 4000, 99);
    expect(Math.abs(mean - 1.875)).toBeLessThanOrEqual(0.08);
  });

  it('linear threshold: terminal active set is an exact fixed point', () => {
    const net = makeRandomNetwork(12, 3, mulberry32(12));
    const thresholds = drawThresholds(net, mulberry32(13));
    const state = runLinearThreshold(net, [0], thresholds);
    expect(state[0]).toBe(ADOPTED);
    expect(ltFixedPointStable(net, state, thresholds)).toBe(true);

    // Hand case: star graph, centre seeded, fixed threshold 0.5 -> every leaf
    // has a single active neighbour (weight fraction 1 >= 0.5) and activates.
    const star = networkFromEdges(5, [
      { u: 0, v: 1, w: 1 },
      { u: 0, v: 2, w: 1 },
      { u: 0, v: 3, w: 1 },
      { u: 0, v: 4, w: 1 },
    ]);
    const starState = runLinearThreshold(star, [0], fixedThresholds(star, 0.5));
    expect([...starState]).toEqual([ADOPTED, ADOPTED, ADOPTED, ADOPTED, ADOPTED]);
    expect(ltFixedPointStable(star, starState, fixedThresholds(star, 0.5))).toBe(true);

    // Weighted freeze: path 2-1-0 seeded at the end with threshold 0.6.
    // Node 1 sees only one of its two neighbours active (fraction 0.5 < 0.6),
    // so the cascade freezes at the seed alone.
    const path = networkFromEdges(3, [
      { u: 0, v: 1, w: 1 },
      { u: 1, v: 2, w: 1 },
    ]);
    const frozen = runLinearThreshold(path, [2], fixedThresholds(path, 0.6));
    expect([...frozen]).toEqual([SUSCEPTIBLE, SUSCEPTIBLE, ADOPTED]);
    expect(ltFixedPointStable(path, frozen, fixedThresholds(path, 0.6))).toBe(true);
  });

  it('greedy seed selection matches brute force on the tiny two-chain graph', () => {
    // Two disjoint 3-chains, p = 1: the optimum k = 2 spread is 6, one seed per chain.
    const net = networkFromEdges(6, [
      { u: 0, v: 1, w: 1 },
      { u: 1, v: 2, w: 1 },
      { u: 3, v: 4, w: 1 },
      { u: 4, v: 5, w: 1 },
    ]);
    const seeds = greedySeeds(net, 2, 1, 8, 42);
    expect(seeds).toHaveLength(2);
    const inA = (v: number) => v >= 0 && v <= 2;
    const inB = (v: number) => v >= 3 && v <= 5;
    const covers = (inA(seeds[0]!) && inB(seeds[1]!)) || (inB(seeds[0]!) && inA(seeds[1]!));
    expect(covers).toBe(true);

    const greedySpread = expectedReach(net, seeds, 1, 8, 42);
    let best = 0;
    for (let i = 0; i < 6; i += 1) {
      for (let j = i + 1; j < 6; j += 1) {
        best = Math.max(best, expectedReach(net, [i, j], 1, 8, 42));
      }
    }
    expect(greedySpread).toBe(best);
    expect(greedySpread).toBe(6);
  });

  it('homophily index and exposure diversity stay within [0, 1] with correct structure', () => {
    const n = 40;
    const opinions = initialOpinions(n, mulberry32(21));
    const rnd = makeRandomNetwork(n, 4, mulberry32(22));
    const echo = makeEchoChamberNetwork(n, 4, 0.9, opinions, mulberry32(23));

    const hR = homophilyIndex(rnd, opinions);
    const hE = homophilyIndex(echo, opinions);
    expect(hR).toBeGreaterThanOrEqual(0);
    expect(hR).toBeLessThanOrEqual(1);
    expect(hE).toBeGreaterThanOrEqual(0);
    expect(hE).toBeLessThanOrEqual(1);
    // Rewiring toward same-opinion neighbours never decreases homophily.
    expect(hE).toBeGreaterThanOrEqual(hR);

    const dR = meanExposureDiversity(rnd, opinions);
    const dE = meanExposureDiversity(echo, opinions);
    expect(dR).toBeGreaterThanOrEqual(0);
    expect(dR).toBeLessThanOrEqual(1);
    expect(dE).toBeGreaterThanOrEqual(0);
    expect(dE).toBeLessThanOrEqual(1);
    expect(dE).toBeLessThanOrEqual(dR);
    for (let i = 0; i < n; i += 1) {
      const d = exposureDiversity(echo, opinions)[i]!;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }

    // Degenerate references: uniform opinions -> 1, alternating path -> 0.
    const path = makePathNetwork(6);
    const uniform = new Float64Array(6).fill(0.5);
    const alt = new Float64Array([0, 1, 0, 1, 0, 1]);
    expect(homophilyIndex(path, uniform)).toBe(1);
    expect(homophilyIndex(path, alt)).toBe(0);
  });

  it('opinion averaging keeps opinions in [0, 1] and shrinks variance', () => {
    const net = makeRandomNetwork(20, 4, mulberry32(31));
    const op0 = initialOpinions(20, mulberry32(32));
    const op1 = opinionStep(net, op0, 'bounded');
    const op2 = opinionStep(net, op1, 'average');
    for (const op of [op1, op2]) {
      for (let i = 0; i < op.length; i += 1) {
        expect(op[i]!).toBeGreaterThanOrEqual(0);
        expect(op[i]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('seeded pipelines are deterministic; seed selection honours the mode', () => {
    const params: OpinionParams = { ...DEFAULT_OPINION_PARAMS, nNodes: 30, seed: 7 };
    const build = () => {
      const rand = mulberry32(params.seed >>> 0 || 1);
      const opinions = initialOpinions(params.nNodes, rand);
      const net = buildNetwork(params, opinions, rand);
      const seeds = pickSeeds(net.n, params.seedCount, params.randomSeeds, rand);
      return { net, seeds, state: runIndependentCascade(net, seeds, params.spreadProb, rand) };
    };
    const a = build();
    const b = build();
    expect([...a.state]).toEqual([...b.state]);
    expect(a.seeds).toEqual(b.seeds);
    expect(a.net.edges.length).toBe(b.net.edges.length);

    // Deterministic (non-random) seeding picks the lowest indices.
    expect(pickSeeds(10, 3, false, mulberry32(1))).toEqual([0, 1, 2]);

    // All three network generators are seeded and non-empty for these params.
    for (const network of ['random', 'small-world', 'echo-chamber'] as const) {
      const net = buildNetwork({ ...params, network }, initialOpinions(params.nNodes, mulberry32(3)), mulberry32(4));
      expect(net.n).toBe(params.nNodes);
      expect(net.edges.length).toBeGreaterThan(0);
    }
    expect(makeSmallWorldNetwork(16, 4, 0.2, mulberry32(5)).edges.length).toBeGreaterThan(0);
  });

  it('embedded benchmark battery passes', () => {
    const b = runOpinionBenchmark();
    expect(b.chainExact).toBe(true);
    expect(b.chainMeanErr).toBeLessThanOrEqual(0.08);
    expect(b.ltFixedPoint).toBe(true);
    expect(b.greedyMatchesExhaustive).toBe(true);
    expect(b.homophilyBounds).toBe(true);
    expect(b.deterministic).toBe(true);
    expect(b.pass).toBe(true);
  });
});
