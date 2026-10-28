import { describe, expect, it } from 'vitest';
import {
  createState,
  fieldStats,
  GRAY_SCOTT_PRESETS,
  isFiniteState,
  maxStableDt,
  seedCenter,
  seedRandom,
  step,
  stepN,
  totalMass,
} from '../src/plugins/builtin/chem/turing/kernel';

const STD = { f: 0.03, k: 0.062, du: 0.16, dv: 0.08, dt: 1.0 } as const;

describe('chem-turing Gray–Scott kernel', () => {
  it('benchmark: closed reactor (f = k = 0) conserves Σ(u+v) to 1e-10 relative', () => {
    // With the feed/drain switched off the reaction term cancels cell by cell
    // and both periodic Laplacians sum to zero, so only floating-point
    // round-off can move the total mass.
    const gs = createState(48);
    seedRandom(gs, 7, 8);
    const m0 = totalMass(gs);
    expect(m0).toBeGreaterThan(0);
    stepN(gs, { f: 0, k: 0, du: 0.16, dv: 0.08, dt: 0.5 }, 300);
    const drift = Math.abs(totalMass(gs) - m0) / m0;
    expect(drift).toBeLessThan(1e-10);
  });

  it('benchmark: pure diffusion (v = 0) conserves Σu exactly to round-off', () => {
    const gs = createState(32);
    seedRandom(gs, 3, 4);
    gs.v.fill(0);
    const u0 = totalMass(gs);
    stepN(gs, { f: 0, k: 0, du: 0.2, dv: 0.05, dt: 0.4 }, 200);
    expect(Math.abs(totalMass(gs) - u0) / u0).toBeLessThan(1e-12);
  });

  it('benchmark: 5000 steps at standard parameters stay finite (no NaN/Inf)', () => {
    const gs = createState(64);
    seedCenter(gs, 0.5);
    stepN(gs, { ...STD }, 5000);
    expect(gs.steps).toBe(5000);
    expect(isFiniteState(gs)).toBe(true);
  });

  it('benchmark: (f,k) = (0.030, 0.062) settles to a spot-like pattern (qualitative Pearson anchor)', () => {
    // QUALITATIVE criterion, not a quantitative Pearson prediction: the steady
    // v-field of the "soliton spots" regime must (a) cover a small-but-nonzero
    // fraction of the domain, (b) carry real contrast, and (c) have a finite
    // correlation length — calibrated against a 64² reference run
    // (coverage ≈ 0.266, std ≈ 0.111, autocorr(lag 8) ≈ −0.03).
    const gs = createState(64);
    seedCenter(gs, 0.5);
    stepN(gs, { ...STD }, 5000);
    const s = fieldStats(gs, 'v', 0.15, 8);
    expect(s.coverage).toBeGreaterThan(0.002);
    expect(s.coverage).toBeLessThan(0.4);
    expect(s.std).toBeGreaterThan(0.05);
    expect(s.autocorr).toBeLessThan(0.95);
  });

  it('FTCS stability bound: dt ≤ 1/(4·max(Du,Dv))', () => {
    expect(maxStableDt(0.16, 0.08)).toBeCloseTo(1.5625, 12);
    expect(maxStableDt(0.1, 0.25)).toBeCloseTo(1.0, 12);
  });

  it('evolution beyond the stability bound diverges (finite check catches NaN)', () => {
    const gs = createState(24);
    seedCenter(gs, 0.9);
    stepN(gs, { f: 0.03, k: 0.062, du: 0.16, dv: 0.08, dt: 50 }, 50);
    expect(isFiniteState(gs)).toBe(false);
  });

  it('seeding is deterministic for a fixed seed', () => {
    const a = createState(32);
    const b = createState(32);
    seedRandom(a, 42, 6);
    seedRandom(b, 42, 6);
    expect(Array.from(a.v)).toEqual(Array.from(b.v));
    // And a different seed differs.
    seedRandom(b, 43, 6);
    expect(Array.from(a.v)).not.toEqual(Array.from(b.v));
  });

  it('single step updates the step counter and swaps buffers in place', () => {
    const gs = createState(16);
    seedCenter(gs, 0.5);
    const uBefore = Array.from(gs.u);
    step(gs, { ...STD });
    expect(gs.steps).toBe(1);
    expect(Array.from(gs.u)).not.toEqual(uBefore);
    // The feed term keeps u bounded in [0, 1] early on.
    for (const val of gs.u) expect(val!).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('Pearson presets carry the classic (f, k) values and stay in slider ranges', () => {
    const keys = GRAY_SCOTT_PRESETS.map((p) => p.key);
    expect(keys).toContain('spots');
    expect(keys).toContain('uskate');
    const spots = GRAY_SCOTT_PRESETS.find((p) => p.key === 'spots')!;
    expect(spots.f).toBeCloseTo(0.03, 6);
    expect(spots.k).toBeCloseTo(0.062, 6);
    for (const p of GRAY_SCOTT_PRESETS) {
      expect(p.f).toBeGreaterThanOrEqual(0.005);
      expect(p.f).toBeLessThanOrEqual(0.08);
      expect(p.k).toBeGreaterThanOrEqual(0.03);
      expect(p.k).toBeLessThanOrEqual(0.07);
    }
  });
});
