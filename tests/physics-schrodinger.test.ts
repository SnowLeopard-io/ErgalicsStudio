import { describe, expect, it } from 'vitest';
import {
  analyticLevels,
  buildGrid,
  buildPotential,
  cnStep,
  DEFAULT_POTENTIAL_PARAMS,
  domainFor,
  freePacketCenter,
  freePacketWidth,
  gaussianPacket,
  makeCnWork,
  packetStats,
  relErr,
  solveStationary,
} from '../src/plugins/builtin/physics-schrodinger/kernel';

describe('physics-schrodinger stationary states', () => {
  it('infinite well: E_n ~ n^2 pi^2 (hbar^2/2mL^2 = 1), relative error < 1e-3', () => {
    // Domain [0, 1] with width L = 1 -> E1 = pi^2 ~ 9.8696, E2 = 4 pi^2 ~ 39.478.
    const [x0, x1] = domainFor('well', { ...DEFAULT_POTENTIAL_PARAMS, width: 1 });
    const grid = buildGrid(x0, x1, 300);
    const V = buildPotential('well', { ...DEFAULT_POTENTIAL_PARAMS, width: 1 }, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    expect(sol.energies.length).toBe(300);
    expect(relErr(sol.energies[0]!, Math.PI ** 2)).toBeLessThan(1e-3);
    expect(relErr(sol.energies[1]!, 4 * Math.PI ** 2)).toBeLessThan(1e-3);
    expect(relErr(sol.energies[2]!, 9 * Math.PI ** 2)).toBeLessThan(1e-3);
    // Spectral ratio E2/E1 -> 4 is the n^2 signature.
    expect(Math.abs(sol.energies[1]! / sol.energies[0]! - 4)).toBeLessThan(1e-3);
  });

  it('infinite well eigenfunctions match sin(n pi x / L) nodes and orthogonality', () => {
    const grid = buildGrid(0, 1, 300);
    const V = buildPotential('well', { ...DEFAULT_POTENTIAL_PARAMS, width: 1 }, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    // Level n=1 (0-based) has a node at x = 0.5.
    let left = 0;
    let right = 0;
    for (let i = 0; i < grid.x.length; i++) {
      const xi = grid.x[i]!;
      if (xi < 0.5) left += sol.psi[1]![i]!;
      else if (xi > 0.5) right += sol.psi[1]![i]!;
    }
    expect(left * right).toBeLessThan(0);
    // <psi_i | psi_j> = delta_ij for the lowest five levels.
    for (let a = 0; a < 5; a++) {
      for (let b = a; b < 5; b++) {
        let s = 0;
        for (let i = 0; i < grid.x.length; i++) s += sol.psi[a]![i]! * sol.psi[b]![i]!;
        s *= grid.dx;
        expect(Math.abs(s - (a === b ? 1 : 0))).toBeLessThan(a === b ? 1e-10 : 1e-9);
      }
    }
  });

  it('harmonic oscillator: E_n = (n + 1/2) omega with omega = 2 -> E0 = 1, E1 = 3 (< 1e-2)', () => {
    const params = { ...DEFAULT_POTENTIAL_PARAMS, omega: 2 };
    const [x0, x1] = domainFor('harmonic', params);
    const grid = buildGrid(x0, x1, 400);
    const V = buildPotential('harmonic', params, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    expect(relErr(sol.energies[0]!, 1)).toBeLessThan(1e-2);
    expect(relErr(sol.energies[1]!, 3)).toBeLessThan(1e-2);
    expect(relErr(sol.energies[2]!, 5)).toBeLessThan(1e-2);
    expect(relErr(sol.energies[5]!, 11)).toBeLessThan(1e-2);
  });

  it('harmonic oscillator ground state width matches sigma = sqrt(2/omega) (m = 1/2 units)', () => {
    const params = { ...DEFAULT_POTENTIAL_PARAMS, omega: 2 };
    const [x0, x1] = domainFor('harmonic', params);
    const grid = buildGrid(x0, x1, 400);
    const V = buildPotential('harmonic', params, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    const p = sol.psi[0]!;
    let mx = 0;
    let mx2 = 0;
    let norm = 0;
    for (let i = 0; i < grid.x.length; i++) {
      const d = p[i]! * p[i]! * grid.dx;
      norm += d;
      mx += d * grid.x[i]!;
      mx2 += d * grid.x[i]! * grid.x[i]!;
    }
    mx /= norm;
    mx2 /= norm;
    const sigma = Math.sqrt(mx2 - mx * mx);
    // <x^2> = hbar/(2 m omega) with m = 1/2 -> sigma = 1/sqrt(omega) = 0.7071.
    expect(relErr(sigma, 1 / Math.sqrt(params.omega))).toBeLessThan(1e-3);
  });

  it('finite well bound levels match the transcendental parity equations (< 5e-3)', () => {
    const params = { ...DEFAULT_POTENTIAL_PARAMS, depth: 40, halfWidth: 1 };
    const [x0, x1] = domainFor('finite-well', params);
    const grid = buildGrid(x0, x1, 800);
    const V = buildPotential('finite-well', params, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    const ref = analyticLevels('finite-well', params, 3);
    expect(ref[0]).not.toBeNull();
    expect(ref[1]).not.toBeNull();
    expect(ref[2]).not.toBeNull();
    expect(relErr(sol.energies[0]!, ref[0]!)).toBeLessThan(5e-3);
    expect(relErr(sol.energies[1]!, ref[1]!)).toBeLessThan(5e-3);
    expect(relErr(sol.energies[2]!, ref[2]!)).toBeLessThan(5e-3);
    // All finite-difference levels below the well depth reproduce the analytic list.
    expect(sol.energies[0]!).toBeLessThan(params.depth);
  });

  it('analytic levels: well ~ n^2, harmonic ~ n + 1/2, double well yields null', () => {
    const well = analyticLevels('well', { ...DEFAULT_POTENTIAL_PARAMS, width: 1 }, 3);
    expect(well.map((v) => (v === null ? NaN : v / Math.PI ** 2))).toEqual([1, 4, 9]);
    const ho = analyticLevels('harmonic', { ...DEFAULT_POTENTIAL_PARAMS, omega: 2 }, 2);
    expect(ho).toEqual([1, 3]);
    expect(analyticLevels('double-well', DEFAULT_POTENTIAL_PARAMS, 3)).toEqual([null, null, null]);
  });
});

describe('physics-schrodinger Crank-Nicolson dynamics', () => {
  it('free Gaussian packet: centre follows x0 + 2 k0 t, width follows spreading law (< 2%)', () => {
    const sigma0 = 0.6;
    const k0 = 2.5;
    const x0 = -1.5;
    const tFinal = 0.5;
    const grid = buildGrid(-20, 20, 1200);
    const V = new Float64Array(grid.x.length); // free particle
    const { re, im } = gaussianPacket(grid.x, grid.dx, x0, sigma0, k0);
    const w = makeCnWork(grid.x.length);
    const dt = 0.001;
    const steps = Math.round(tFinal / dt);
    for (let s = 0; s < steps; s++) cnStep(re, im, V, grid.dx, dt, w);
    const t = steps * dt;
    const st = packetStats(re, im, grid.x, grid.dx);
    const centreRef = freePacketCenter(x0, k0, t);
    const widthRef = freePacketWidth(sigma0, t);
    expect(relErr(st.meanX, centreRef)).toBeLessThan(0.02);
    expect(relErr(st.sigmaX, widthRef)).toBeLessThan(0.02);
  });

  it('Crank-Nicolson is unitary: norm conserved to < 1e-10 over 400 steps', () => {
    const grid = buildGrid(-20, 20, 800);
    const V = new Float64Array(grid.x.length);
    const { re, im } = gaussianPacket(grid.x, grid.dx, -2, 0.5, 3);
    const w = makeCnWork(grid.x.length);
    const st0 = packetStats(re, im, grid.x, grid.dx);
    for (let s = 0; s < 400; s++) cnStep(re, im, V, grid.dx, 0.001, w);
    const st1 = packetStats(re, im, grid.x, grid.dx);
    expect(Math.abs(st1.norm - st0.norm)).toBeLessThan(1e-10);
    expect(Math.abs(st1.norm - 1)).toBeLessThan(1e-10);
  });

  it('remains stable in a harmonic trap (no blow-up over 2000 steps)', () => {
    const params = { ...DEFAULT_POTENTIAL_PARAMS, omega: 2 };
    const [x0, x1] = domainFor('harmonic', params);
    const grid = buildGrid(x0, x1, 400);
    const V = buildPotential('harmonic', params, grid.x);
    const { re, im } = gaussianPacket(grid.x, grid.dx, -3, 0.5, 0);
    const w = makeCnWork(grid.x.length);
    for (let s = 0; s < 2000; s++) cnStep(re, im, V, grid.dx, 0.002, w);
    const st = packetStats(re, im, grid.x, grid.dx);
    expect(st.norm).toBeGreaterThan(0.999);
    expect(st.norm).toBeLessThan(1.001);
    // Breathing packet stays inside the trap domain.
    expect(Number.isFinite(st.sigmaX)).toBe(true);
    expect(st.sigmaX).toBeLessThan(8);
  });
});
