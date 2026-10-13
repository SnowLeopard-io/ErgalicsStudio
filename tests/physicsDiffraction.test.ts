import { describe, expect, it } from 'vitest';
import {
  AIRY_RING_FACTOR,
  apertureEnergy,
  besselJ0,
  besselJ1,
  benchmarkAiryRing,
  benchmarkDoubleSlitSpacing,
  benchmarkEnergyConservation,
  benchmarkSingleSlitMinima,
  findLocalMaxima,
  findLocalMinima,
  fraunhofer1d,
  fresnelNumber,
  sampleCircleIntensity,
  sampleSlitIntensity,
  screenEnergyCircle,
  screenEnergySlit,
  type DiffractionParams,
} from '../src/plugins/builtin/physics-diffraction/kernel';

const farSlit: DiffractionParams = {
  aperture: 'slit',
  a: 8,
  d: 0,
  nSlits: 1,
  radius: 0,
  lambda: 1,
  L: 4e5,
  screenHalf: 6e4,
};

describe('physics-diffraction kernel — validation benchmarks', () => {
  it('benchmark ①: single-slit minima sit at x_m = m·λL/a (rel err < 1e-3)', () => {
    const b = benchmarkSingleSlitMinima();
    expect(b.positions.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const rel = Math.abs(b.positions[i]! - b.theory[i]!) / b.theory[i]!;
      expect(rel).toBeLessThan(1e-3);
    }
    expect(b.maxRelErr).toBeLessThan(1e-3);
  });

  it('benchmark ②: double-slit fringe spacing Δx = λL/d (rel err < 1e-2)', () => {
    const b = benchmarkDoubleSlitSpacing();
    expect(b.measured).toBeGreaterThan(0);
    expect(b.relErr).toBeLessThan(1e-2);
  });

  it('benchmark ③: near-field energy conservation ∫I dx = N·a (rel err < 5e-2)', () => {
    const b = benchmarkEnergyConservation();
    expect(b.numeric).toBeGreaterThan(0);
    expect(b.relErr).toBeLessThan(5e-2);
  });

  it('benchmark ④: Airy first dark ring r₁ = 1.21967·λL/D (rel err < 1e-3)', () => {
    const b = benchmarkAiryRing();
    expect(b.measured).toBeGreaterThan(0);
    expect(b.theory).toBeCloseTo(AIRY_RING_FACTOR * 1e5, 1);
    expect(b.relErr).toBeLessThan(1e-3);
  });
});

describe('physics-diffraction kernel — special functions', () => {
  it('J₀ matches table values in the series regime', () => {
    expect(besselJ0(1)).toBeCloseTo(0.7651977, 6);
    expect(besselJ0(5)).toBeCloseTo(-0.1775968, 6);
    expect(besselJ0(10)).toBeCloseTo(-0.2459358, 6);
  });

  it('J₁ matches table values in the series regime', () => {
    expect(besselJ1(1)).toBeCloseTo(0.4400506, 6);
    expect(besselJ1(5)).toBeCloseTo(-0.3275791, 6);
    expect(besselJ1(10)).toBeCloseTo(0.0434727, 6);
  });

  it('J₀/J₁ agree with an independent integral reference on both sides of the |z| = 20 splice', () => {
    // The series branch (|z| < 20) and the asymptotic branch (|z| ≥ 20) must
    // both track the smooth true function. The integral representations
    // J₀ = (1/π)∫cos(z·sinθ)dθ, J₁ = (1/π)∫cos(z·sinθ − θ)dθ are
    // branch-independent references. (Comparing besselJ0(20−ε) against
    // besselJ0(20+ε) directly would instead measure the function's own
    // variation 2ε·|J₁|/|J₀| ≈ 8e-4 across the gap.)
    for (const z of [19.999, 20.001]) {
      const j0r = j0Reference(z);
      expect(Math.abs(besselJ0(z) - j0r) / Math.abs(j0r)).toBeLessThan(1e-6);
      const j1r = j1Reference(z);
      expect(Math.abs(besselJ1(z) - j1r) / Math.abs(j1r)).toBeLessThan(1e-6);
    }
  });
});

// Independent numeric references via the Bessel integral representations
// (smooth integrands on [0, π], composite Simpson, n = 8001 → error ≪ 1e-8).
function j0Reference(z: number): number {
  const n = 8001;
  const h = Math.PI / (n - 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const th = i * h;
    const w = i === 0 || i === n - 1 ? 1 : i % 2 === 0 ? 2 : 4;
    acc += w * Math.cos(z * Math.sin(th));
  }
  return (acc * h) / 3 / Math.PI;
}

function j1Reference(z: number): number {
  const n = 8001;
  const h = Math.PI / (n - 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const th = i * h;
    const w = i === 0 || i === n - 1 ? 1 : i % 2 === 0 ? 2 : 4;
    acc += w * Math.cos(z * Math.sin(th) - th);
  }
  return (acc * h) / 3 / Math.PI;
}

