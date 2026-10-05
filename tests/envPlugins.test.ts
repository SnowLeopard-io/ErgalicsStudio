// Environmental science suite — pure-function unit + sample-data integration tests.
import { describe, it, expect } from 'vitest';

import {
  CN_BREAKPOINTS,
  CARBON_INITIAL,
  aqiBand,
  classifyIndicator,
  computeAqi,
  computeWqi,
  diversityIndex,
  evaluateWaterSite,
  greenhouseModel,
  groundwaterStep,
  iaqi,
  lakeProfile,
  maxGroundConcentration,
  plumeConcentration,
  pumpWell,
  sigmaYZ,
  surfaceAlbedo,
  surfaceCo2,
  carbonRun,
} from '@/plugins/builtin/env/envCore';
import { parseAqiCsv, aqiFigurePanels } from '@/plugins/builtin/env/aqi';
import { parseWaterCsv, waterFigurePanels } from '@/plugins/builtin/env/water';
import { parseCarbonCsv, carbonFigurePanels } from '@/plugins/builtin/env/carbon';
import { parseAbundanceCsv, biodiversityFigurePanels } from '@/plugins/builtin/env/biodiversity';

import aqiWeekCsv from '../examples/data/env-aqi-week.csv?raw';
import waterRiverCsv from '../examples/data/env-water-river.csv?raw';
import biodiversitySitesCsv from '../examples/data/env-biodiversity-sites.csv?raw';
import carbonPoolsCsv from '../examples/data/env-carbon-pools.csv?raw';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';
import { BUILTIN_EXAMPLES } from '@/core/examples';

const closeTo = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const fieldSum = (c: Float64Array) => c.reduce((a, b) => a + b, 0);
const ENV_IDS = [
  'example.env-aqi',
  'example.env-water',
  'example.env-greenhouse',
  'example.env-carbon',
  'example.env-biodiversity',
  'example.env-plume',
  'example.env-earth3d',
];

// ---- AQI --------------------------------------------------------------------

describe('envCore · AQI', () => {
  it('iaqi: PM2.5 = 35 μg/m³ → IAQI = 50 (CN band edge)', () => {
    expect(closeTo(iaqi(CN_BREAKPOINTS.pm25!, 35)!, 50, 1e-9)).toBe(true);
  });
  it('iaqi: piecewise-linear interpolation inside a band', () => {
    expect(closeTo(iaqi(CN_BREAKPOINTS.pm25!, 55)!, 75, 1e-9)).toBe(true);
    expect(closeTo(iaqi(CN_BREAKPOINTS.pm25!, 88)!, 116.25, 1e-9)).toBe(true);
  });
  it('iaqi: negative and above-top concentrations are out of evaluation', () => {
    expect(iaqi(CN_BREAKPOINTS.pm25!, -1)).toBeNull();
    expect(iaqi(CN_BREAKPOINTS.pm25!, 600)).toBeNull();
  });
  it('computeAqi: AQI = max IAQI and the primary pollutant follows', () => {
    const res = computeAqi({ so2: 10, no2: 20, pm25: 88, pm10: 100, co: 1, o3: 60 }, 'cn');
    expect(res.primary).toBe('pm25');
    expect(closeTo(res.aqi!, 116.25, 1e-9)).toBe(true);
  });
  it('computeAqi: out-of-range and dropped pollutants are flagged, not fatal', () => {
    const res = computeAqi({ pm25: 600, so2: -3, no2: 20 }, 'cn');
    expect(res.outOfRange).toContain('pm25');
    expect(res.dropped).toContain('so2');
    expect(res.primary).toBe('no2');
  });
  it('computeAqi: US 2024 EPA breakpoints give ~99 for PM2.5 = 35 μg/m³', () => {
    const res = computeAqi({ pm25: 35 }, 'us');
    expect(res.primary).toBe('pm25');
    expect(closeTo(res.aqi!, 99.24, 0.5)).toBe(true);
  });
  it('aqiBand maps 35→优, 75→良, 250→重度污染', () => {
    expect(aqiBand(35)!.zh).toBe('优');
    expect(aqiBand(75)!.zh).toBe('良');
    expect(aqiBand(250)!.zh).toBe('重度污染');
    expect(aqiBand(null)).toBeNull();
  });
});

// ---- Water quality ----------------------------------------------------------

