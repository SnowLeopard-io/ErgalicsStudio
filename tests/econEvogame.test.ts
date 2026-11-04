import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/repro/random';
import {
  COOPERATE,
  DEFECT,
  EVO_BENCHMARK,
  adoptStrategy,
  cellScore,
  classifyRegime,
  cloneGrid,
  coopFraction,
  gridsEqual,
  initialGrid,
  makeRandomGrid,
  makeUniformGrid,
  payoff,
  runEvogameBenchmark,
  simulate,
  stepAsync,
  stepSync,
  type EvoParams,
} from '../src/plugins/builtin/econ/evogame/kernel';

const base: EvoParams = {
  b: 1.8,
  w: 24,
  h: 24,
  initCoop: 0.5,
  mutation: 0,
  boundary: 'periodic',
  updateMode: 'sync',
  seed: 42,
};

describe('econ-evogame kernel (Nowak–May spatial PD)', () => {
  it('payoff matrix is R=1, S=0, T=b, P=0', () => {
    expect(payoff(COOPERATE, COOPERATE, 1.8)).toBe(1);
    expect(payoff(COOPERATE, DEFECT, 1.8)).toBe(0);
    expect(payoff(DEFECT, COOPERATE, 1.8)).toBe(1.8);
    expect(payoff(DEFECT, DEFECT, 1.8)).toBe(0);
  });

  it('hand-computed scores: 5×5 absorbing, centre C, all else D, b = 1.8', () => {
    const g = makeUniformGrid(5, 5, DEFECT);
    g.cells[2 * 5 + 2] = COOPERATE;
    // centre: self-play R = 1 (all 8 neighbours are D ⇒ S = 0)
    expect(cellScore(g, 2, 2, 1.8, 'absorbing')).toBeCloseTo(1, 12);
    // the 8 cells adjacent to centre earn exactly one T = b game
    expect(cellScore(g, 1, 1, 1.8, 'absorbing')).toBeCloseTo(1.8, 12);
    expect(cellScore(g, 2, 1, 1.8, 'absorbing')).toBeCloseTo(1.8, 12);
    // distant cells only play D-vs-D ⇒ 0
    expect(cellScore(g, 0, 0, 1.8, 'absorbing')).toBeCloseTo(0, 12);
    expect(cellScore(g, 4, 4, 1.8, 'absorbing')).toBeCloseTo(0, 12);
    // relative-error form used by the benchmark is exactly 0
    const ref = [1, 1.8, 0];
    const pairs: Array<[number, number]> = [
      [cellScore(g, 2, 2, 1.8, 'absorbing'), ref[0]!],
      [cellScore(g, 1, 2, 1.8, 'absorbing'), ref[1]!],
      [cellScore(g, 0, 0, 1.8, 'absorbing'), ref[2]!],
    ];
    for (const [got, want] of pairs) {
      expect(Math.abs(got - want) / Math.max(1, Math.abs(want))).toBe(0);
    }
  });

  it('all-C and all-D lattices are exact fixed points (sync and async)', () => {
    for (const strat of [COOPERATE, DEFECT] as const) {
      const g0 = makeUniformGrid(12, 12, strat);
      const g1 = stepSync(g0, EVO_BENCHMARK.b, 'periodic', 0, mulberry32(7));
      expect(gridsEqual(g0, g1)).toBe(true);
      const ga = cloneGrid(g0);
      stepAsync(ga, EVO_BENCHMARK.b, 'periodic', 0, mulberry32(7));
      expect(gridsEqual(g0, ga)).toBe(true);
    }
  });

  it('a lone defector grows into a 3×3 D block in one sync generation', () => {
    const g = makeUniformGrid(5, 5, COOPERATE);
    g.cells[2 * 5 + 2] = DEFECT;
    const next = stepSync(g, EVO_BENCHMARK.b, 'absorbing', 0, mulberry32(1));
    expect(coopFraction(next)).toBeCloseTo(16 / 25, 12);
    // the centre cell itself keeps defecting (9b beats any C score)
    expect(next.cells[2 * 5 + 2]).toBe(DEFECT);
  });

  it('a lone cooperator among defectors is eliminated (b > 1)', () => {
    const g = makeUniformGrid(5, 5, DEFECT);
    g.cells[2 * 5 + 2] = COOPERATE;
    // adoptStrategy: the centre sees a neighbour scoring b > 1 and defects
    expect(adoptStrategy(g, 2, 2, EVO_BENCHMARK.b, 'absorbing')).toBe(DEFECT);
    const next = stepSync(g, EVO_BENCHMARK.b, 'absorbing', 0, mulberry32(1));
    expect(coopFraction(next)).toBe(0);
  });

  it('random lattices hit the requested cooperation probability', () => {
    const g = makeRandomGrid(64, 64, 0.5, mulberry32(20260922));
    expect(Math.abs(coopFraction(g) - 0.5)).toBeLessThan(0.05);
  });

  it('simulate is fully deterministic under a fixed seed (sync and async)', () => {
    for (const mode of ['sync', 'async'] as const) {
      const p: EvoParams = { ...base, updateMode: mode, seed: 42 };
      const a = simulate(initialGrid(p), p, 15);
      const b = simulate(initialGrid(p), p, 15);
      expect(gridsEqual(a.grid, b.grid)).toBe(true);
      expect(a.series.fc).toEqual(b.series.fc);
      expect(a.series.fc.length).toBe(16);
      expect(a.series.score.length).toBe(16);
    }
  });

  it('mutation is applied per cell and keeps the lattice binary', () => {
    const p: EvoParams = { ...base, mutation: 0.05, seed: 7 };
    const run = simulate(initialGrid(p), p, 10);
    for (const v of run.grid.cells) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('classifyRegime maps f_C to the three Nowak–May regimes', () => {
    expect(classifyRegime(0.9).key).toBe('cooperative');
    expect(classifyRegime(0.5).key).toBe('cooperative');
    expect(classifyRegime(0.1).key).toBe('mosaic');
    expect(classifyRegime(0.019).key).toBe('defection');
    expect(classifyRegime(0).key).toBe('defection');
  });

  it('embedded benchmark battery passes', () => {
    const b = runEvogameBenchmark();
    expect(b.allCInvariant).toBe(true);
    expect(b.allDInvariant).toBe(true);
    expect(b.handScoreErr).toBe(0);
    expect(b.handCollapse).toBe(true);
    expect(b.deterministic).toBe(true);
    expect(b.pass).toBe(true);
  });
});