describe('physics-diffraction kernel — far-field consistency', () => {
  it('numeric Fresnel field converges to the Fraunhofer slit reference (F ≪ 1)', () => {
    expect(fresnelNumber(farSlit)).toBeLessThan(1e-4);
    const prof = sampleSlitIntensity(farSlit, 801);
    let peak = 0;
    let maxDiff = 0;
    for (let i = 0; i < prof.xs.length; i++) {
      const ref = fraunhofer1d(prof.xs[i]!, farSlit)!;
      peak = Math.max(peak, ref);
      maxDiff = Math.max(maxDiff, Math.abs(prof.ys[i]! - ref));
    }
    expect(maxDiff / peak).toBeLessThan(0.01);
  });

  it('numeric 4-slit grating matches the Fraunhofer grating formula pointwise', () => {
    const p: DiffractionParams = { ...farSlit, aperture: 'grating', d: 40, nSlits: 4 };
    const prof = sampleSlitIntensity(p, 801);
    let peak = 0;
    let maxDiff = 0;
    for (let i = 0; i < prof.xs.length; i++) {
      const ref = fraunhofer1d(prof.xs[i]!, p)!;
      peak = Math.max(peak, ref);
      maxDiff = Math.max(maxDiff, Math.abs(prof.ys[i]! - ref));
    }
    expect(maxDiff / peak).toBeLessThan(0.01);
  });
});

describe('physics-diffraction kernel — unitarity (energy conservation)', () => {
  it('double slit conserves ∫I dx = N·a in the near field (L = 500λ)', () => {
    const p: DiffractionParams = { ...farSlit, aperture: 'double', a: 8, d: 40, L: 500, screenHalf: 400 };
    const energy = screenEnergySlit(p, 1601);
    const total = apertureEnergy(p);
    expect(total).toBeCloseTo(16, 9);
    expect(Math.abs(energy - total) / total).toBeLessThan(0.05);
  });

  it('circular hole conserves 2π∫r·I dr = πR² in the near field (L = 500λ)', () => {
    const p: DiffractionParams = { ...farSlit, aperture: 'circle', radius: 20, L: 500, screenHalf: 300 };
    const energy = screenEnergyCircle(p, 1201);
    const total = apertureEnergy(p);
    expect(total).toBeCloseTo(Math.PI * 400, 9);
    expect(Math.abs(energy - total) / total).toBeLessThan(0.05);
  });

  it('far-field circle profile matches the exact encircled energy 1−J₀²−J₁²', () => {
    const p: DiffractionParams = { ...farSlit, aperture: 'circle', radius: 5, L: 1e6, screenHalf: 4e5 };
    const prof = sampleCircleIntensity(p, 4001);
    // Simpson over 2π r I(r) dr
    const h = p.screenHalf / (prof.xs.length - 1);
    let acc = 0;
    for (let i = 0; i < prof.xs.length; i++) {
      const w = i === 0 || i === prof.xs.length - 1 ? 1 : i % 2 === 0 ? 2 : 4;
      acc += w * prof.xs[i]! * prof.ys[i]!;
    }
    const energy = (acc * h) / 3 * 2 * Math.PI;
    // The Airy tail extends beyond any finite window: the exact energy
    // enclosed within r ≤ screenHalf is πR²·(1 − J₀²(z) − J₁²(z)),
    // z = π·D·r/(λL) — compare against that, not the bare unitary πR².
    const zMax = (Math.PI * 2 * p.radius * p.screenHalf) / (p.lambda * p.L);
    const encircled = apertureEnergy(p) * (1 - besselJ0(zMax) ** 2 - besselJ1(zMax) ** 2);
    expect(Math.abs(energy - encircled) / encircled).toBeLessThan(0.01);
  });
});

describe('physics-diffraction kernel — extreme-point refinement', () => {
  it('parabolic refinement recovers the vertex of a sampled parabola', () => {
    const n = 201;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i * 0.1;
      ys[i] = (xs[i]! - 1.234) ** 2 + 0.5;
    }
    const minima = findLocalMinima(xs, ys);
    expect(minima.length).toBe(1);
    expect(minima[0]!.x).toBeCloseTo(1.234, 6);
    // `value` is the raw sampled intensity at the central sample, which sits
    // slightly above the true vertex value 0.5 (vertex is off-grid).
    expect(minima[0]!.value).toBeGreaterThan(0.5);
    expect(minima[0]!.value).toBeLessThan(0.51);

    const ys2 = new Float64Array(n);
    // Vertex must lie inside the sampled window xs ∈ [0, 20].
    for (let i = 0; i < n; i++) ys2[i] = 2 - (xs[i]! - 3.456) ** 2;
    const maxima = findLocalMaxima(xs, ys2);
    expect(maxima.length).toBe(1);
    expect(maxima[0]!.x).toBeCloseTo(3.456, 6);
  });
});