describe('envCore · water quality (GB 3838-2002)', () => {
  it('classifyIndicator: DO is higher-better, COD/TP lower-better', () => {
    expect(classifyIndicator('do', 7.9)).toBe(1);
    expect(classifyIndicator('do', 5.5)).toBe(3);
    expect(classifyIndicator('cod', 6.5)).toBe(4);
    expect(classifyIndicator('tp', 0.5)).toBeNull();
  });
  it('classifyIndicator: pH is two-sided 6–9', () => {
    expect(classifyIndicator('ph', 7)).toBe(1);
    expect(classifyIndicator('ph', 5.5)).toBeNull();
    expect(classifyIndicator('ph', 10)).toBeNull();
  });
  it('evaluateWaterSite: worst class governs (single-factor method)', () => {
    const res = evaluateWaterSite({
      name: 'test',
      values: { ph: 7, do: 5.5, cod: 6.5, nh3n: 0.9 },
    });
    expect(res.worstClass).toBe(4); // COD Ⅳ worse than NH₃-N Ⅲ / DO Ⅲ
    expect(res.exceeded).toEqual([]);
  });
  it('computeWqi returns a finite 0-100 score', () => {
    const wqi = computeWqi({ ph: 7.4, do: 8.6, cod: 1.8, bod: 1.4, nh3n: 0.12, tp: 0.018 });
    expect(wqi).not.toBeNull();
    expect(wqi!).toBeGreaterThan(0);
    expect(wqi!).toBeLessThanOrEqual(100);
  });
});

// ---- Greenhouse -------------------------------------------------------------

describe('envCore · greenhouse (0-D energy balance)', () => {
  it('reference state (280 ppm, α 0.30, cloud 0.5): Te ≈ 255 K, ΔF = 0, Ts ≈ 14.6 ℃', () => {
    const r = greenhouseModel({ co2ppm: 280, albedo: 0.3, cloud: 0.5 });
    expect(closeTo(r.effectiveTempK, 254.6, 0.6)).toBe(true);
    expect(closeTo(r.forcing, 0, 1e-9)).toBe(true);
    expect(closeTo(r.deltaT, 0, 1e-9)).toBe(true);
    expect(closeTo(r.surfaceTempC, 14.6, 0.6)).toBe(true);
  });
  it('doubling CO₂ warms ≈ 3 K (Myhre + λ = 0.8)', () => {
    const r = greenhouseModel({ co2ppm: 560, albedo: 0.3, cloud: 0.5 });
    expect(closeTo(r.deltaT, 0.8 * 5.35 * Math.LN2, 0.05)).toBe(true);
  });
  it('warming is monotonic in CO₂', () => {
    const a = greenhouseModel({ co2ppm: 400, albedo: 0.3, cloud: 0.5 }).surfaceTempC;
    const b = greenhouseModel({ co2ppm: 800, albedo: 0.3, cloud: 0.5 }).surfaceTempC;
    expect(b).toBeGreaterThan(a);
  });
});

// ---- Carbon cycle -----------------------------------------------------------

describe('envCore · carbon box model', () => {
  it('zero emission is a steady state (pre-industrial flux balance)', () => {
    const run = carbonRun({ ...CARBON_INITIAL }, 0, 10);
    expect(Math.abs(run[1]!.atmChange)).toBeLessThan(1e-9);
  });
  it('internal fluxes cancel: Σ pools grows only by emissions', () => {
    const run = carbonRun({ ...CARBON_INITIAL }, 9, 100);
    const total = (p: typeof CARBON_INITIAL) => p.atmosphere + p.vegetation + p.soil + p.ocean;
    const gain = total(run[100]!.pools) - total(run[0]!.pools);
    expect(closeTo(gain, 900, 1e-6)).toBe(true);
  });
});

// ---- Biodiversity -----------------------------------------------------------

describe('envCore · biodiversity indices', () => {
  it('uniform two species: H′ = ln 2, Simpson = 0.5, J = 1', () => {
    const d = diversityIndex([50, 50], ['a', 'b']);
    expect(closeTo(d.shannon!, Math.LN2, 1e-9)).toBe(true);
    expect(closeTo(d.simpson!, 0.5, 1e-9)).toBe(true);
    expect(closeTo(d.evenness!, 1, 1e-9)).toBe(true);
  });
  it('single species: H′ = 0, dominant share = 1, evenness undefined', () => {
    const d = diversityIndex([100, 0], ['a', 'b']);
    expect(closeTo(d.shannon!, 0, 1e-9)).toBe(true);
    expect(d.dominant).toBe('a');
    expect(closeTo(d.dominantShare!, 1, 1e-9)).toBe(true);
    expect(d.evenness).toBeNull();
  });
  it('empty plot yields nulls instead of NaN', () => {
    const d = diversityIndex([0, 0], ['a', 'b']);
    expect(d.shannon).toBeNull();
    expect(d.simpson).toBeNull();
  });
});

