// math-topology kernel tests — seam gluings, Euler characteristics, loops,
// homeomorphism morphs and the embedded validation benchmarks
import { describe, it, expect } from 'vitest';
import {
  LOOP_PRESETS,
  MORPH_PRESETS,
  SURFACE_PRESETS,
  buildSphereMesh,
  buildSurfaceMesh,
  loopClosureGap,
  loopLength,
  meshEulerCounts,
  morphCurvePoints,
  morphKeyframe,
  relativeError,
  runTopologyBenchmarks,
  surfacePoint,
  superellipsePoint,
  verifyGenusChi,
  type SurfaceId,
  type SurfaceShape,
} from '../src/plugins/builtin/math-topology/kernel';

const SHAPE: SurfaceShape = { R: 1.2, w: 0.5 };
const TOL = 1e-12;

function close3(a: [number, number, number], b: [number, number, number], tol = TOL): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

describe('parametric surfaces and seam gluings', () => {
  it('satisfies the seam identity of every surface', () => {
    const vs = [0, 0.7, Math.PI, 4.2, 2 * Math.PI - 0.3];
    for (const v of vs) {
      // torus: P(2π, v) = P(0, v)
      expect(close3(surfacePoint('torus', 2 * Math.PI, v, SHAPE), surfacePoint('torus', 0, v, SHAPE))).toBe(true);
      // Möbius band: P(2π, v) = P(0, −v)
      expect(close3(surfacePoint('mobius', 2 * Math.PI, v, SHAPE), surfacePoint('mobius', 0, -v, SHAPE))).toBe(true);
      // Klein bottle: P(2π, v) = P(0, 2π − v), hence P(4π, v) = P(0, v)
      expect(close3(surfacePoint('klein', 2 * Math.PI, v, SHAPE), surfacePoint('klein', 0, 2 * Math.PI - v, SHAPE))).toBe(true);
      expect(close3(surfacePoint('klein', 4 * Math.PI, v, SHAPE), surfacePoint('klein', 0, v, SHAPE))).toBe(true);
    }
  });

  it('produces finite coordinates on every sample surface preset', () => {
    for (const preset of SURFACE_PRESETS) {
      const mesh = buildSurfaceMesh(preset.id, { R: preset.R, w: preset.w, segU: 24, segV: 16 });
      expect(mesh.positions.length, preset.id).toBeGreaterThan(0);
      for (const x of mesh.positions) expect(Number.isFinite(x), preset.id).toBe(true);
      expect(mesh.indices.length % 3, preset.id).toBe(0);
      for (const idx of mesh.indices) {
        expect(idx, preset.id).toBeGreaterThanOrEqual(0);
        expect(idx, preset.id).toBeLessThan(mesh.positions.length / 3);
      }
    }
  });
});

describe('Euler characteristic V − E + F', () => {
  it('gives χ = 0 for the torus and Klein bottle grids', () => {
    for (const id of ['torus', 'klein'] as SurfaceId[]) {
      const counts = meshEulerCounts(buildSurfaceMesh(id, { R: 1.2, w: 0.5, segU: 32, segV: 16 }));
      expect(counts.chi, id).toBe(0);
    }
  });

  it('gives χ = 0 for the Möbius band (boundary included)', () => {
    const counts = meshEulerCounts(buildSurfaceMesh('mobius', { R: 1.2, w: 0.6, segU: 32, segV: 16 }));
    expect(counts.chi).toBe(0);
  });

  it('gives χ = 2 for the sphere with single-vertex poles', () => {
    const counts = meshEulerCounts(buildSphereMesh(1, 24, 16));
    expect(counts.chi).toBe(2);
  });

  it('verifies χ = 2 − 2g for every genus selector value 0 … 5', () => {
    for (let g = 0; g <= 5; g += 1) {
      const v = verifyGenusChi(g);
      expect(v.expectedChi, `g=${g}`).toBe(2 - 2 * g);
      expect(v.counts.chi, `g=${g}`).toBe(2 - 2 * g);
      expect(v.passed, `g=${g}`).toBe(true);
      expect(v.relErr, `g=${g}`).toBe(0);
    }
  });
});

