// ==========================================================================
// math-topology — parametric surfaces, triangulations and homotopy demos
// (pure, dependency-free, testable)
//
// Contents:
//   - parametric equations of the torus, Möbius band and Klein bottle
//     (figure-8 immersion) plus grid triangulations whose seam gluings
//     encode the correct surface topology (the twist included);
//   - Euler-characteristic counting V − E + F on those triangulations and
//     on the standard 4g-gon polygon schema, so χ = 2 − 2g is verified
//     numerically for every genus;
//   - loop families on the surfaces with a continuous deformation
//     retraction (homotopy stage) and superellipse morphs for the
//     homeomorphism demo;
//   - the built-in sample dataset SURFACE_PRESETS and the embedded
//     validation suite runTopologyBenchmarks().
//
// All functions are pure so the kernel unit-tests without a canvas, DOM or
// WebGL. The unified error metric throughout is |computed − analytic|/|analytic|
// (unit denominator when the analytic value is zero, where the absolute
// error of the dimensionless quantity equals the relative one).
// ==========================================================================

// ---- parametric surfaces ---------------------------------------------------------

/** Identifiers of the embedded sample surfaces. */
export type SurfaceId = 'torus' | 'mobius' | 'klein';

export interface SurfaceShape {
  /** Major radius: distance from the rotation axis to the tube/strip centre. */
  R: number;
  /** Tube radius (torus), half-width (Möbius band), cross-cap scale (Klein). */
  w: number;
}

export interface SurfaceParams extends SurfaceShape {
  /** Grid segments along the u (revolution) direction. */
  segU: number;
  /** Grid segments along the v (cross-section) direction. */
  segV: number;
}

/**
 * Point of the parametric immersion. `u` is the revolution angle and `v` the
 * cross-section parameter: an angle on the torus / Klein bottle, the
 * half-width coordinate in [−1, 1] on the Möbius band.
 *
 * Seam identities that the mesh gluing relies on:
 *   torus:  P(2π, v) = P(0, v);
 *   Möbius: P(2π, v) = P(0, −v);
 *   Klein:  P(2π, v) = P(0, 2π − v)  (equivalently P(u + 2π, v) = P(u, 2π − v)).
 */
export function surfacePoint(
  id: SurfaceId,
  u: number,
  v: number,
  shape: SurfaceShape,
): [number, number, number] {
  const { R, w } = shape;
  if (id === 'torus') {
    const c = R + w * Math.cos(v);
    return [c * Math.cos(u), w * Math.sin(v), c * Math.sin(u)];
  }
  if (id === 'mobius') {
    const c = R + w * v * Math.cos(u / 2);
    return [c * Math.cos(u), w * v * Math.sin(u / 2), c * Math.sin(u)];
  }
  // Klein bottle, figure-8 immersion (period 4π in u, seam twist in v).
  const t = Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v);
  const s = Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v);
  const c = R + w * t;
  return [c * Math.cos(u), w * s, c * Math.sin(u)];
}

export interface SurfacePreset {
  id: SurfaceId;
  labelEn: string;
  labelZh: string;
  /** Default major radius. */
  R: number;
  /** Default tube radius / band half-width / cross-cap scale. */
  w: number;
}

/** Built-in sample surface dataset (selected through the plugin's Surface param). */
export const SURFACE_PRESETS: SurfacePreset[] = [
  { id: 'torus', labelEn: 'Torus', labelZh: '环面', R: 1.2, w: 0.5 },
  { id: 'mobius', labelEn: 'Möbius band', labelZh: 'Möbius 带', R: 1.2, w: 0.6 },
  {
    id: 'klein',
    labelEn: 'Klein bottle (figure-8 immersion)',
    labelZh: 'Klein 瓶（figure-8 浸入）',
    R: 1.6,
    w: 0.7,
  },
];

// ---- grid triangulations ---------------------------------------------------------

interface GridSpec {
  /** The v direction closes on itself (torus / Klein bottle). */
  periodicV: boolean;
  /** The u seam glues v to its mirror image (Möbius band / Klein bottle). */
  twistU: boolean;
}

