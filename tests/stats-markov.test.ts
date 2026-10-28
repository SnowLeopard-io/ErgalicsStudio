import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  absorbingAnalysis,
  chainPeriod,
  isIrreducible,
  matrixInverse,
  pageRank,
  parseInitial,
  parseMatrixText,
  PRESETS,
  runMarkovBenchmark,
  serializeMatrix,
  simulateChain,
  steadyStateByPower,
  stepDistribution,
  stochasticize,
  WEB5_MATRIX,
} from '../src/plugins/builtin/math/markov/kernel';

const WEATHER = [
  [0.9, 0.1],
  [0.45, 0.55],
];

describe('stats-markov matrix parsing & repair', () => {
  it('parses single-line and multi-line matrices, including labels and comments', () => {
    const a = parseMatrixText('0.9,0.1 ; 0.45,0.55');
    expect(a).not.toBeNull();
    expect(a!.rows).toEqual(WEATHER);
    expect(a!.labels).toBeNull();

    const b = parseMatrixText('# labels: Sunny,Rainy\n0.9 0.1\n0.45 0.55');
    expect(b!.labels).toEqual(['Sunny', 'Rainy']);

    const c = parseMatrixText('0.9,0.1;0.45,0.55;# labels: A,B');
    expect(c!.rows).toEqual(WEATHER);
    expect(c!.labels).toEqual(['A', 'B']);
  });

  it('rejects ragged, non-square, single-row and negative matrices', () => {
    expect(parseMatrixText('1,2,3;4,5,6')).toBeNull();
    expect(parseMatrixText('1,2;3,4;5,6')).toBeNull(); // 3 rows x 2 cols
    expect(parseMatrixText('1,2')).toBeNull(); // single row
    expect(parseMatrixText('1,-1;0.5,0.5')).toBeNull();
  });

  it('round-trips through serializeMatrix', () => {
    const s = serializeMatrix(WEATHER);
    expect(parseMatrixText(s)!.rows[0]![0]).toBeCloseTo(0.9, 9);
    expect(parseMatrixText(s)!.rows[1]![1]).toBeCloseTo(0.55, 9);
  });

  it('stochasticize normalises rows and replaces dangling rows by uniform', () => {
    const r = stochasticize([
      [2, 2],
      [0, 0],
    ])!;
    expect(r.P[0]).toEqual([0.5, 0.5]);
    expect(r.P[1]).toEqual([0.5, 0.5]);
    expect(r.danglingRows).toBe(1);
    expect(r.maxDeviation).toBeCloseTo(3, 9); // |row sum 4 − 1|
  });

  it('parses an initial distribution and falls back to uniform on invalid input', () => {
    expect(parseInitial('1, 3', 2)).toEqual([0.25, 0.75]);
    expect(parseInitial('abc', 2)).toEqual([0.5, 0.5]);
    expect(parseInitial('0,0', 2)).toEqual([0.5, 0.5]);
    // wrong length for the 2-state chain → uniform over the chain size
    expect(parseInitial('1,2,3', 2)).toEqual([0.5, 0.5]);
  });
});

describe('stats-markov stationary distribution (power iteration)', () => {
  it('recovers the weather law π = (9/11, 2/11) with L1 residual < 1e-10', () => {
    const r = steadyStateByPower(WEATHER);
    expect(r.converged).toBe(true);
    expect(r.residual).toBeLessThan(1e-12);
    expect(r.pi[0]).toBeCloseTo(9 / 11, 9);
    expect(r.pi[1]).toBeCloseTo(2 / 11, 9);
    expect(Math.max(Math.abs(r.pi[0]! - 9 / 11), Math.abs(r.pi[1]! - 2 / 11))).toBeLessThan(1e-10);
  });

  it('doubly stochastic matrices converge to the uniform law (< 1e-12)', () => {
    const dbl = [
      [0.5, 0.25, 0.25],
      [0.25, 0.5, 0.25],
      [0.25, 0.25, 0.5],
    ];
    const r = steadyStateByPower(dbl);
    for (const v of r.pi) expect(Math.abs(v - 1 / 3)).toBeLessThan(1e-12);
  });

  it('one update equals the hand-computed π·P product', () => {
    const next = stepDistribution([0.5, 0.5], WEATHER);
    expect(next[0]).toBeCloseTo(0.5 * 0.9 + 0.5 * 0.45, 12);
    expect(next[1]).toBeCloseTo(0.5 * 0.1 + 0.5 * 0.55, 12);
  });

  it('periodic 2-cycle: uniform start is stationary, period = 2, chain irreducible', () => {
    const cycle = [
      [0, 1],
      [1, 0],
    ];
    expect(isIrreducible(cycle)).toBe(true);
    expect(chainPeriod(cycle)).toBe(2);
    const r = steadyStateByPower(cycle);
    expect(r.pi[0]).toBeCloseTo(0.5, 12);
    expect(r.pi[1]).toBeCloseTo(0.5, 12);
  });

  it('weather chain is aperiodic irreducible (period 1); identity chain is reducible', () => {
    expect(chainPeriod(WEATHER)).toBe(1);
    const identity = [
      [1, 0],
      [0, 1],
    ];
    expect(isIrreducible(identity)).toBe(false);
    expect(chainPeriod(identity)).toBeNull();
  });
});

