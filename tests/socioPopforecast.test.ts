import { describe, expect, it } from 'vitest';
import {
  buildLeslie,
  classifyAging,
  DEFAULT_POP_PARAMS,
  dominantEigen,
  fertilitySchedule,
  growthRate,
  leslieCubicDominantRoot,
  POP_BENCHMARK,
  project,
  runPopForecastBenchmark,
  simulatePopForecast,
  survivalSchedule,
  totalPopulation,
  type PopForecastParams,
} from '../src/plugins/builtin/socio/popforecast/kernel';

const supercritical: PopForecastParams = {
  ...DEFAULT_POP_PARAMS,
  classes: 16,
  baseFertility: 2,
  survivalScale: 1,
  scenario: 'high',
  migrationPerYear: 0,
  years: 200,
  seed: 42,
};

describe('socio-popforecast kernel (Leslie matrix projection)', () => {
  it('dominant eigenvalue matches the closed-form cubic root of lambda^3 - 2 lambda - 2.7 = 0', () => {
    const lambda = growthRate(POP_BENCHMARK.matrix.map((r) => r.slice()));
    const lambdaRef = leslieCubicDominantRoot(POP_BENCHMARK.fertility.slice(), POP_BENCHMARK.survival.slice());
    // Characteristic cubic: lambda^3 - 0*lambda^2 - 4*0.5*lambda - 9*0.5*0.6.
    expect(lambdaRef).toBeGreaterThan(1.85);
    expect(lambdaRef).toBeLessThan(1.87);
    expect(Math.abs(lambda - lambdaRef) / lambdaRef).toBeLessThan(1e-6);
  });

  it('totals grow monotonically once the dominant eigenvalue exceeds 1', () => {
    const run = simulatePopForecast(supercritical);
    expect(run.lambda).toBeGreaterThan(1);
    for (let t = 20; t < run.years; t += 1) {
      expect(run.totals[t + 1] ?? 0).toBeGreaterThan(run.totals[t] ?? 0);
    }
  });

  it('zero fertility drives the population to geometric extinction', () => {
    const L = buildLeslie([0, 0, 0], [0.6, 0.5]);
    const rows = project(L, [1000, 800, 300], 240);
    const ratio = totalPopulation(rows[rows.length - 1] ?? [0]) / totalPopulation([1000, 800, 300]);
    expect(ratio).toBeLessThan(1e-12);
    // Fertility row only, survival on the subdiagonal, last class open.
    expect(L[0]).toEqual([0, 0, 0]);
    expect(L[1]).toEqual([0.6, 0, 0]);
    expect(L[2]).toEqual([0, 0.5, 0]);
  });

  it('age-structure indicators stay within demographic bounds', () => {
    const run = simulatePopForecast({ ...DEFAULT_POP_PARAMS, years: 120 });
    for (let t = 0; t <= run.years; t += 1) {
      const share = run.share65[t] ?? 0;
      const dep = run.dependency[t] ?? 0;
      const median = run.medianAge[t] ?? 0;
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
      expect(dep).toBeGreaterThanOrEqual(0);
      expect(dep).toBeLessThanOrEqual(400);
      expect(median).toBeGreaterThanOrEqual(0);
      expect(median).toBeLessThanOrEqual(80);
    }
  });

  it('UN aging classification follows the 7% / 14% thresholds', () => {
    expect(classifyAging(0.05).key).toBe('young');
    expect(classifyAging(0.07).key).toBe('aging');
    expect(classifyAging(0.14).key).toBe('aging');
    expect(classifyAging(0.1401).key).toBe('aged');
    expect(classifyAging(0.2).key).toBe('aged');
  });

  it('embedded benchmark battery passes as a whole', () => {
    const b = runPopForecastBenchmark();
    expect(b.eigenOk).toBe(true);
    expect(b.stableConvergence).toBe(true);
    expect(b.extinction).toBe(true);
    expect(b.migrationCumulative).toBe(true);
    expect(b.deterministic).toBe(true);
    expect(b.pass).toBe(true);
  });

  it('schedules and eigen solver are self-consistent for 8 and 10 classes', () => {
    for (const k of [8, 10, 16]) {
      const L = buildLeslie(fertilitySchedule(k), survivalSchedule(k));
      expect(L).toHaveLength(k);
      const pair = dominantEigen(L);
      expect(pair.lambda).toBeGreaterThan(0.9);
      expect(pair.lambda).toBeLessThan(1.2);
    }
  });
});