function gridSpec(id: SurfaceId): GridSpec {
  if (id === 'torus') return { periodicV: true, twistU: false };
  if (id === 'klein') return { periodicV: true, twistU: true };
  return { periodicV: false, twistU: true };
}

function vOfRow(id: SurfaceId, row: number, segV: number): number {
  if (id === 'mobius') return -1 + (2 * row) / segV; // strip coordinate in [−1, 1]
  return (2 * Math.PI * row) / segV;
}

export interface SurfaceMesh {
  /** Flat [x, y, z, …] triplets ordered col * rows + row. */
  positions: number[];
  /** Triangle corner indices, three per triangle. */
  indices: number[];
  /** Unique vertex columns (u direction). */
  cols: number;
  /** Vertex rows in the v direction (segV + 1 on the Möbius strip). */
  rows: number;
}

/**
 * Triangulate a parametric surface on a segU × segV grid. Only unique
 * columns/rows are stored; the seam column and (on the Möbius strip) the
 * boundary row are reached through the index map, which applies the twist
 * gluing so shared edges are *index*-shared — the prerequisite for a
 * correct V − E + F count. Segment counts are clamped to ≥ 3 to keep the
 * complex a proper simplicial grid (no parallel seam edges).
 */
export function buildSurfaceMesh(id: SurfaceId, params: SurfaceParams): SurfaceMesh {
  const spec = gridSpec(id);
  const segU = Math.max(3, Math.round(params.segU));
  const segV = Math.max(3, Math.round(params.segV));
  const rows = spec.periodicV ? segV : segV + 1; // both boundary rows kept on the strip
  const positions: number[] = [];
  for (let i = 0; i < segU; i += 1) {
    const u = (2 * Math.PI * i) / segU;
    for (let j = 0; j < rows; j += 1) {
      const p = surfacePoint(id, u, vOfRow(id, j, segV), params);
      positions.push(p[0], p[1], p[2]);
    }
  }
  const at = (i: number, j: number): number => {
    let row = j;
    if (spec.periodicV) row = ((row % segV) + segV) % segV;
    let col = i;
    if (i >= segU) {
      // Seam column: reuse column 0, flipping the row when the gluing twists.
      col = i % segU;
      if (spec.twistU) row = spec.periodicV ? (segV - row) % segV : segV - row;
    }
    return col * rows + row;
  };
  const indices: number[] = [];
  for (let i = 0; i < segU; i += 1) {
    for (let j = 0; j < segV; j += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices, cols: segU, rows };
}

/**
 * Lat-long sphere triangulation with single-vertex poles (genus 0 sample
 * used for the Euler-characteristic verification).
 */
export function buildSphereMesh(radius: number, segU: number, segV: number): SurfaceMesh {
  const nu = Math.max(3, Math.round(segU));
  const nv = Math.max(3, Math.round(segV));
  const positions: number[] = [0, radius, 0]; // north pole
  for (let k = 1; k < nv; k += 1) {
    const phi = (Math.PI * k) / nv;
    const y = radius * Math.cos(phi);
    const rho = radius * Math.sin(phi);
    for (let j = 0; j < nu; j += 1) {
      const th = (2 * Math.PI * j) / nu;
      positions.push(rho * Math.cos(th), y, rho * Math.sin(th));
    }
  }
  const south = positions.length / 3;
  positions.push(0, -radius, 0);
  const ring = (k: number, j: number): number => 1 + (k - 1) * nu + (((j % nu) + nu) % nu);
  const indices: number[] = [];
  for (let j = 0; j < nu; j += 1) indices.push(0, ring(1, j + 1), ring(1, j)); // north cap
  for (let k = 1; k < nv - 1; k += 1) {
    for (let j = 0; j < nu; j += 1) {
      const a = ring(k, j);
      const b = ring(k, j + 1);
      const c = ring(k + 1, j + 1);
      const d = ring(k + 1, j);
      indices.push(a, b, c, a, c, d);
    }
  }
  for (let j = 0; j < nu; j += 1) indices.push(south, ring(nv - 1, j), ring(nv - 1, j + 1)); // south cap
  return { positions, indices, cols: nu, rows: nv - 1 };
}

// ---- Euler characteristic -----------------------------------------------------------

export interface EulerCounts {
  vertices: number;
  edges: number;
  faces: number;
  chi: number;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * V − E + F of a triangle mesh. Edges are deduplicated by their (unordered)
 * vertex-index pair, which — thanks to the seam index map above — counts the
 * shared boundary of the glued complex exactly once.
 */
export function meshEulerCounts(mesh: SurfaceMesh): EulerCounts {
  const edges = new Set<string>();
  const faces = mesh.indices.length / 3;
  for (let f = 0; f < faces; f += 1) {
    const a = mesh.indices[f * 3]!;
    const b = mesh.indices[f * 3 + 1]!;
    const c = mesh.indices[f * 3 + 2]!;
    edges.add(pairKey(a, b));
    edges.add(pairKey(b, c));
    edges.add(pairKey(c, a));
  }
  const vertices = mesh.positions.length / 3;
  return { vertices, edges: edges.size, faces, chi: vertices - edges.size + faces };
}

/**
 * Edge key of the glued 4g-gon complex: fan diagonals (0, i) stay distinct,
 * while each boundary edge is keyed with the partner of its letter in the
 * a₁b₁a₁⁻¹b₁⁻¹… word (positions k and k±2 share a letter and glue).
 */
function schemaEdgeKey(p: number, q: number, n: number): string {
  const lo = Math.min(p, q);
  const hi = Math.max(p, q);
  const wrap = lo === 0 && hi === n - 1;
  if (hi - lo !== 1 && !wrap) return `d${hi}`; // interior fan diagonal (0, i)
  const k = wrap ? n - 1 : lo; // boundary edge k → k+1
  return `b${k % 4 < 2 ? k : k - 2}`; // pair every letter with its inverse
}

/** Triangle complex of the standard genus-g polygon schema after gluing. */
function schemaComplexCounts(g: number): EulerCounts {
  const n = 4 * g;
  const tris: Array<[number, number, number]> = [];
  for (let i = 1; i <= n - 2; i += 1) tris.push([0, i, i + 1]); // fan from corner 0
  const edges = new Set<string>();
  for (const [a, b, c] of tris) {
    edges.add(schemaEdgeKey(a, b, n));
    edges.add(schemaEdgeKey(b, c, n));
    edges.add(schemaEdgeKey(c, a, n));
  }
  // The a b a⁻¹ b⁻¹ word identifies every polygon corner at one vertex.
  const vertices = 1;
  const faces = tris.length;
  return { vertices, edges: edges.size, faces, chi: vertices - edges.size + faces };
}

/** Unified relative error |computed − analytic|/|analytic| (unit denominator at a zero reference). */
export function relativeError(computed: number, analytic: number): number {
  const den = analytic === 0 ? 1 : Math.abs(analytic);
  return Math.abs(computed - analytic) / den;
}

export interface GenusVerification {
  g: number;
  /** Closed form χ = 2 − 2g. */
  expectedChi: number;
  counts: EulerCounts;
  relErr: number;
  passed: boolean;
}

/**
 * Verify χ = 2 − 2g from V − E + F on an actual triangle complex:
 * g = 0 on the sphere triangulation, g = 1 on the torus grid, g ≥ 2 on the
 * glued fundamental-polygon triangulation.
 */
export function verifyGenusChi(g: number): GenusVerification {
  const genus = Math.max(0, Math.round(g));
  let counts: EulerCounts;
  if (genus === 0) {
    counts = meshEulerCounts(buildSphereMesh(1, 24, 16));
  } else if (genus === 1) {
    counts = meshEulerCounts(buildSurfaceMesh('torus', { R: 1, w: 0.4, segU: 32, segV: 16 }));
  } else {
    counts = schemaComplexCounts(genus);
  }
  const expectedChi = 2 - 2 * genus;
  const relErr = relativeError(counts.chi, expectedChi);
  return { g: genus, expectedChi, counts, relErr, passed: counts.chi === expectedChi };
}

// ---- loops and deformation retraction ------------------------------------------------

export interface LoopSpec {
  /** Base point of the loop in parameter space (u0 in radians). */
  u0: number;
  v0: number;
  /** Contractible half-width of the loop in parameter space. */
  radius: number;
  /** Winding numbers around the u / v cycles of the parameter torus. */
  p: number;
  q: number;
}

/**
 * Point of the loop family. `s` runs over the loop parameter [0, 1] and
 * `deform` over the homotopy stage [0, 1]: the contractible width shrinks
 * with (1 − deform), so stage 1 collapses the loop onto its (p, q) core
 * curve — onto the base point when p = q = 0. Every stage stays inside the
 * loop's homotopy class, giving a continuous deformation retraction.
 */
export function loopPoint(
  id: SurfaceId,
  shape: SurfaceShape,
  loop: LoopSpec,
  s: number,
  deform: number,
): [number, number, number] {
  const r = loop.radius * (1 - deform);
  const a = 2 * Math.PI * s;
  const u = loop.u0 + 2 * Math.PI * loop.p * s + r * Math.cos(a);
  const v = loop.v0 + 2 * Math.PI * loop.q * s + r * Math.sin(a);
  return surfacePoint(id, u, v, shape);
}

/** Closed polyline of the loop at a deformation stage (first point repeated last). */
export function loopPoints(
  id: SurfaceId,
  shape: SurfaceShape,
  loop: LoopSpec,
  deform: number,
  samples = 256,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let k = 0; k <= samples; k += 1) {
    out.push(loopPoint(id, shape, loop, k / samples, deform));
  }
  return out;
}

/** Polyline length of the loop at a deformation stage. */
export function loopLength(
  id: SurfaceId,
  shape: SurfaceShape,
  loop: LoopSpec,
  deform: number,
  samples = 256,
): number {
  const pts = loopPoints(id, shape, loop, deform, samples);
  let len = 0;
  for (let k = 1; k < pts.length; k += 1) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

/** Distance between the loop's end and start point (0 for a closed loop). */
export function loopClosureGap(
  id: SurfaceId,
  shape: SurfaceShape,
  loop: LoopSpec,
  deform: number,
  samples = 256,
): number {
  const pts = loopPoints(id, shape, loop, deform, samples);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export interface LoopPreset {
  id: string;
  surface: SurfaceId;
  labelEn: string;
  labelZh: string;
  spec: LoopSpec;
}

/**
 * Demo loops per surface, chosen so each one is genuinely closed:
 * torus — the two fundamental-group generators and their sum; Klein bottle —
 * the meridian plus the double longitude (a single wrap flips v and would be
 * an open path); Möbius band — the one-sided centre circle.
 */
export const LOOP_PRESETS: LoopPreset[] = [
  {
    id: 'torus-longitude',
    surface: 'torus',
    labelEn: 'Longitude (1, 0)',
    labelZh: '经线圈 (1, 0)',
    spec: { u0: 0, v0: 0, radius: 0.6, p: 1, q: 0 },
  },
  {
    id: 'torus-meridian',
    surface: 'torus',
    labelEn: 'Meridian (0, 1)',
    labelZh: '子午线圈 (0, 1)',
    spec: { u0: 0, v0: 0, radius: 0.6, p: 0, q: 1 },
  },
  {
    id: 'torus-diagonal',
    surface: 'torus',
    labelEn: 'Diagonal (1, 1)',
    labelZh: '对角环路 (1, 1)',
    spec: { u0: 0, v0: 0, radius: 0.6, p: 1, q: 1 },
  },
  {
    id: 'torus-contractible',
    surface: 'torus',
    labelEn: 'Contractible small loop',
    labelZh: '可收缩的小环路',
    spec: { u0: 0.7, v0: 1.1, radius: 0.9, p: 0, q: 0 },
  },
  {
    id: 'klein-meridian',
    surface: 'klein',
    labelEn: 'Meridian (0, 1)',
    labelZh: '子午线圈 (0, 1)',
    spec: { u0: 0, v0: 0, radius: 0.6, p: 0, q: 1 },
  },
  {
    id: 'klein-double-longitude',
    surface: 'klein',
    labelEn: 'Double longitude (2, 0)',
    labelZh: '双经线圈 (2, 0)',
    spec: { u0: 0, v0: 0, radius: 0.6, p: 2, q: 0 },
  },
  {
    id: 'klein-contractible',
    surface: 'klein',
    labelEn: 'Contractible small loop',
    labelZh: '可收缩的小环路',
    spec: { u0: 0.5, v0: 1, radius: 0.7, p: 0, q: 0 },
  },
  {
    id: 'mobius-center',
    surface: 'mobius',
    labelEn: 'Centre circle (one-sided)',
    labelZh: '中心圈（单侧）',
    spec: { u0: 0, v0: 0, radius: 0.3, p: 1, q: 0 },
  },
  {
    id: 'mobius-contractible',
    surface: 'mobius',
    labelEn: 'Contractible small loop',
    labelZh: '可收缩的小环路',
    spec: { u0: 0.8, v0: 0, radius: 0.25, p: 0, q: 0 },
  },
];

// ---- homeomorphism morphs (superellipse family) ---------------------------------------

export interface ShapeKeyframe {
  /** Semi-axis along x. */
  a: number;
  /** Semi-axis along y. */
  b: number;
  /** Superellipse exponent: 2 is an ellipse, large n approaches a rectangle. */
  n: number;
}

export interface MorphPreset {
  id: string;
  labelEn: string;
  labelZh: string;
  from: ShapeKeyframe;
  mid?: ShapeKeyframe;
  to: ShapeKeyframe;
}

/** Switchable continuous-deformation presets for the homeomorphism demo. */
export const MORPH_PRESETS: MorphPreset[] = [
  {
    id: 'circle-ellipse-square',
    labelEn: 'Circle → ellipse → square',
    labelZh: '圆 → 椭圆 → 方',
    from: { a: 1, b: 1, n: 2 },
    mid: { a: 1.7, b: 0.75, n: 2 },
    to: { a: 1.1, b: 1.1, n: 16 },
  },
  {
    id: 'circle-ellipse',
    labelEn: 'Circle → ellipse',
    labelZh: '圆 → 椭圆',
    from: { a: 1, b: 1, n: 2 },
    to: { a: 1.8, b: 0.7, n: 2 },
  },
  {
    id: 'ellipse-square',
    labelEn: 'Ellipse → rounded square',
    labelZh: '椭圆 → 圆角方',
    from: { a: 1.6, b: 0.8, n: 2 },
    to: { a: 1.05, b: 1.05, n: 12 },
  },
];

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function lerpKeyframe(u: ShapeKeyframe, v: ShapeKeyframe, t: number): ShapeKeyframe {
  return { a: u.a + (v.a - u.a) * t, b: u.b + (v.b - u.b) * t, n: u.n + (v.n - u.n) * t };
}

/** Shape keyframe of a morph at stage t ∈ [0, 1] (piecewise smoothstep). */
export function morphKeyframe(preset: MorphPreset, t: number): ShapeKeyframe {
  const x = Math.min(1, Math.max(0, t));
  if (preset.mid) {
    if (x <= 0.5) return lerpKeyframe(preset.from, preset.mid, smoothstep(x * 2));
    return lerpKeyframe(preset.mid, preset.to, smoothstep((x - 0.5) * 2));
  }
  return lerpKeyframe(preset.from, preset.to, smoothstep(x));
}

/** Point of the superellipse |x/a|ⁿ + |y/b|ⁿ = 1 at angle parameter theta. */
export function superellipsePoint(theta: number, kf: ShapeKeyframe): [number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / kf.n;
  return [
    kf.a * Math.sign(c) * Math.pow(Math.abs(c), e),
    kf.b * Math.sign(s) * Math.pow(Math.abs(s), e),
  ];
}

/** Closed planar curve of the morph at deformation stage t. */
export function morphCurvePoints(
  preset: MorphPreset,
  t: number,
  samples = 256,
): Array<[number, number]> {
  const kf = morphKeyframe(preset, t);
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= samples; k += 1) {
    // k = samples wraps to theta = 0 (mod 2π): the fractional power of the
    // superellipse would otherwise amplify the ~1e-16 sine of 2π and the
    // polyline would not close exactly.
    out.push(superellipsePoint((2 * Math.PI * (k % samples)) / samples, kf));
  }
  return out;
}

// ---- surface normals (benchmark helper) ------------------------------------------------

type Vec3 = [number, number, number];

/** Unit normal of the immersion from central differences of the parametrization. */
function surfaceNormal(id: SurfaceId, u: number, v: number, shape: SurfaceShape): Vec3 {
  const h = 1e-6;
  const p0 = surfacePoint(id, u + h, v, shape);
  const p1 = surfacePoint(id, u - h, v, shape);
  const du: Vec3 = [p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]];
  const q0 = surfacePoint(id, u, v + h, shape);
  const q1 = surfacePoint(id, u, v - h, shape);
  const dv: Vec3 = [q0[0] - q1[0], q0[1] - q1[1], q0[2] - q1[2]];
  const n: Vec3 = [
    du[1] * dv[2] - du[2] * dv[1],
    du[2] * dv[0] - du[0] * dv[2],
    du[0] * dv[1] - du[1] * dv[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 0)) return [NaN, NaN, NaN];
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Seam closure defect: max |P(2π, v) − P(matched row at u = 0)| over sample
 * rows, normalised by the surface extent. Zero means the parametrization
 * closes exactly under its gluing rule.
 */
function seamClosureGap(id: SurfaceId, shape: SurfaceShape): number {
  const rows = id === 'mobius' ? 21 : 24;
  let gap = 0;
  for (let j = 0; j < rows; j += 1) {
    const v = id === 'mobius' ? -1 + (2 * j) / (rows - 1) : (2 * Math.PI * j) / rows;
    const end = surfacePoint(id, 2 * Math.PI, v, shape);
    const mate = surfacePoint(
      id,
      0,
      id === 'mobius' ? -v : id === 'klein' ? 2 * Math.PI - v : v,
      shape,
    );
    gap = Math.max(gap, Math.hypot(end[0] - mate[0], end[1] - mate[1], end[2] - mate[2]));
  }
  return gap;
}

// ---- embedded validation benchmarks -----------------------------------------------------

export const TOPOLOGY_BENCHMARK_ID = 'topology-benchmarks';

export interface TopologyBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  detailEn: string;
  detailZh: string;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  passed: boolean;
}

/**
 * Run the embedded validation suite:
 * (1) torus triangulation χ = V − E + F = 0;
 * (2) sphere triangulation χ = V − E + F = 2;
 * (3) Möbius centre-circle normal reverses after one full turn — dot ≈ −1
 *     against the orientable reference +1, so the unified relative error is
 *     ≈ 2 and certifies the one-sidedness;
 * (4) every sample surface is finite-valued and its seam closes (max gap /
 *     extent under 1e-12).
 * The unified metric throughout is |computed − analytic|/|analytic|.
 */
export function runTopologyBenchmarks(): TopologyBenchmark[] {
  const out: TopologyBenchmark[] = [];

  // (1) Torus grid: χ = 0 (genus 1).
  const torus = meshEulerCounts(
    buildSurfaceMesh('torus', { R: 1, w: 0.4, segU: 32, segV: 16 }),
  );
  const e1 = relativeError(torus.chi, 0);
  out.push({
    id: 'torus-euler',
    labelEn: 'Torus triangulation V − E + F = 0 (< 1e-12)',
    labelZh: '环面三角网格 V − E + F = 0（< 1e-12）',
    passed: torus.chi === 0,
    relErr: e1,
    detailEn: `32 × 16 grid: V = ${torus.vertices}, E = ${torus.edges}, F = ${torus.faces} → χ = ${torus.chi} (analytic 0, genus 1)`,
    detailZh: `32 × 16 网格：V = ${torus.vertices}、E = ${torus.edges}、F = ${torus.faces} → χ = ${torus.chi}（解析值 0，亏格 1）`,
  });

  // (2) Sphere grid: χ = 2 (genus 0).
  const sphere = meshEulerCounts(buildSphereMesh(1, 24, 16));
  const e2 = relativeError(sphere.chi, 2);
  out.push({
    id: 'sphere-euler',
    labelEn: 'Sphere triangulation V − E + F = 2 (< 1e-12)',
    labelZh: '球面三角网格 V − E + F = 2（< 1e-12）',
    passed: sphere.chi === 2,
    relErr: e2,
    detailEn: `24 × 16 grid with vertex poles: V = ${sphere.vertices}, E = ${sphere.edges}, F = ${sphere.faces} → χ = ${sphere.chi} (analytic 2, genus 0)`,
    detailZh: `24 × 16 网格（极点为单顶点）：V = ${sphere.vertices}、E = ${sphere.edges}、F = ${sphere.faces} → χ = ${sphere.chi}（解析值 2，亏格 0）`,
  });

  // (3) Möbius centre circle: the surface normal flips after one turn.
  const mobiusShape: SurfaceShape = { R: 1.2, w: 0.6 };
  const n0 = surfaceNormal('mobius', 0, 0, mobiusShape);
  const n1 = surfaceNormal('mobius', 2 * Math.PI, 0, mobiusShape);
  const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]; // unit vectors
  const e3 = relativeError(dot, 1); // orientable reference: normal returns to itself
  out.push({
    id: 'mobius-normal-reversal',
    labelEn: 'Möbius centre-circle normal reverses (dot ≈ −1, relErr ≈ 2)',
    labelZh: 'Möbius 中心圈法向量绕一周反向（dot ≈ −1，relErr ≈ 2）',
    passed: Number.isFinite(dot) && Math.abs(dot + 1) < 1e-6,
    relErr: e3,
    detailEn: `normal at u = 0 vs u = 2π on the centre circle v = 0: dot = ${dot.toPrecision(12)} vs orientable reference +1 → relErr = ${e3.toFixed(9)} (sign reversal certifies the one-sided band)`,
    detailZh: `中心圈 v = 0 上 u = 0 与 u = 2π 的法向量点积：dot = ${dot.toPrecision(12)}，对照可定向参考值 +1 → relErr = ${e3.toFixed(9)}（反号确认单侧性）`,
  });

  // (4) Finiteness + seam closure of every sample surface.
  let gapRel = 0;
  let nonFinite = 0;
  const gapParts: string[] = [];
  for (const preset of SURFACE_PRESETS) {
    const shape: SurfaceShape = { R: preset.R, w: preset.w };
    const mesh = buildSurfaceMesh(preset.id, { ...shape, segU: 24, segV: 16 });
    for (const x of mesh.positions) {
      if (!Number.isFinite(x)) nonFinite += 1;
    }
    const extent = Math.max(shape.R + 2 * Math.abs(shape.w), 1e-12);
    const gap = seamClosureGap(preset.id, shape) / extent;
    gapRel = Math.max(gapRel, gap);
    gapParts.push(`${preset.id} ${gap.toExponential(2)}`);
  }
  out.push({
    id: 'surface-finite-closed',
    labelEn: 'Sample surfaces finite-valued with closed seams (< 1e-12)',
    labelZh: '样本曲面顶点有限且缝隙闭合（< 1e-12）',
    passed: nonFinite === 0 && gapRel < 1e-12,
    relErr: gapRel,
    detailEn: `max seam gap / extent = ${gapRel.toExponential(2)} (${gapParts.join(', ')}); non-finite coordinates = ${nonFinite}`,
    detailZh: `最大缝隙/尺度 = ${gapRel.toExponential(2)}（${gapParts.join('、')}）；非有限坐标 = ${nonFinite}`,
  });

  return out;
}