describe('relative error convention', () => {
  it('uses a unit denominator when the analytic value is zero', () => {
    expect(relativeError(0.5, 0)).toBe(0.5);
    expect(relativeError(0, 0)).toBe(0);
    expect(relativeError(3, 2)).toBeCloseTo(0.5, 12);
    expect(relativeError(-1, -4)).toBeCloseTo(0.75, 12);
  });
});

describe('loops and deformation retraction', () => {
  it('every demo loop is closed on its own surface', () => {
    for (const preset of LOOP_PRESETS) {
      const shape = SURFACE_PRESETS.find((p) => p.id === preset.surface)!;
      const gap = loopClosureGap(preset.surface, { R: shape.R, w: shape.w }, preset.spec, 0);
      expect(gap, preset.id).toBeLessThan(1e-9);
    }
  });

  it('stays closed along the whole retraction and shrinks contractible loops to a point', () => {
    for (const preset of LOOP_PRESETS) {
      const shape = SURFACE_PRESETS.find((p) => p.id === preset.surface)!;
      for (const t of [0.25, 0.5, 1]) {
        const gap = loopClosureGap(preset.surface, { R: shape.R, w: shape.w }, preset.spec, t);
        expect(gap, `${preset.id}@${t}`).toBeLessThan(1e-9);
      }
      const l0 = loopLength(preset.surface, { R: shape.R, w: shape.w }, preset.spec, 0);
      const l1 = loopLength(preset.surface, { R: shape.R, w: shape.w }, preset.spec, 1);
      if (preset.spec.p === 0 && preset.spec.q === 0) {
        // Fully contractible loop: stage 1 collapses it onto its base point.
        expect(l1, `${preset.id}: collapses`).toBeLessThan(1e-9);
        expect(l1, `${preset.id}: shrinks`).toBeLessThanOrEqual(l0 + 1e-9);
      } else {
        // The retraction keeps the homotopy class: the core curve survives
        // with positive length (its 3-D arc length may differ from stage 0,
        // since parameter-space contraction does not shrink the embedding).
        expect(l1, `${preset.id}: core curve keeps positive length`).toBeGreaterThan(1e-6);
      }
    }
  });
});

describe('homeomorphism morphs (superellipse family)', () => {
  it('points satisfy the implicit equation |x/a|ⁿ + |y/b|ⁿ = 1', () => {
    for (const preset of MORPH_PRESETS) {
      for (const t of [0, 0.37, 0.5, 1]) {
        const kf = morphKeyframe(preset, t);
        for (const theta of [0, 0.9, 2.1, 4.4]) {
          const [x, y] = superellipsePoint(theta, kf);
          const lhs = Math.pow(Math.abs(x / kf.a), kf.n) + Math.pow(Math.abs(y / kf.b), kf.n);
          expect(Math.abs(lhs - 1), `${preset.id}@${t}`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('interpolates between the declared keyframes and returns a closed curve', () => {
    for (const preset of MORPH_PRESETS) {
      expect(morphKeyframe(preset, 0), preset.id).toEqual(preset.from);
      expect(morphKeyframe(preset, 1), preset.id).toEqual(preset.to);
      const pts = morphCurvePoints(preset, 0.5, 64);
      expect(pts.length, preset.id).toBe(65);
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), preset.id).toBeLessThan(1e-12);
      for (const [x, y] of pts) {
        expect(Number.isFinite(x) && Number.isFinite(y), preset.id).toBe(true);
      }
    }
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all four benchmarks within the spec tolerances', () => {
    const bench = runTopologyBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'torus-euler',
      'sphere-euler',
      'mobius-normal-reversal',
      'surface-finite-closed',
    ]);
    for (const b of bench) expect(b.passed, b.id).toBe(true);
    const byId = new Map(bench.map((b) => [b.id, b]));
    // χ identities are exact integer counts → zero relative error.
    expect(byId.get('torus-euler')!.relErr).toBe(0);
    expect(byId.get('sphere-euler')!.relErr).toBe(0);
    // One-sidedness: dot ≈ −1 against the orientable reference +1 → relErr ≈ 2.
    const mobius = byId.get('mobius-normal-reversal')!.relErr;
    expect(mobius).toBeGreaterThanOrEqual(1.9);
    expect(mobius).toBeLessThanOrEqual(2.1);
    // Seam closure under the unified |computed − analytic|/|analytic| metric.
    expect(byId.get('surface-finite-closed')!.relErr).toBeLessThan(1e-12);
  });
});
