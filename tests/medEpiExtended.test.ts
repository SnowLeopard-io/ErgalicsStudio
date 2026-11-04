import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  discretizeSerialInterval,
  estimateRt,
  gravityMobility,
  metapopConservationDrift,
  parseIncidenceCsv,
  parseMobilityMatrix,
  parseRegionCsv,
  simulateMetapop,
  type MetapopConfig,
  type RegionSpec,
} from '../src/plugins/builtin/med/epidemic/epidemic';

function regions3(): RegionSpec[] {
  return [
    { name: 'North', population: 1_000_000, infected: 50 },
    { name: 'South', population: 800_000, infected: 20 },
    { name: 'East', population: 600_000, infected: 0 },
  ];
}

function meta(over: Partial<MetapopConfig> = {}): MetapopConfig {
  return {
    regions: regions3(),
    r0: 2.5,
    infectiousDays: 5,
    latentDays: 3,
    days: 180,
    gravityCoeff: 0,
    ...over,
  };
}

describe('metapop SEIR kernel: conservation', () => {
  it('conserves the global total population with migration, vaccination, waning and two strains', () => {
    const res = simulateMetapop(
      meta({
        gravityCoeff: 0.005,
        vaccinationRate: 0.01,
        vaccineEfficacy: 0.8,
        waningRate: 0.005,
        strain2Enabled: true,
        strain2R0: 3,
        strain2Share: 0.2,
        ageStructure: true,
        days: 120,
      }),
    );
    expect(res).not.toBeNull();
    expect(metapopConservationDrift(res!)).toBeLessThan(1e-6);
  });

  it('keeps each region population constant when mobility is zero (no deaths/births)', () => {
    const res = simulateMetapop(meta({ days: 150, strain2Enabled: true, vaccinationRate: 0.005, waningRate: 0.003 }));
    for (const r of res!.regions) {
      for (let i = 0; i < r.days.length; i += 1) {
        const sum = r.susceptible[i]! + r.exposed[i]! + r.infectious[i]! + r.recovered[i]! + r.vaccinated[i]!;
        expect(Math.abs(sum - r.population) / r.population).toBeLessThan(1e-6);
      }
    }
  });

  it('gravity mobility is symmetric with zero diagonal and small row sums', () => {
    const m = gravityMobility([1e6, 4e5, 2e5], 0.01);
    for (let i = 0; i < m.length; i += 1) {
      expect(m[i]![i]).toBe(0);
      for (let j = 0; j < m.length; j += 1) expect(m[i]![j]).toBeCloseTo(m[j]![i]!, 15);
      const rowSum = m[i]!.reduce((s, v) => s + v, 0);
      expect(rowSum).toBeLessThanOrEqual(0.01 + 1e-12);
    }
  });
});

