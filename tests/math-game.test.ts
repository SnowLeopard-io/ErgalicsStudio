// math-game kernel tests — Nash equilibria, replicator dynamics, backward
// induction, auctions/mechanisms, payoff-text round trips and the embedded
// validation benchmarks (unified metric |computed − analytic|/|analytic|).
import { describe, it, expect } from 'vitest';
import {
  backwardInduction,
  compareMechanisms,
  eliminateStrictlyDominated,
  essPureStrategies,
  EXAMPLE_TREES,
  findNash,
  findPureNE,
  formatPayoffText,
  GAME_BENCHMARK_ID,
  incentiveCompatibilityGap,
  integrateReplicator,
  integrateReplicatorSingle,
  mulberry32,
  noDeviationGap,
  parsePayoffText,
  replicatorDerivative,
  rowBestResponses,
  colBestResponses,
  runAuction,
  runGameBenchmarks,
  sampleGameById,
  SAMPLE_GAMES,
  sampleValuations,
  solveMixed2x2,
  treeSampleById,
  vcgPayment,
} from '../src/plugins/builtin/math/game/kernel';
import { gameFigurePanels } from '../src/plugins/builtin/math/game/figure';

function mustSample(id: string) {
  const g = sampleGameById(id);
  if (!g) throw new Error(`missing sample game '${id}'`);
  return g;
}

describe('sample games and payoff text', () => {
  it('exposes the five sample games with bilingual labels', () => {
    expect(SAMPLE_GAMES.map((g) => g.id)).toEqual([
      'pd',
      'hawks-doves',
      'matching-pennies',
      'battle-of-sexes',
      'stag-hunt',
    ]);
    for (const g of SAMPLE_GAMES) {
      expect(g.labelZh.length).toBeGreaterThan(0);
      expect(g.labelEn.length).toBeGreaterThan(0);
      expect(g.rowPayoffs.length).toBe(g.colPayoffs.length);
      expect(g.rowPayoffs[0]!.length).toBe(g.colPayoffs[0]!.length);
    }
  });

  it('round-trips matrices through formatPayoffText / parsePayoffText', () => {
    const pd = mustSample('pd');
    const text = formatPayoffText(pd.rowPayoffs, pd.colPayoffs);
    expect(text).toBe('3,0;5,1|3,5;0,1');
    const parsed = parsePayoffText(text, 2);
    expect(parsed).not.toBeNull();
    expect(parsed!.rowPayoffs).toEqual(pd.rowPayoffs);
    expect(parsed!.colPayoffs).toEqual(pd.colPayoffs);
  });

  it('rejects malformed payoff text', () => {
    expect(parsePayoffText('3,0;5,1', 2)).toBeNull(); // missing separator
    expect(parsePayoffText('3,0|3,5;0,1', 2)).toBeNull(); // wrong row count
    expect(parsePayoffText('3,0;x|3,5;0,1', 2)).toBeNull(); // non-numeric cell
    expect(parsePayoffText('3,0;5,1|3,5;0,1', 3)).toBeNull(); // size mismatch
    expect(parsePayoffText('3,0;5,1|3,5;0,1', 1)).toBeNull(); // size < 2
  });
});

