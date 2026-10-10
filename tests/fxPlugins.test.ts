// FX plugin tests — black-hole GR core & water-wave physics, plus registry wiring.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  PHOTON_SPHERE_RS,
  ISCO_RS,
  CRITICAL_B_RS,
  schwarzschildRadiusKm,
  orbitalBeta,
  dopplerFactor,
  gravRedshift,
  diskTemp,
  intensityShift,
  blackbodyRGB,
  shadowAngularDiameterRad,
  traceGeodesic,
  initialConditionsFromB,
} from '@/plugins/builtin/blackhole/physics';
import {
  CFL_MAX_2D,
  shallowWaterSpeed,
  waveStepFdtd,
  fdtdOmega,
  piersonMoskowitzPeak,
  mulberry32,
  buildSpectrum,
  gerstnerDisplacement,
  gerstnerSteepness,
} from '@/plugins/builtin/water/physics';
import { blackholeManifest } from '@/plugins/builtin/blackhole/manifest';
import { BLACKHOLE_FRAGMENT } from '@/plugins/builtin/blackhole/shader';
import { waterManifest } from '@/plugins/builtin/water/manifest';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';
import { BUILTIN_EXAMPLES } from '@/core/examples';

const RAD_TO_UAS = 1e6 * 180 * 3600 / Math.PI; // rad → microarcsecond