// ---- Gaussian plume ---------------------------------------------------------

describe('envCore · gaussian plume (Pasquill–Gifford)', () => {
  it('σ grows with downwind distance; unstable class spreads wider', () => {
    const d1 = sigmaYZ('D', 100);
    const d2 = sigmaYZ('D', 1000);
    expect(d2.sy).toBeGreaterThan(d1.sy);
    expect(d2.sz).toBeGreaterThan(d1.sz);
    expect(sigmaYZ('A', 1000).sy).toBeGreaterThan(sigmaYZ('D', 1000).sy);
  });
  it('concentration is zero in calm wind / at the stack, decays crosswind', () => {
    expect(plumeConcentration(1e6, 0, 'D', 50, 500, 0)).toBe(0);
    expect(plumeConcentration(1e6, 3, 'D', 50, 0, 0)).toBe(0);
    const near = plumeConcentration(1e6, 3, 'D', 50, 500, 0);
    const far = plumeConcentration(1e6, 3, 'D', 50, 500, 1000);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });
  it('max ground-level centreline concentration is located downwind', () => {
    const peak = maxGroundConcentration(1e6, 3, 'D', 80);
    expect(peak.x).toBeGreaterThan(0);
    expect(peak.c).toBeGreaterThan(0);
  });
});

// ---- Lake / global / groundwater ---------------------------------------------

describe('envCore · lake, global and groundwater helpers', () => {
  it('lakeProfile: 25 points, surface matches input, summer profile is non-increasing in T', () => {
    const pts = lakeProfile(30, 26, 3, 0.5);
    expect(pts.length).toBe(25);
    expect(closeTo(pts[0]!.temp, 26, 1e-9)).toBe(true);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]!.temp).toBeLessThanOrEqual(pts[i - 1]!.temp + 1e-9);
      expect(pts[i]!.do).toBeGreaterThanOrEqual(0);
    }
  });
  it('surfaceCo2 keeps the inter-hemispheric gradient; albedo rises poleward', () => {
    expect(surfaceCo2(45, 1)).toBeGreaterThan(surfaceCo2(-45, 1));
    expect(surfaceAlbedo(75)).toBe(0.75);
    expect(closeTo(surfaceAlbedo(0), 0.12, 1e-9)).toBe(true);
    expect(surfaceAlbedo(65)).toBeGreaterThan(surfaceAlbedo(45));
  });
  it('groundwaterStep conserves mass and clamps unstable steps', () => {
    const mk = () => ({ nx: 6, ny: 1, nz: 1, c: new Float64Array([100, 0, 0, 0, 0, 0]) });
    const g1 = mk();
    const r1 = groundwaterStep(g1, { velocity: 1, dispL: 1, dx: 10, dt: 0.5 });
    expect(r1.clamped).toBe(false);
    expect(closeTo(fieldSum(g1.c), 100, 1e-9)).toBe(true);
    const g2 = mk();
    const r2 = groundwaterStep(g2, { velocity: 10, dispL: 5, dx: 10, dt: 20 });
    expect(r2.clamped).toBe(true);
    expect(closeTo(fieldSum(g2.c), 100, 1e-6)).toBe(true);
    expect(Math.min(...g2.c)).toBeGreaterThanOrEqual(0);
  });
  it('pumpWell removes a fraction of the local concentration', () => {
    const g = { nx: 4, ny: 1, nz: 1, c: new Float64Array([0, 100, 0, 0]) };
    pumpWell(g, 1, 0, 0, 0.5);
    expect(closeTo(g.c[1]!, 50, 1e-9)).toBe(true);
    pumpWell(g, 99, 0, 0); // out of range: no-op
    expect(closeTo(fieldSum(g.c), 50, 1e-9)).toBe(true);
  });
});

// ---- Sample data integration (示例栏 → 一键出结论) -----------------------------