describe('pure Nash equilibria', () => {
  it("finds the unique Prisoner's Dilemma equilibrium (Defect, Defect)", () => {
    const pure = findPureNE(mustSample('pd'));
    expect(pure).toHaveLength(1);
    expect(pure[0]!.row).toEqual([0, 1]);
    expect(pure[0]!.col).toEqual([0, 1]);
    expect(pure[0]!.u1).toBe(1);
    expect(pure[0]!.u2).toBe(1);
  });

  it('finds both pure equilibria of Battle of the Sexes and none of Matching Pennies', () => {
    expect(findPureNE(mustSample('battle-of-sexes'))).toHaveLength(2);
    expect(findPureNE(mustSample('matching-pennies'))).toHaveLength(0);
  });

  it('computes best-response sets', () => {
    const hd = mustSample('hawks-doves');
    // Against Dove, Hawk (2) beats Dove (1); against Hawk, Dove (0) beats Hawk (−2).
    expect(rowBestResponses(hd, [0, 1])).toEqual([0]);
    expect(rowBestResponses(hd, [1, 0])).toEqual([1]);
    // The column player faces the same trade-off: its best reply to a Dove
    // (row mixture [0,1]) is Hawk (column 0), and to a Hawk ([1,0]) is Dove.
    expect(colBestResponses(hd, [0, 1])).toEqual([0]);
    expect(colBestResponses(hd, [1, 0])).toEqual([1]);
  });

  it('iterates strict dominance down to the dominance-solvable equilibrium', () => {
    const pd = mustSample('pd');
    const surv = eliminateStrictlyDominated(pd);
    expect(surv.rows).toEqual([1]); // Defect survives
    expect(surv.cols).toEqual([1]);
    const mp = eliminateStrictlyDominated(mustSample('matching-pennies'));
    expect(mp.rows).toEqual([0, 1]);
    expect(mp.cols).toEqual([0, 1]);
  });
});

describe('mixed Nash equilibria', () => {
  it('solves the closed-form Matching Pennies mixture (1/2, 1/2)', () => {
    const eq = solveMixed2x2(mustSample('matching-pennies'));
    expect(eq).not.toBeNull();
    expect(eq!.row[0]!).toBeCloseTo(0.5, 12);
    expect(eq!.col[0]!).toBeCloseTo(0.5, 12);
    expect(eq!.u1).toBeCloseTo(0, 12);
  });

  it("solves the Hawk–Dove mixture p = V/C = 1/3", () => {
    const eq = solveMixed2x2(mustSample('hawks-doves'));
    expect(eq).not.toBeNull();
    expect(Math.abs(eq!.row[0]! - 1 / 3) / (1 / 3)).toBeLessThan(1e-12);
    expect(Math.abs(eq!.col[0]! - 1 / 3) / (1 / 3)).toBeLessThan(1e-12);
    expect(eq!.u1).toBeCloseTo(2 / 3, 10); // common payoff at the mixed equilibrium
  });

  it('returns null for the dominance-solvable Prisoner’s Dilemma', () => {
    expect(solveMixed2x2(mustSample('pd'))).toBeNull();
  });

  it('enumerates pure + mixed equilibria of Hawk–Dove', () => {
    const eqs = findNash(mustSample('hawks-doves'));
    expect(eqs.filter((e) => e.kind === 'pure')).toHaveLength(2);
    const mixed = eqs.filter((e) => e.kind === 'mixed');
    expect(mixed.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(mixed[0]!.row[0]! - 1 / 3)).toBeLessThan(1e-9);
    for (const eq of eqs) expect(noDeviationGap(mustSample('hawks-doves'), eq)).toBeLessThan(1e-9);
  });

  it('solves the fully mixed 3×3 rock–paper–scissors equilibrium (1/3 each)', () => {
    const rps = {
      rowPayoffs: [
        [0, -1, 1],
        [1, 0, -1],
        [-1, 1, 0],
      ],
      colPayoffs: [
        [0, 1, -1],
        [-1, 0, 1],
        [1, -1, 0],
      ],
    };
    const eqs = findNash(rps);
    const uniform = eqs.find(
      (e) => e.row.every((v) => Math.abs(v - 1 / 3) < 1e-6) && e.col.every((v) => Math.abs(v - 1 / 3) < 1e-6),
    );
    expect(uniform).toBeDefined();
    expect(noDeviationGap(rps, uniform!)).toBeLessThan(1e-9);
  });
});