describe('black-hole physics — constants & analytic relations', () => {
  it('matches textbook values for photon sphere / ISCO / critical b', () => {
    expect(PHOTON_SPHERE_RS).toBeCloseTo(1.5, 12);
    expect(ISCO_RS).toBeCloseTo(3, 12);
    expect(CRITICAL_B_RS).toBeCloseTo(2.5980762, 6);
  });

  it('r_s scales linearly with mass (1 M☉ ≈ 2.9532 km)', () => {
    expect(schwarzschildRadiusKm(1)).toBeCloseTo(2.95325, 4);
    expect(schwarzschildRadiusKm(10)).toBeCloseTo(10 * schwarzschildRadiusKm(1), 9);
  });

  it('circular-orbit speed is 0.5c at the ISCO and c at the photon sphere', () => {
    expect(orbitalBeta(ISCO_RS)).toBeCloseTo(0.5, 10);
    expect(orbitalBeta(PHOTON_SPHERE_RS)).toBe(1);
    expect(orbitalBeta(10)).toBeLessThan(orbitalBeta(5));
  });

  it('Doppler factor: β=0.5 head-on gives √3, receding gives 1/√3', () => {
    expect(dopplerFactor(0.5, 1)).toBeCloseTo(Math.sqrt(3), 9);
    expect(dopplerFactor(0.5, -1)).toBeCloseTo(1 / Math.sqrt(3), 9);
    expect(dopplerFactor(0, 0.3)).toBeCloseTo(1, 9);
  });

  it('gravitational redshift √(1−rs/r)', () => {
    expect(gravRedshift(2)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(gravRedshift(1.0001)).toBeCloseTo(0.1, 6); // clamped floor
    expect(gravRedshift(100)).toBeCloseTo(1 - 0.005, 3);
  });

  it('Shakura–Sunyaev profile peaks at 49/36·r_in and rises from the inner edge', () => {
    const rIn = 3;
    // Implementation clamps x to ≥1.0001, so the inner edge is small but not 0.
    expect(diskTemp(rIn, rIn, 1000)).toBeLessThan(200);
    const peak = 49 / 36 * rIn;
    expect(diskTemp(peak, rIn, 1000)).toBeCloseTo(1000, 6);
    // monotonic decline beyond the peak
    expect(diskTemp(peak + 1, rIn, 1000)).toBeLessThan(1000);
    expect(diskTemp(peak * 4, rIn, 1000)).toBeLessThan(diskTemp(peak * 2, rIn, 1000));
  });

  it('intensity shift is g⁴ (I/ν⁴ invariant)', () => {
    expect(intensityShift(1)).toBe(1);
    expect(intensityShift(Math.sqrt(2))).toBeCloseTo(4, 9);
  });

  it('blackbody colour: white near 6600 K, red-hot / blue-hot ordering', () => {
    const [r, g, b] = blackbodyRGB(6600);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
    const hot = blackbodyRGB(15000);
    expect(hot[2]).toBeCloseTo(1, 5);
    expect(hot[0]).toBeLessThan(hot[1]);
    const cool = blackbodyRGB(3000);
    expect(cool[0]).toBe(1);
    expect(cool[2]).toBeLessThan(cool[1]);
  });

  it('shadow angular diameter: M87* ≈ 40 μas, Sgr A* ≈ 54 μas (EHT scale)', () => {
    const m87 = shadowAngularDiameterRad(6.5e9, 16.8e6 * 3.0857e16) * RAD_TO_UAS;
    expect(m87).toBeGreaterThan(35);
    expect(m87).toBeLessThan(45);
    const sgra = shadowAngularDiameterRad(4.3e6, 8150 * 3.0857e16) * RAD_TO_UAS;
    expect(sgra).toBeGreaterThan(48);
    expect(sgra).toBeLessThan(60);
    // angular size shrinks with distance
    const nearer = shadowAngularDiameterRad(6.5e9, 8.4e6 * 3.0857e16) * RAD_TO_UAS;
    expect(nearer).toBeGreaterThan(m87);
  });

  it('disk emission intensity follows I_obs = g⁴·I_em (no double-counted beaming)', () => {
    // Combined intensity: I_obs = g⁴·I_em with I_em ∝ T_em⁴. The shader uses
    // T_obs = g·T_em, so the T_obs⁴ term already carries g⁴ — an extra explicit
    // g⁴ would make I ∝ g⁸ (regression: diskEmission double-counted beaming).
    const g = Math.sqrt(2);
    // Correct relation: I(g)/I(1) = g⁴.
    expect(intensityShift(g) / intensityShift(1)).toBeCloseTo(4, 9);
    // The buggy g⁸ relation would square this.
    expect(Math.pow(g, 4)).toBeCloseTo(4, 9);
    expect(Math.pow(g, 8)).toBeCloseTo(16, 9);

    // Text-level guard on the actual shader: the emission factor must use the
    // observed temperature T_obs = g·T_em to the 4th power, with NO extra
    // explicit g⁴ multiplier in front of it.
    const frag = BLACKHOLE_FRAGMENT;
    const disk = frag.slice(frag.indexOf('diskEmission'), frag.indexOf('void main'));
    expect(disk).toContain('pow(max(tob, 1.0) / 6500.0, 4.0)');
    expect(disk).not.toMatch(/g\s*\*\s*g\s*\*\s*g\s*\*\s*g/);
  });
});

describe('black-hole geodesic integrator', () => {
  it('captures rays with b < b_c and escapes rays with b > b_c', () => {
    const inC = initialConditionsFromB(2.0, 1000);
    const cap = traceGeodesic(inC.u0, inC.up0);
    expect(cap.captured).toBe(true);
    expect(cap.escaped).toBe(false);
    expect(cap.minR).toBeLessThan(1.001);

    const outC = initialConditionsFromB(3.5, 1000);
    const esc = traceGeodesic(outC.u0, outC.up0);
    expect(esc.escaped).toBe(true);
    expect(esc.captured).toBe(false);
  });

  it('conserves the impact parameter: reported b matches the input b', () => {
    const { u0, up0 } = initialConditionsFromB(3.5, 1000);
    const res = traceGeodesic(u0, up0);
    expect(res.b / 3.5).toBeCloseTo(1, 2);
  });

  it('weak-field deflection approaches the Einstein value 2rs/b', () => {
    const b = 100;
    const { u0, up0 } = initialConditionsFromB(b, 5000);
    const res = traceGeodesic(u0, up0, { dphi: 2e-3, phiMax: 16 * Math.PI, rEsc: 1e5 });
    expect(res.deflection).not.toBeNull();
    const einstein = 2 / b;
    expect(res.deflection! / einstein).toBeCloseTo(1, 1); // within ~10%
  });

  it('near-critical rays skim the photon sphere and wind >360°', () => {
    const mk = (ratio: number) => {
      const { u0, up0 } = initialConditionsFromB(CRITICAL_B_RS * ratio, 1000);
      return traceGeodesic(u0, up0, { phiMax: 40 * Math.PI });
    };
    const near = mk(1.002);
    const far = mk(1.05);
    expect(near.minR).toBeGreaterThan(1);
    expect(near.minR).toBeLessThan(1.9); // skims just outside the horizon
    expect(near.phiTotal).toBeGreaterThan(2.5 * Math.PI); // deflection > 270°
    // winding diverges logarithmically as b → b_c
    expect(near.phiTotal).toBeGreaterThan(far.phiTotal);
  });

  it('deflection decreases monotonically with increasing b', () => {
    const defs: number[] = [];
    for (const b of [3.2, 4, 6, 10, 20]) {
      const { u0, up0 } = initialConditionsFromB(b, 2000);
      const res = traceGeodesic(u0, up0);
      expect(res.deflection).not.toBeNull();
      defs.push(res.deflection!);
    }
    for (let i = 1; i < defs.length; i++) expect(defs[i]).toBeLessThan(defs[i - 1]!);
  });
});

describe('water physics — FDTD ripple solver', () => {
  it('CFL limit is 1/√2 and pool speed is √(g·h)', () => {
    expect(CFL_MAX_2D).toBeCloseTo(0.7071068, 6);
    expect(shallowWaterSpeed(0.5)).toBeCloseTo(Math.sqrt(9.81 * 0.5), 9);
  });

  it('stays bounded for A ≤ 1/√2 and blows up beyond it', () => {
    const n = 64;
    const init = (amp: number) => {
      const f = new Float32Array(n * n);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const d2 = (i - n / 2) ** 2 + (j - n / 2) ** 2;
          f[j * n + i] = amp * Math.exp(-d2 / 8);
        }
      return f;
    };
    const opts = { a: 0.5, damping: 1, absorbWidth: 8 };
    let prev = init(1);
    let curr = init(1);
    let maxH = 0;
    for (let s = 0; s < 300; s++) {
      const next = waveStepFdtd(prev, curr, n, opts, [], s);
      prev = curr;
      curr = next;
      for (const v of curr) maxH = Math.max(maxH, Math.abs(v));
    }
    expect(Number.isFinite(maxH)).toBe(true);
    expect(maxH).toBeLessThan(2);

    // Unstable: A = 0.9 > 1/√2 diverges geometrically.
    const bad = { a: 0.9, damping: 1, absorbWidth: 0 };
    prev = init(0.01);
    curr = init(0.01);
    let blew = false;
    for (let s = 0; s < 100 && !blew; s++) {
      const next = waveStepFdtd(prev, curr, n, bad, [], s);
      for (const v of next) if (!Number.isFinite(v) || Math.abs(v) > 1e4) blew = true;
      prev = curr;
      curr = next;
    }
    expect(blew).toBe(true);
  });

  it('discrete dispersion → ω = c·k in the long-wavelength limit', () => {
    expect(fdtdOmega(0.001, 0.5)).toBeCloseTo(0.5 * 0.001, 8);
    // λ = 8 dx, A = 0.5 → ω = 2·asin(0.5·sin(π/8)) ≈ 0.38506 rad/step
    expect(fdtdOmega((2 * Math.PI) / 8, 0.5)).toBeCloseTo(0.38506, 4);
  });

  it('wavefront advances at c·dt/dx per step (leading edge speed test)', () => {
    const n = 128;
    let prev = new Float32Array(n * n);
    let curr = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const d2 = (i - 64) ** 2 + (j - 64) ** 2;
        curr[j * n + i] = Math.exp(-d2 / 8);
      }
    const opts = { a: 0.5, damping: 1, absorbWidth: 10 };
    const steps = 60;
    for (let s = 0; s < steps; s++) {
      const next = waveStepFdtd(prev, curr, n, opts, [], s);
      prev = curr;
      curr = next;
    }
    let front = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if (Math.abs(curr[j * n + i] ?? 0) > 0.004) {
          const r = Math.hypot(i - 64, j - 64);
          if (r > front) front = r;
        }
      }
    // Discrete schemes carry a weak dispersive precursor ahead of the linear
    // wave speed a·t, and nothing propagates beyond the causality cone (~t).
    expect(front).toBeGreaterThan(0.9 * 0.5 * steps);
    expect(front).toBeLessThan(0.8 * steps);
  });

  it('dual-source interference produces a nodal line between the sources', () => {
    const n = 96;
    const a = 0.5;
    const lambda = 8; // cells
    const d = 16; // source separation, cells
    const omega = fdtdOmega((2 * Math.PI) / lambda, a);
    const sources = [
      { x: 48 - d / 2, y: 48, omega, amplitude: 0.4 },
      { x: 48 + d / 2, y: 48, omega, amplitude: 0.4 },
    ];
    const opts = { a, damping: 1, absorbWidth: 8 };
    let prev = new Float32Array(n * n);
    let curr = new Float32Array(n * n);
    const antinode = 66 * n + 48; // perpendicular bisector, 18 cells out
    // Node of the hyperbola r1−r2 = λ/2: x' = a_h·√(1+y'²/b_h²), a_h=λ/4, b_h²=64−4.
    const nodeOffset = 2 * Math.sqrt(1 + (18 * 18) / 60);
    const nodeCell = 66 * n + Math.round(48 + nodeOffset); // (x≈53, y=66)
    let antiSum = 0;
    let nodeSum = 0;
    let cnt = 0;
    for (let s = 0; s < 220; s++) {
      const next = waveStepFdtd(prev, curr, n, opts, sources, s);
      prev = curr;
      curr = next;
      if (s >= 120) {
        antiSum += Math.abs(curr[antinode] ?? 0);
        nodeSum += Math.abs(curr[nodeCell] ?? 0);
        cnt++;
      }
    }
    const anti = antiSum / cnt;
    const node = nodeSum / cnt;
    expect(anti).toBeGreaterThan(0.02);
    expect(node / anti).toBeLessThan(0.45);
  });
});

