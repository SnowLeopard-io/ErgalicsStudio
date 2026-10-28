import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arrivalTime,
  darcyLaw,
  erfc,
  fitCooperJacob,
  jacobDrawdown,
  jacobError,
  ogataBanks,
  parsePumpingCsv,
  runHydrogeologyBenchmarks,
  superpositionDrawdown,
  theisDrawdown,
  tidalResponse,
  wellFunction,
  type Well,
} from '../src/plugins/builtin/geo/hydrogeology/kernel';

describe('geo-hydrogeology · well hydraulics', () => {
  it('W(1) matches the tabulated exponential integral', () => {
    expect(wellFunction(1)).toBeCloseTo(0.2193839344, 6);
  });

  it('Theis and Cooper–Jacob agree when u is small', () => {
    const input = { q: 500, t: 1000, s: 1e-4, r: 50, time: 2 };
    expect(jacobError(input)).toBeLessThan(1e-3);
    expect(jacobDrawdown(input)).toBeGreaterThan(0);
  });

  it('drawdown increases with pumping time', () => {
    const base = { q: 800, t: 1200, s: 2e-4, r: 60 };
    const early = theisDrawdown({ ...base, time: 0.01 }).drawdownM;
    const late = theisDrawdown({ ...base, time: 1 }).drawdownM;
    expect(late).toBeGreaterThan(early);
  });

  it('multi-well drawdown is linear in pumping rate', () => {
    const wells: Well[] = [
      { id: 'W1', x: 0, y: 0, q: 300, radius: 0.15, startTime: 0 },
      { id: 'W2', x: 400, y: 0, q: 150, radius: 0.15, startTime: 0 },
    ];
    const one = superpositionDrawdown({ wells, t: 2, s: 1e-4, transmissivity: 900, x: 200, y: 100 });
    const two = superpositionDrawdown({
      wells: wells.map((w) => ({ ...w, q: 2 * w.q })),
      t: 2,
      s: 1e-4,
      transmissivity: 900,
      x: 200,
      y: 100,
    });
    expect(two).toBeCloseTo(2 * one, 12);
  });
});

describe('geo-hydrogeology · Darcy and transport', () => {
  it('Darcy hand calculation: K=10, dh/dl=-0.01, n=0.25', () => {
    const d = darcyLaw({ k: 10, dh: -1, dl: 100, porosity: 0.25 });
    expect(d.darcyVelocity).toBeCloseTo(0.1, 12);
    expect(d.seepageVelocity).toBeCloseTo(0.4, 12);
  });

  it('erfc is symmetric and normalised', () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1) + erfc(-1)).toBeCloseTo(2, 6);
  });

  it('Ogata–Banks front sits at C/C0 = 0.5', () => {
    expect(ogataBanks(100, 100, 1, 0, 10)).toBeCloseTo(0.5, 9);
    expect(ogataBanks(0, 100, 1, 0, 10)).toBeGreaterThan(0.5);
  });

  it('retardation delays the arrival time', () => {
    expect(arrivalTime(1000, 0.4, 2)).toBeCloseTo(5000, 9);
  });
});

describe('geo-hydrogeology · pumping test and tidal response', () => {
  it('parses and fits the bundled synthetic pumping test', () => {
    const pts = parsePumpingCsv(readFileSync('examples/data/geo-hydro-pumping.csv', 'utf8'));
    expect(pts.length).toBe(32);
    const fit = fitCooperJacob(pts, 800, 60);
    expect(fit.transmissivity).toBeCloseTo(1200, 0);
    expect(fit.storativity).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it('tidal amplitude attenuates and phase lag grows with depth', () => {
    const omega = (2 * Math.PI) / 0.5175;
    const shallow = tidalResponse({ amplitude: 1, omega, diffusivity: 1000, depth: 10 });
    const deep = tidalResponse({ amplitude: 1, omega, diffusivity: 1000, depth: 100 });
    expect(shallow.amplitudeRatio).toBeLessThanOrEqual(1);
    expect(deep.amplitudeRatio).toBeLessThan(shallow.amplitudeRatio);
    expect(deep.phaseLagHours).toBeGreaterThan(shallow.phaseLagHours);
  });

  it('all declared benchmarks pass', () => {
    expect(runHydrogeologyBenchmarks().every((b) => b.pass)).toBe(true);
  });
});