describe('ESS and replicator dynamics', () => {
  it('flags Defect as the pure ESS of the Prisoner’s Dilemma', () => {
    expect(essPureStrategies(mustSample('pd'))).toEqual([1]);
    // Hawk–Dove has no pure ESS — the interior mixture is the ESS.
    expect(essPureStrategies(mustSample('hawks-doves'))).toEqual([]);
  });

  it('keeps the two-population replicator flow on the simplex', () => {
    const hd = mustSample('hawks-doves');
    const d = replicatorDerivative(hd, [0.5, 0.5, 0.5, 0.5]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    // Pure profiles are stationary corners.
    const corner = replicatorDerivative(hd, [1, 0, 1, 0]);
    for (const v of corner) expect(Math.abs(v)).toBeLessThan(1e-12);
    const traj = integrateReplicator(hd, [0.8, 0.2], [0.7, 0.3], 0.01, 300);
    expect(traj.length).toBe(301);
    for (const p of traj) {
      expect(p.x.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(p.y.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      for (const v of [...p.x, ...p.y]) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('converges to the Hawk–Dove ESS x* = 1/3', () => {
    const traj = integrateReplicatorSingle(mustSample('hawks-doves').rowPayoffs, [0.8, 0.2], 0.01, 3000);
    const last = traj[traj.length - 1]!;
    expect(Math.abs(last.x[0]! - 1 / 3) / (1 / 3)).toBeLessThan(1e-4);
  });
});

describe('extensive form (backward induction)', () => {
  it('solves entry deterrence: Enter, then Accommodate', () => {
    const tree = treeSampleById('entry-deterrence');
    expect(tree).toBeDefined();
    const res = backwardInduction(tree!.root);
    expect(res.payoffs).toEqual([1, 1]);
    expect(res.path.map((e) => e.labelEn)).toEqual(['Enter', 'Accommodate']);
    expect(res.pathNodeIds).toEqual(['e-root', 'e-inc', 'e-acc']);
  });

  it('solves the 3-stage centipede by rolling back to Take at the root', () => {
    const tree = treeSampleById('centipede');
    expect(tree).toBeDefined();
    const res = backwardInduction(tree!.root);
    expect(res.payoffs).toEqual([1, 0]);
    expect(res.path[0]!.labelEn).toBe('Take');
    expect(res.chosen[0]).toEqual({ nodeId: 'c0', childIndex: 0 });
  });

  it('keeps bilingual labels on every example tree', () => {
    for (const t of EXAMPLE_TREES) {
      expect(t.labelZh.length).toBeGreaterThan(0);
      expect(t.labelEn.length).toBeGreaterThan(0);
    }
  });
});

describe('auctions and mechanisms', () => {
  it('produces a reproducible seeded valuation sample', () => {
    const opts = { nBidders: 4, nAuctions: 50, min: 0, max: 10, seed: 20260101 };
    const a = sampleValuations(opts);
    const b = sampleValuations(opts);
    expect(a).toEqual(b);
    const other = sampleValuations({ ...opts, seed: 7 });
    expect(other).not.toEqual(a);
    for (const row of a) {
      expect(row).toHaveLength(4);
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
    // mulberry32 is a pure function of the seed.
    const r = mulberry32(42);
    const s = mulberry32(42);
    expect([r(), r(), r()]).toEqual([s(), s(), s()]);
  });

  it('prices first-price, second-price and English clock auctions correctly', () => {
    const vals = [8.5, 3.25, 9.75, 6];
    expect(runAuction('first', vals).revenue).toBe(9.75); // winner pays own value
    expect(runAuction('second', vals).revenue).toBe(8.5); // second-highest value
    const eng = runAuction('english', vals).revenue;
    expect(eng).toBeGreaterThan(8.5 - 1e-12); // clock clears above the runner-up value
    expect(eng).toBeLessThanOrEqual(8.5 + 0.25 + 1e-12); // within one tick of 0.25
    // Single bidder degenerates gracefully.
    expect(runAuction('second', [4]).revenue).toBe(0);
    expect(runAuction('first', []).revenue).toBe(0);
  });

  it('matches the VCG payment to the second-highest valuation', () => {
    expect(vcgPayment([8.5, 3.25, 9.75, 6])).toBe(8.5);
    expect(vcgPayment([5, 5])).toBe(5); // tie on top → second = 5
    expect(vcgPayment([3])).toBe(0);
  });

  it('verifies truth-telling incentive compatibility (gap = 0)', () => {
    const sample = sampleValuations({ nBidders: 4, nAuctions: 25, min: 0, max: 10, seed: 11 });
    for (const row of sample) expect(incentiveCompatibilityGap(row)).toBe(0);
    // Truthful second-price bidding is weakly dominant → no profitable deviation.
    expect(incentiveCompatibilityGap([2, 9, 5])).toBe(0);
  });

  it('reports first-price vs VCG revenue with a consistent gap', () => {
    const sample = sampleValuations({ nBidders: 5, nAuctions: 200, min: 0, max: 10, seed: 5 });
    const cmp = compareMechanisms(sample);
    expect(cmp.revenueGap).toBeCloseTo(cmp.meanFirstPriceRevenue - cmp.meanVcgRevenue, 12);
    // Under truthful bidding first-price extracts at least as much as VCG.
    expect(cmp.revenueGap).toBeGreaterThan(0);
    expect(cmp.meanVcgRevenue).toBeGreaterThan(0);
    expect(cmp.meanFirstPriceRevenue).toBeLessThanOrEqual(10 + 1e-12);
    expect(cmp.meanVcgRevenue).toBeLessThanOrEqual(cmp.meanFirstPriceRevenue + 1e-12);
  });
});

describe('figure panel builder', () => {
  it('builds replicator + auction panels as a pure builder (no DOM)', () => {
    const pd = mustSample('pd');
    const panels = gameFigurePanels({
      game: pd,
      replicator: { x0: 0.5, y0: 0.5, h: 0.01, steps: 200 },
      auction: { first: [9.75, 9.5, 9.9], second: [8.5, 8.25, 8.75], english: [8.75, 8.5, 9] },
    });
    expect(panels).toHaveLength(3);
    expect(panels.map((p) => p.tag)).toEqual(['a', 'b', 'c']);
    expect(panels[0]!.row).toBe(0);
    expect(panels[0]!.col).toBe(0);
    for (const p of panels) {
      expect(p.spec.series.length).toBeGreaterThan(0);
      expect(p.spec.width).toBeGreaterThan(0);
      expect(p.spec.height).toBeGreaterThan(0);
    }
    // Phase portrait carries trajectories plus equilibrium overlays.
    expect(panels[0]!.spec.series.length).toBeGreaterThanOrEqual(6);
    // Auction histogram uses grouped bars.
    expect(panels[2]!.spec.series.every((s) => s.kind === 'bar' && (s.bars?.length ?? 0) > 0)).toBe(true);
  });

  it('skips the phase panels for non-2×2 games and empty auction data', () => {
    const panels = gameFigurePanels({
      game: { rowPayoffs: [[1, 0, 0]], colPayoffs: [[1, 0, 0]] },
      replicator: { x0: 0.5, y0: 0.5, h: 0.01, steps: 10 },
      auction: null,
    });
    expect(panels).toHaveLength(0);
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all six benchmarks within the spec tolerances', () => {
    const bench = runGameBenchmarks();
    expect(GAME_BENCHMARK_ID).toBe('game-benchmarks');
    expect(bench.map((b) => b.id)).toEqual([
      'pd-pure-ne',
      'matching-pennies-mixed',
      'hawk-dove-mixed',
      'replicator-ess',
      'second-price-revenue',
      'nash-no-deviation',
    ]);
    for (const b of bench) {
      expect(b.labelZh.length, b.id).toBeGreaterThan(0);
      expect(b.labelEn.length, b.id).toBeGreaterThan(0);
      expect(b.detailZh.length, b.id).toBeGreaterThan(0);
      expect(Number.isFinite(b.relErr), b.id).toBe(true);
      expect(b.passed, `${b.id}: relErr=${b.relErr}`).toBe(true);
    }
    const byId = new Map(bench.map((b) => [b.id, b]));
    expect(byId.get('pd-pure-ne')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('matching-pennies-mixed')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('hawk-dove-mixed')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('replicator-ess')!.relErr).toBeLessThan(1e-4);
    expect(byId.get('second-price-revenue')!.relErr).toBeLessThan(1e-15);
    expect(byId.get('nash-no-deviation')!.relErr).toBeLessThan(1e-9);
  });
});
