// env-predator-prey kernel validation: RK4 conservation, orbit closure,
// linearized frequency, regression fit recovery and the bundled Hudson Bay CSV.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LV_PARAMS,
  fitLv,
  linearOmega,
  lvConserved,
  lvEquilibrium,
  measurePeriod,
  orbitClosure,
  parseLvCsv,
  runLvBenchmarks,
  simulateLv,
} from '../src/plugins/builtin/env-predator-prey/kernel';

const P = DEFAULT_LV_PARAMS;
const T0 = (2 * Math.PI) / linearOmega(P);

describe('env-predator-prey kernel (Lotka–Volterra)', () => {
  it('drifts the conserved quantity V by less than 1e-3 over 10 periods', () => {
    const s = simulateLv(P, 10 * T0, 24000);
    const v0 = lvConserved(P.x0, P.y0, P);
    const vEnd = lvConserved(s.x[s.x.length - 1]!, s.y[s.y.length - 1]!, P);
    expect(Math.abs(vEnd - v0) / Math.abs(v0)).toBeLessThan(1e-3);
  });

  it('closes the orbit after one full period within 1e-3 relative', () => {
    const s = simulateLv(P, 12 * T0, 24000);
    expect(orbitClosure(s.times, s.x, s.y)).toBeLessThan(1e-3);
  });

  it('places the coexistence equilibrium at (γ/δ, α/β) = (2, 10)', () => {
    const eq = lvEquilibrium(P);
    expect(eq.xStar).toBeCloseTo(2, 12);
    expect(eq.yStar).toBeCloseTo(10, 12);
    expect(linearOmega(P)).toBeCloseTo(Math.sqrt(P.alpha * P.gamma), 12);
  });

  it('oscillates at √(αγ) for a 1% perturbation at equilibrium (within 5%)', () => {
    const eq = lvEquilibrium(P);
    const s = simulateLv({ ...P, x0: eq.xStar * 1.01, y0: eq.yStar }, 20 * T0, 24000);
    const tMeas = measurePeriod(s.times, s.x);
    expect(tMeas).not.toBeNull();
    const wMeas = (2 * Math.PI) / tMeas!;
    expect(Math.abs(wMeas - linearOmega(P)) / linearOmega(P)).toBeLessThan(0.05);
  });

  it('recovers α/β/γ/δ from simulated data by regression within 5%', () => {
    const s = simulateLv(P, 6 * T0, 1200);
    const fit = fitLv(s.times, s.x, s.y);
    expect(fit).not.toBeNull();
    expect(fit!.alpha / P.alpha).toBeCloseTo(1, 1);
    expect(Math.abs(fit!.alpha - P.alpha) / P.alpha).toBeLessThan(0.05);
    expect(Math.abs(fit!.beta - P.beta) / P.beta).toBeLessThan(0.05);
    expect(Math.abs(fit!.gamma - P.gamma) / P.gamma).toBeLessThan(0.05);
    expect(Math.abs(fit!.delta - P.delta) / P.delta).toBeLessThan(0.05);
  });

  it('parses the bundled hudson-bay-lynx-hare.csv (matched HBC pairs)', () => {
    const text = readFileSync(join('examples', 'data', 'hudson-bay-lynx-hare.csv'), 'utf8');
    const data = parseLvCsv(text);
    // 42 matched hare + lynx annual returns, 1849-1890 (Elton & Nicholson 1942).
    expect(data.times.length).toBe(42);
    expect(data.times[0]).toBe(1849);
    expect(data.times[data.times.length - 1]).toBe(1890);
    expect(data.x[0]).toBe(24301); // hare 1849
    expect(data.y[0]).toBe(43253); // lynx 1849
    const fit = fitLv(data.times, data.x, data.y);
    expect(fit).not.toBeNull();
    expect(Number.isFinite(fit!.alpha)).toBe(true);
    expect(Number.isFinite(fit!.beta)).toBe(true);
    expect(Number.isFinite(fit!.gamma)).toBe(true);
    expect(Number.isFinite(fit!.delta)).toBe(true);
    // The famous ~10-year fur-return cycle is cleanest in the lynx peak
    // spacing (1858/1868/1877/1887); the hare series carries double peaks.
    const period = measurePeriod(data.times, data.y);
    expect(period).not.toBeNull();
    expect(period!).toBeGreaterThan(7);
    expect(period!).toBeLessThan(14);
  });

  it('passes the embedded validation battery', () => {
    for (const b of runLvBenchmarks()) expect(b.pass).toBe(true);
  });
});