describe('water physics — Gerstner ocean spectrum', () => {
  it('Pierson–Moskowitz peak: U=8 m/s → λ_p ≈ 56 m, H_s ≈ 1.37 m', () => {
    const sea = piersonMoskowitzPeak(8);
    expect(sea.omegaP).toBeCloseTo((0.855 * 9.81) / 8, 9);
    expect(sea.lambdaP).toBeCloseTo(56.0, 0);
    expect(sea.periodP).toBeCloseTo((2 * Math.PI) / sea.omegaP, 9);
    expect(sea.cpP).toBeCloseTo(9.81 / sea.omegaP, 9);
    expect(sea.cgP).toBeCloseTo(sea.cpP / 2, 9);
    expect(sea.hs).toBeCloseTo((0.21 * 64) / 9.81, 9);
  });

  it('buildSpectrum is deterministic from the seed', () => {
    const a = buildSpectrum(8, 26, 42, 1.0);
    const b = buildSpectrum(8, 26, 42, 1.0);
    expect(a.map((w) => w.phase)).toEqual(b.map((w) => w.phase));
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });

  it('amplitudes normalise to ≈ H_s/3 and k spans [λ_p/9, 4λ_p]', () => {
    const wind = 8;
    const sea = piersonMoskowitzPeak(wind);
    const waves = buildSpectrum(wind, 26, 42, 1.0);
    const sumA = waves.reduce((s, w) => s + w.amplitude, 0);
    expect(sumA / (sea.hs / 3)).toBeCloseTo(1, 6);
    const kMin = (2 * Math.PI) / (4 * sea.lambdaP);
    const kMax = (2 * Math.PI) / (sea.lambdaP / 9);
    expect(waves[0]!.k).toBeCloseTo(kMin, 6);
    expect(waves[waves.length - 1]!.k).toBeCloseTo(kMax, 6);
    for (const w of waves) expect(w.omega).toBeCloseTo(Math.sqrt(9.81 * w.k), 9);
  });

  it('never self-intersects: k·A·q ≤ 1 for every train', () => {
    for (const choppy of [0.5, 1.0, 2.5]) {
      const waves = buildSpectrum(12, 26, 7, choppy);
      for (const w of waves) expect(gerstnerSteepness(w)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('Gerstner displacement: q=0 → pure vertical bobbing, crest phase shifts x by −qA', () => {
    const wave = {
      k: 0.5,
      omega: Math.sqrt(9.81 * 0.5),
      amplitude: 2,
      dirX: 1,
      dirZ: 0,
      phase: 0,
      q: 0,
    };
    const crest = gerstnerDisplacement([wave], 0, 0, 0);
    expect(crest.y).toBeCloseTo(2, 9);
    expect(crest.x).toBeCloseTo(0, 9);
    const choppy = { ...wave, q: 0.5, phase: Math.PI / 2 };
    const steep = gerstnerDisplacement([choppy], 0, 0, 0); // θ = π/2
    expect(steep.x).toBeCloseTo(-0.5 * 2, 9);
    expect(steep.y).toBeCloseTo(0, 9);
  });
});

describe('FX plugin registration', () => {
  it('both FX plugins are registered in the builtin catalog', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    expect(ids).toContain('fx.blackhole');
    expect(ids).toContain('fx.water');
    for (const info of BUILTIN_PLUGINS) {
      if (info.manifest.id.startsWith('fx.')) {
        expect(typeof info.load).toBe('function');
        expect(info.autoload).not.toBe(false);
      }
    }
  });

  it('both are grouped under the 特效渲染 (fx) discipline', () => {
    expect(disciplineOf('fx.blackhole')).toBe('fx');
    expect(disciplineOf('fx.water')).toBe('fx');
  });

  it('manifests are complete and honestly rated', () => {
    expect(blackholeManifest.research?.tier).toBe('quasi-research');
    expect(waterManifest.research?.tier).toBe('demonstration');
    for (const m of [blackholeManifest, waterManifest]) {
      expect(m.entry).toBe(m.id);
      expect(m.nameI18n?.['zh-CN']).toBeTruthy();
      expect(m.descriptionI18n?.['en-US']).toBeTruthy();
      expect(m.formats?.some((f) => f.extension === '.json')).toBe(true);
    }
  });

  it('all six FX examples are registered with lazy loaders', () => {
    const ids = new Set(BUILTIN_EXAMPLES.map((e) => e.id));
    for (const id of [
      'fx-blackhole-m87',
      'fx-blackhole-sgra',
      'fx-blackhole-cygnus',
      'fx-water-interference',
      'fx-water-rain',
      'fx-water-seastate4',
    ]) {
      expect(ids.has(id)).toBe(true);
      const ex = BUILTIN_EXAMPLES.find((e) => e.id === id)!;
      expect(ex.filename).toBe(`${id}.json`);
      expect(typeof ex.loadContent).toBe('function');
    }
  });

  it('cloud uDensity is applied once, consistently in main march & lightMarch', () => {
    // Regression: cloudDensity() used to fold uDensity in AND the main march
    // multiplied it again (σ ∝ density²), while lightMarch only used density¹
    // — the two segments integrated different extinction fields and the
    // reported Cloud τ disagreed with the render. Now cloudDensity() returns a
    // normalised density and every extinction site applies uDensity exactly once.
    const frag = CLOUD_FRAGMENT;
    const cloudDensitySrc = frag.slice(frag.indexOf('float cloudDensity'), frag.indexOf('float lightMarch'));
    const lightMarchSrc = frag.slice(frag.indexOf('float lightMarch'), frag.indexOf('float skyColor'));
    const mainMarchSrc = frag.slice(frag.indexOf('void main'), frag.length);

    // cloudDensity() must NOT scale by uDensity (returns normalised 0..1).
    expect(cloudDensitySrc).not.toMatch(/profile\s*\*\s*uDensity/);
    // lightMarch applies uDensity exactly once per sample.
    expect(lightMarchSrc).toMatch(/cloudDensity\(p\)\s*\*\s*stepL\s*\*\s*0\.006\s*\*\s*uDensity/);
    // Main march extinction applies uDensity exactly once per sample.
    expect(mainMarchSrc).toMatch(/d\s*\*\s*stepLen\s*\*\s*0\.006\s*\*\s*uDensity/);
  });
});