describe('metapop SEIR kernel: epidemiology', () => {
  it('lockdown lowers and delays the total infectious peak', () => {
    const free = simulateMetapop(meta({ days: 200 }));
    const locked = simulateMetapop(meta({ days: 200, lockdown: { start: 20, end: 100, strength: 0.6 } }));
    const peakFree = Math.max(...free!.totalInfectious);
    const peakLocked = Math.max(...locked!.totalInfectious);
    const dayFree = free!.days[free!.totalInfectious.indexOf(peakFree)]!;
    const dayLocked = locked!.days[locked!.totalInfectious.indexOf(peakLocked)]!;
    expect(peakLocked).toBeLessThan(peakFree);
    expect(dayLocked).toBeGreaterThan(dayFree);
  });

  it('vaccination reduces cumulative infections', () => {
    const base = simulateMetapop(meta({ days: 300, regions: [regions3()[0]!] }));
    const vax = simulateMetapop(
      meta({ days: 300, regions: [regions3()[0]!], vaccinationRate: 0.02, vaccineEfficacy: 0.9 }),
    );
    expect(vax!.perRegion[0]!.totalInfections).toBeLessThan(base!.perRegion[0]!.totalInfections * 0.85);
  });

  it('travel restriction delays cross-region spread', () => {
    const regs: RegionSpec[] = [
      { name: 'A', population: 1_000_000, infected: 500 },
      { name: 'B', population: 1_000_000, infected: 0 },
    ];
    const free = simulateMetapop(meta({ regions: regs, days: 120, gravityCoeff: 0.02 }));
    const banned = simulateMetapop(
      meta({ regions: regs, days: 120, gravityCoeff: 0.02, travelRestriction: { start: 0, end: 120, strength: 0.95 } }),
    );
    const peakDay = (res: ReturnType<typeof simulateMetapop>): number => {
      const arr = res!.regions[1]!.infectious;
      let v = 0;
      let idx = 0;
      for (let i = 0; i < arr.length; i += 1) {
        if (arr[i]! > v) {
          v = arr[i]!;
          idx = i;
        }
      }
      return res!.days[idx]!;
    };
    const dayFree = peakDay(free);
    const dayBanned = peakDay(banned);
    expect(dayBanned).toBeGreaterThan(dayFree + 10);
  });

  it('a fitter second strain outcompetes strain 1 over time', () => {
    const res = simulateMetapop(
      meta({ days: 240, r0: 1.5, strain2Enabled: true, strain2R0: 4, strain2Share: 0.1 }),
    );
    expect(res!.strain2CumulativeShare).not.toBeNull();
    expect(res!.strain2CumulativeShare!).toBeGreaterThan(0.5);
  });

  it('age structure yields three groups with age-stratified severe estimates', () => {
    const res = simulateMetapop(meta({ days: 120, ageStructure: true }));
    expect(res!.ageGroups).not.toBeNull();
    expect(res!.ageGroups!.map((a) => a.name)).toEqual(['children', 'adults', 'elderly']);
    expect(res!.severeEstimate).not.toBeNull();
    expect(res!.severeEstimate!.length).toBe(3);
    const child = res!.severeEstimate![0]!.severe;
    const elderly = res!.severeEstimate![2]!.severe;
    expect(elderly).toBeGreaterThan(child);
    expect(metapopConservationDrift(res!)).toBeLessThan(1e-6);
  });

  it('reports per-region peak time, peak size and attack rate', () => {
    const regs = regions3().map((r, i) => (i === 2 ? { ...r, infected: 5 } : r));
    const res = simulateMetapop(meta({ days: 120, regions: regs }));
    expect(res!.perRegion.length).toBe(3);
    for (const r of res!.perRegion) {
      expect(r.peakDay).toBeGreaterThan(0);
      expect(r.peakInfectious).toBeGreaterThan(0);
      expect(r.attackRate).toBeGreaterThan(0);
      expect(r.attackRate).toBeLessThan(1);
    }
  });
});

describe('Cori et al. Rt estimation', () => {
  // Exact exponential incidence I(t) = 100 e^{0.2 t}: with the plugin's own
  // discretized Gamma serial interval, the renewal-equation Rt at late times
  // is exactly 1 / sum_k w_k e^{-r k}. Cross-check that value against the
  // continuous-Gamma MGF (1 + r*theta)^k within 2%.
  const r = 0.2;
  const k = (5.2 / 1.7) ** 2;
  const theta = (1.7 * 1.7) / 5.2;
  const rtMgf = Math.pow(1 + r * theta, k);
  const w = discretizeSerialInterval(5.2, 1.7);
  const rtTrue = 1 / w.reduce((s, wk, i) => s + wk * Math.exp(-r * (i + 1)), 0);
  const inc = Array.from({ length: 80 }, (_, t) => 100 * Math.exp(r * t));

  it('discretized serial interval matches the continuous Gamma MGF within 2%', () => {
    expect(Math.abs(rtTrue - rtMgf) / rtMgf).toBeLessThan(0.02);
  });

  it('recovers the known Rt of exponentially growing incidence within 5%', () => {
    const est = estimateRt(inc, { siMean: 5.2, siSd: 1.7, window: 7 });
    expect(est).not.toBeNull();
    const latest = est!.latest!;
    expect(Math.abs(latest.rt - rtTrue) / rtTrue).toBeLessThan(0.05);
  });

  it('places the true Rt inside the 95% credible interval', () => {
    const est = estimateRt(inc, { siMean: 5.2, siSd: 1.7, window: 7 })!;
    const latest = est.latest!;
    expect(latest.lo).toBeLessThan(rtTrue);
    expect(latest.hi).toBeGreaterThan(rtTrue);
    expect(latest.hi).toBeGreaterThan(latest.rt);
    expect(latest.rt).toBeGreaterThan(latest.lo);
  });

  it('recovers the exponential growth rate from the trailing log-linear fit', () => {
    const est = estimateRt(inc)!;
    expect(Math.abs(est.growthRate - r)).toBeLessThan(0.02);
  });

  it('returns null when the series is shorter than the window', () => {
    expect(estimateRt([1, 2, 3], { window: 7 })).toBeNull();
  });

  it('estimates Rt from the bundled example incidence file', () => {
    const csv = readFileSync('examples/data/med-epi-rt-incidence.csv', 'utf8');
    const obs = parseIncidenceCsv(csv);
    expect(obs).not.toBeNull();
    expect(obs!.days.length).toBe(120);
    const est = estimateRt(obs!.newCases)!;
    expect(est.points.length).toBeGreaterThan(100);
    expect(est.latest!.rt).toBeGreaterThan(0.2);
    expect(est.latest!.rt).toBeLessThan(3);
  });
});

