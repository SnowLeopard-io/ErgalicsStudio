import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  buildSeries,
  parseObservedSeries,
  reportEpidemic,
  simulateEpidemic,
  type ModelConfig,
} from '../src/plugins/builtin/bio-epidemic/epidemic';

function cfg(over: Partial<ModelConfig> = {}): ModelConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

describe('bio-epidemic compartment kernel', () => {
  it('conserves total population in SIR across the whole run', () => {
    const c = cfg();
    const t = simulateEpidemic(c);
    const N = c.population;
    for (let i = 0; i < t.days.length; i += 1) {
      const sum = t.susceptible[i]! + t.infectious[i]! + t.recovered[i]!;
      expect(Math.abs(sum - N) / N).toBeLessThan(1e-6);
    }
  });

  it('conserves total population in SEIR', () => {
    const c = cfg({ model: 'SEIR' as const });
    const t = simulateEpidemic(c);
    const N = c.population;
    for (let i = 0; i < t.days.length; i += 1) {
      const sum = t.susceptible[i]! + t.exposed![i]! + t.infectious[i]! + t.recovered[i]!;
      expect(Math.abs(sum - N) / N).toBeLessThan(1e-6);
    }
  });

  it('with R₀<1 the infection dies out without a large outbreak (final size ~ I₀)', () => {
    const c = cfg({ r0: 0.8, days: 180 });
    const t = simulateEpidemic(c);
    const rep = reportEpidemic(c, t);
    // no herd immunity needed, final cumulative recovered ≈ initial infected
    expect(rep.totalCasesFraction * c.population).toBeLessThan(c.initialInfected * 10);
    expect(rep.herdImmunityFraction).toBe(0);
  });

  it('R₀>1 yields herd-immunity threshold 1−1/R₀ and a clear peak', () => {
    const c = cfg({ r0: 4 });
    const t = simulateEpidemic(c);
    const rep = reportEpidemic(c, t);
    expect(rep.herdImmunityFraction).toBeCloseTo(1 - 1 / 4, 9);
    expect(rep.peakInfectious).toBeGreaterThan(c.initialInfected);
    expect(rep.peakDay).toBeGreaterThan(0);
    expect(rep.peakFraction).toBeLessThan(0.5);
  });

  it('higher R₀ produces a larger peak attack fraction (monotone order)', () => {
    const low = reportEpidemic(cfg({ r0: 1.5, days: 220 }), simulateEpidemic(cfg({ r0: 1.5, days: 220 })));
    const high = reportEpidemic(cfg({ r0: 3, days: 220 }), simulateEpidemic(cfg({ r0: 3, days: 220 })));
    expect(high.totalCasesFraction).toBeGreaterThan(low.totalCasesFraction);
    expect(high.peakInfectious / 1e6).toBeGreaterThan(low.peakInfectious / 1e6);
  });

  it('SEIR delays the infectious peak relative to SIR at the same R₀', () => {
    const sir = reportEpidemic(cfg({ model: 'SIR' as const }), simulateEpidemic(cfg({ model: 'SIR' as const })));
    const seir = reportEpidemic(cfg({ model: 'SEIR' as const }), simulateEpidemic(cfg({ model: 'SEIR' as const })));
    expect(seir.peakDay).toBeGreaterThan(sir.peakDay);
  });

  it('R_eff starts at R₀ and falls below 1 once herd immunity passes', () => {
    const c = cfg({ r0: 4, days: 200 });
    const t = simulateEpidemic(c);
    expect(Math.abs(t.rEff[0]! - 4)).toBeLessThan(0.05);
    const below = t.rEff.find((r) => r < 1);
    expect(below).toBeDefined();
  });

  it('is deterministic: same config gives identical trajectories', () => {
    const a = simulateEpidemic(cfg());
    const b = simulateEpidemic(cfg());
    expect(a.infectious).toEqual(b.infectious);
    expect(a.susceptible).toEqual(b.susceptible);
  });

  it('recovery completes to ~the analytic final-size for R₀=2, N large', () => {
    // For R₀=2 the classic SIR final-size relation gives ~79-80% eventually;
    // with 120 days the epidemic is essentially over for fast dynamics at N small.
    const c = cfg({ r0: 2, population: 1000, initialInfected: 1, days: 300 });
    const t = simulateEpidemic(c);
    const rep = reportEpidemic(c, t);
    expect(rep.totalCasesFraction).toBeGreaterThan(0.55);
    expect(rep.totalCasesFraction).toBeLessThan(0.9);
  });
});

describe('bio-epidemic observed-series parser', () => {
  it('parses a CSV of daily new cases with a header + comment lines', () => {
    const csv = `# syndromic ILI
day,cases
0,22
1,31
2,42
3,58
4,79`;
    const s = parseObservedSeries(csv);
    expect(s).not.toBeNull();
    expect(s!.days).toEqual([0, 1, 2, 3, 4]);
    expect(s!.newCases).toEqual([22, 31, 42, 58, 79]);
    expect(s!.cumulative).toEqual([22, 53, 95, 153, 232]);
  });

  it('treats a monotone column as cumulative and derives new cases by diff', () => {
    const s = buildSeries([0, 1, 2, 3], [10, 25, 45, 60]);
    expect(s.cumulative).toEqual([10, 25, 45, 60]);
    expect(s.newCases).toEqual([10, 15, 20, 15]);
  });

  it('normalizes day offsets to start at 0', () => {
    const s = parseObservedSeries('104,5\n108,9');
    expect(s!.days).toEqual([0, 4]);
    expect(s!.newCases).toEqual([5, 9]);
  });

  it('parses a JSON point array', () => {
    const s = parseObservedSeries('[{"day":0,"new":2},{"day":1,"new":3},{"day":2,"new":1}]');
    expect(s!.cumulative).toEqual([2, 5, 6]);
  });

  it('returns null for non-parsable / too-short input', () => {
    expect(parseObservedSeries('0,5')).toBeNull();
    expect(parseObservedSeries('')).toBeNull();
    expect(parseObservedSeries('a,b\nc,d')).toBeNull();
  });
});