describe('stats-markov absorbing chains', () => {
  const ruin = [
    [1, 0, 0, 0],
    [0.5, 0, 0.5, 0],
    [0, 0.5, 0, 0.5],
    [0, 0, 0, 1],
  ];

  it('gambler’s ruin: N = (I−Q)⁻¹ = [[4/3,2/3],[2/3,4/3]], E[steps] = 2, P(ruin|$1) = 2/3', () => {
    const abs = absorbingAnalysis(ruin)!;
    expect(abs.transient).toEqual([1, 2]);
    expect(abs.absorbing).toEqual([0, 3]);
    expect(abs.fundamental[0]![0]).toBeCloseTo(4 / 3, 12);
    expect(abs.fundamental[0]![1]).toBeCloseTo(2 / 3, 12);
    expect(abs.fundamental[1]![0]).toBeCloseTo(2 / 3, 12);
    expect(abs.fundamental[1]![1]).toBeCloseTo(4 / 3, 12);
    for (const e of abs.expectedSteps) expect(Math.abs(e - 2)).toBeLessThan(1e-9);
    // absorbing order [0 = $0 (ruin), 3 = $3 (win)]; transient order [1, 2]
    expect(abs.absorptionProbs[0]![0]).toBeCloseTo(2 / 3, 9); // ruin (hit $0) from $1
    expect(abs.absorptionProbs[0]![1]).toBeCloseTo(1 / 3, 9); // win ($3) from $1
    expect(abs.absorptionProbs[1]![0]).toBeCloseTo(1 / 3, 9); // ruin from $2
    expect(abs.absorptionProbs[1]![1]).toBeCloseTo(2 / 3, 9); // win from $2
  });

  it('returns null when the chain has no absorbing state', () => {
    expect(absorbingAnalysis(WEATHER)).toBeNull();
  });

  it('Gauss-Jordan inverse matches the hand inverse; singular matrices return null', () => {
    const inv = matrixInverse([
      [2, 1],
      [1, 1],
    ])!;
    expect(inv[0]).toEqual([1, -1]);
    expect(inv[1]).toEqual([-1, 2]);
    expect(
      matrixInverse([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });
});

describe('stats-markov PageRank', () => {
  it('damped 2-cycle (d=0.85) is symmetric → uniform ranking (< 1e-12)', () => {
    const r = pageRank(
      [
        [0, 1],
        [1, 0],
      ],
      0.85,
    );
    expect(Math.abs(r.pi[0]! - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(r.pi[1]! - 0.5)).toBeLessThan(1e-12);
  });

  it('5-node web graph satisfies the fixed point π = π·G to machine precision', () => {
    const r = pageRank(WEB5_MATRIX, 0.85);
    expect(r.converged).toBe(true);
    const d = 0.85;
    const n = WEB5_MATRIX.length;
    const G = WEB5_MATRIX.map((row) => row.map((v) => d * v + (1 - d) / n));
    const next = stepDistribution(r.pi, G);
    const l1 = next.reduce((a, v, i) => a + Math.abs(v - r.pi[i]!), 0);
    expect(l1).toBeLessThan(1e-12);
    expect(r.pi.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 12);
  });
});

describe('stats-markov trajectory simulation', () => {
  it('is deterministic per seed, has the right length, and stays in the state space', () => {
    const a = simulateChain(WEB5_MATRIX, [1, 0, 0, 0, 0], 500, 20261011);
    const b = simulateChain(WEB5_MATRIX, [1, 0, 0, 0, 0], 500, 20261011);
    expect(a).toEqual(b);
    expect(a).toHaveLength(501);
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(5);
    }
  });

  it('an absorbing chain eventually stays absorbed', () => {
    const ruin = [
      [1, 0, 0, 0],
      [0.5, 0, 0.5, 0],
      [0, 0.5, 0, 0.5],
      [0, 0, 0, 1],
    ];
    const traj = simulateChain(ruin, [0, 1, 0, 0], 200, 123);
    const last = traj[traj.length - 1]!;
    expect(last === 0 || last === 3).toBe(true);
    // once absorbed, never leaves
    for (let i = 1; i < traj.length; i += 1) {
      if (traj[i - 1] === 0) expect(traj[i]).toBe(0);
      if (traj[i - 1] === 3) expect(traj[i]).toBe(3);
    }
  });
});

describe('stats-markov embedded benchmark suite', () => {
  it('passes all four acceptance scenarios against closed-form ground truth', () => {
    const bench = runMarkovBenchmark();
    expect(bench.weatherMaxAbsErr).toBeLessThan(1e-10);
    expect(bench.doublyStochasticMaxAbsErr).toBeLessThan(1e-12);
    expect(bench.ruinStepsMaxAbsErr).toBeLessThan(1e-9);
    expect(bench.ruinProbMaxAbsErr).toBeLessThan(1e-9);
    expect(bench.pagerankUniformMaxAbsErr).toBeLessThan(1e-12);
    expect(bench.pagerankFixedPointResidual).toBeLessThan(1e-12);
    expect(bench.pass).toBe(true);
  });

  it('ships a preset library containing the benchmark chains', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['weather', 'ruin', 'doubly', 'pagerank-web', 'cycle2']));
  });
});

describe('stats-markov shipped example data', () => {
  it('examples/data/markov-pagerank-web.csv matches the kernel web graph', () => {
    const file = fileURLToPath(new URL('../examples/data/markov-pagerank-web.csv', import.meta.url));
    const text = readFileSync(file, 'utf8');
    const parsed = parseMatrixText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.labels).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(parsed!.rows).toHaveLength(5);
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        expect(parsed!.rows[i]![j]).toBeCloseTo(WEB5_MATRIX[i]![j]!, 12);
      }
    }
    // row sums are exactly 1 after stochasticization
    const st = stochasticize(parsed!.rows)!;
    for (const row of st.P) expect(row.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 12);
  });
});