describe('extended CSV parsers', () => {
  it('parses a region table with comments and aliases', () => {
    const csv = `# regions
region,population,infected
North,1200000,40
South,900000,25`;
    const regs = parseRegionCsv(csv);
    expect(regs).not.toBeNull();
    expect(regs!.length).toBe(2);
    expect(regs![0]).toEqual({ name: 'North', population: 1200000, infected: 40 });
    expect(regs![1]!.infected).toBe(25);
  });

  it('clamps initial infected to the population and skips invalid rows', () => {
    const regs = parseRegionCsv('region,population,infected\nA,1000,5000\nB,-5,1\nC,500,10');
    expect(regs).not.toBeNull();
    expect(regs!.length).toBe(2);
    expect(regs![0]!.infected).toBe(1000);
    expect(regs![1]!.name).toBe('C');
  });

  it('rejects region tables missing required columns', () => {
    expect(parseRegionCsv('region,population\nA,100')).toBeNull();
    expect(parseRegionCsv('')).toBeNull();
    expect(parseRegionCsv('region,population,infected')).toBeNull();
  });

  it('parses a full square mobility matrix and symmetrizes it', () => {
    const m = parseMobilityMatrix('0,0.002,0.001\n0.001,0,0.003\n0.0004,0.003,0', 3);
    expect(m).not.toBeNull();
    expect(m![0]![0]).toBe(0);
    expect(m![0]![1]).toBeCloseTo(0.0015, 12);
    expect(m![1]![0]).toBeCloseTo(m![0]![1]!, 12);
    expect(m![2]![0]).toBeCloseTo(m![0]![2]!, 12);
  });

  it('parses an upper-triangle mobility matrix', () => {
    const m = parseMobilityMatrix('0.001,0.0005\n0.002', 3);
    expect(m).not.toBeNull();
    expect(m![0]![1]).toBeCloseTo(0.001, 12);
    expect(m![0]![2]).toBeCloseTo(0.0005, 12);
    expect(m![1]![2]).toBeCloseTo(0.002, 12);
    expect(m![2]![1]).toBeCloseTo(0.002, 12);
    expect(m![1]![0]).toBeCloseTo(0.001, 12);
  });

  it('rejects mobility matrices with the wrong shape or negative values', () => {
    expect(parseMobilityMatrix('0,0.1\n0.1,0\n0.3,0.2', 2)).toBeNull();
    expect(parseMobilityMatrix('0,-0.1\n-0.1,0', 2)).toBeNull();
  });

  it('parses incidence CSV with ISO dates and fills day gaps with zeros', () => {
    const obs = parseIncidenceCsv('date,new_cases\n2025-01-01,5\n2025-01-03,9');
    expect(obs).not.toBeNull();
    expect(obs!.days).toEqual([0, 1, 2]);
    expect(obs!.newCases).toEqual([5, 0, 9]);
    expect(obs!.cumulative).toEqual([5, 5, 14]);
  });

  it('parses numeric time,incidence tables', () => {
    const obs = parseIncidenceCsv('time,incidence\n0,2\n1,4\n2,6');
    expect(obs).not.toBeNull();
    expect(obs!.newCases).toEqual([2, 4, 6]);
  });

  it('rejects malformed incidence tables', () => {
    expect(parseIncidenceCsv('date,new_cases\n2025-01-01')).toBeNull();
    expect(parseIncidenceCsv('a,b\n1,2\n3,4')).toBeNull();
  });
});