describe('env sample data end-to-end', () => {
  it('AQI week: 7 samples parse, day3 is PM2.5-driven ~116 (CN), panels render', () => {
    const samples = parseAqiCsv(aqiWeekCsv);
    expect(samples).not.toBeNull();
    expect(samples!.length).toBe(7);
    expect(samples![2]!.values.pm25).toBe(88);
    const res = computeAqi(samples![2]!.values, 'cn');
    expect(res.primary).toBe('pm25');
    expect(closeTo(res.aqi!, 116.25, 1e-9)).toBe(true);
    expect(aqiFigurePanels(samples!, 'cn').length).toBeGreaterThan(0);
    expect(aqiFigurePanels(samples!, 'us').length).toBeGreaterThan(0);
    // every evaluated AQI is finite (no NaN reaches the UI)
    for (const s of samples!) {
      const r = computeAqi(s.values, 'cn');
      if (r.aqi !== null) expect(Number.isFinite(r.aqi)).toBe(true);
    }
  });
  it('water river: 4 sites; R1 clean, R3 degraded to class Ⅴ; panels render', () => {
    const sheet = parseWaterCsv(waterRiverCsv);
    expect(sheet).not.toBeNull();
    expect(sheet!.sites.length).toBe(4);
    const results = sheet!.sites.map((s) => evaluateWaterSite(s));
    expect(results[0]!.worstClass).toBeLessThanOrEqual(2);
    expect(results[2]!.worstClass).toBe(5); // NH₃-N 1.8 → Ⅴ
    for (const r of results) {
      expect(r.wqi).not.toBeNull();
      expect(Number.isFinite(r.wqi!)).toBe(true);
    }
    expect(waterFigurePanels(sheet!).length).toBeGreaterThan(0);
  });
  it('biodiversity: 12 taxa × 3 sites, site_1 more diverse than the urban pond', () => {
    const m = parseAbundanceCsv(biodiversitySitesCsv);
    expect(m).not.toBeNull();
    expect(m!.species.length).toBe(12);
    expect(m!.sites).toEqual(['site_1', 'site_2', 'site_3']);
    expect(m!.droppedSites).toEqual([]);
    const d1 = diversityIndex(m!.counts[0]!, m!.species);
    const d3 = diversityIndex(m!.counts[2]!, m!.species);
    expect(d1.shannon!).toBeGreaterThan(d3.shannon!);
    expect(d3.dominant).toBe('摇蚊');
    expect(d3.dominantShare!).toBeGreaterThan(0.6);
    expect(biodiversityFigurePanels(m!).length).toBeGreaterThan(0);
  });
  it('carbon pools: custom CSV feeds the run with conserved emissions', () => {
    const custom = parseCarbonCsv(carbonPoolsCsv);
    expect(custom).not.toBeNull();
    expect(custom!.pools.atmosphere).toBe(590);
    expect(custom!.pools.ocean).toBe(38000);
    expect(custom!.external.atmosphere).toBe(9);
    expect(custom!.external.vegetation).toBe(-1.5);
    const initial = { ...CARBON_INITIAL, ...custom!.pools };
    // The plugin maps the CSV atmosphere flux onto the emission slider and
    // folds the remaining pool fluxes into the external forcing: net Σ change
    // is (emission + Σ external) × years = (9 − 1.5) × 50.
    const emission = custom!.external.atmosphere ?? 0;
    const restExternal = { ...custom!.external };
    delete restExternal.atmosphere;
    const run = carbonRun(initial, emission, 50, restExternal);
    const total = (p: typeof CARBON_INITIAL) => p.atmosphere + p.vegetation + p.soil + p.ocean;
    expect(closeTo(total(run[50]!.pools) - total(run[0]!.pools), 375, 1e-6)).toBe(true);
    for (const p of Object.values(run[50]!.pools)) expect(Number.isFinite(p)).toBe(true);
    expect(carbonFigurePanels(run).length).toBeGreaterThan(0);
  });
});

// ---- Registration -------------------------------------------------------------

describe('env suite registration', () => {
  it('all 7 environmental plugins are registered', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    for (const id of ENV_IDS) expect(ids).toContain(id);
  });
  it('every env plugin belongs to the env discipline', () => {
    for (const id of ENV_IDS) expect(disciplineOf(id)).toBe('env');
  });
  it('four env samples are registered for the 示例 dialog', () => {
    const envExamples = BUILTIN_EXAMPLES.filter((e) => e.pluginId.startsWith('example.env-'));
    expect(envExamples.map((e) => e.id).sort()).toEqual(
      [
        'env-aqi-week',
        'env-biodiversity-sites',
        'env-carbon-pools',
        'env-water-river',
      ].sort(),
    );
    for (const e of envExamples) expect(e.content).toBeTruthy();
  });
});
