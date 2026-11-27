// ==========================================================================
// physics-diffraction — Fresnel–Kirchhoff diffraction kernel (pure TS)
//
// Numerically evaluates the Fresnel–Kirchhoff diffraction integral from a
// programmable aperture (single slit / double slit / N-slit grating / circular
// hole) to an observation plane at axial distance L:
//
//   slit family (uniform along y; the y-integration is analytic, leaving the
//   unitary 1-D Fresnel propagator with per-dimension prefactor 1/√(iλL)):
//     U(x) ∝ 1/√(iλL) · ∫_aperture exp(iπ(x−ξ)²/(λL)) dξ
//   circular hole (radially symmetric → exact Hankel form):
//     U(r) ∝ e^{iπr²/(λL)}/(iλL) · 2π ∫₀^R e^{iπρ²/(λL)} J₀(2πrρ/(λL)) ρ dρ
//
// Both forms are unitary: ∫|U|²dx = Σ slit widths and 2π∫r|U|²dr = πR², which
// the energy-conservation benchmark exploits (the global phase e^{ikL} is
// dropped since I = |U|²). Aperture integrals use composite Simpson quadrature
// applied per slit segment — the transmission is smooth inside each segment,
// so the discontinuity never falls inside a panel; the sub-interval count is
// adapted so the chirp phase changes by less than π/6 per panel. J₀/J₁ use a
// power series (|z| < 20) spliced to the 4-term asymptotic expansion beyond.
//
// Fraunhofer (far-field, a²/(λL) ≪ 1) closed forms are provided as overlays:
//   slit    I = (a²/λL)·sinc²(πax/λL)          minima x_m = m·λL/a
//   double  I = (4a²/λL)·sinc²·cos²(πdx/λL)     fringes Δx = λL/d
//   grating I = (a²/λL)·sinc²·(sin Nγ/sin γ)²,  γ = πdx/λL
//   circle  I = (πR²/λL)²·(2J₁(z)/z)²,  z = πrD/λL, first dark ring
//           r₁ = 1.21967·λL/D
//
// Embedded acceptance benchmarks (uniform convention |numeric − theory|/|theory|):
//   ① single-slit minima x_m = m·λL/a            (gate < 1e-3)
//   ② double-slit fringe spacing Δx = λL/d       (gate < 1e-2)
//   ③ near-field energy conservation ∫I dx = N·a (gate < 5e-2)
//   ④ Airy first dark ring r₁ = 1.21967·λL/D     (gate < 1e-3)
// ==========================================================================

export type ApertureKind = 'slit' | 'double' | 'grating' | 'circle';

export interface DiffractionParams {
  aperture: ApertureKind;
  /** Slit width a (slit / double / grating), in units of λ. */
  a: number;
  /** Centre-to-centre slit separation d (double / grating). */
  d: number;
  /** Number of slits (grating). */
  nSlits: number;
  /** Circular-hole radius R (circle). */
  radius: number;
  /** Propagation distance L (same length units as a, d, R). */
  L: number;
  /** Wavelength λ. */
  lambda: number;
  /** Half-width of the observed screen window (slit family) or radial extent (circle). */
  screenHalf: number;
}

export interface Complex {
  re: number;
  im: number;
}

export interface Profile1D {
  xs: Float64Array;
  ys: Float64Array; // intensity samples
}

export interface ExtremePoint {
  x: number;
  value: number;
}

export interface MinimaBenchmark {
  positions: number[];
  theory: number[];
  maxRelErr: number;
}

export interface SpacingBenchmark {
  measured: number;
  theory: number;
  relErr: number;
}

export interface EnergyBenchmark {
  numeric: number;
  theory: number;
  relErr: number;
}

/** First zero of J₁ divided by π: r₁ = (3.83170597…/π)·λL/D. */
export const AIRY_RING_FACTOR = 3.8317059702075125 / Math.PI;

// ---- small complex & special-function helpers --------------------------------

const SQRT_HALF = Math.SQRT1_2;

/** sinc(u) = sin(u)/u with the removable singularity filled. */
export function sinc(u: number): number {
  if (Math.abs(u) < 1e-9) return 1 - (u * u) / 6;
  return Math.sin(u) / u;
}

/**
 * Bessel J₀. Power series Σ(−1)^m (z²/4)^m/(m!)² for |z| < 20 (term-capped
 * recurrence, machine-precision there), 4-term asymptotic expansion beyond.
 */
export function besselJ0(z: number): number {
  const az = Math.abs(z);
  if (az < 20) {
    const q = (z * z) / 4;
    let term = 1;
    let sum = 1;
    for (let m = 1; m <= 80; m++) {
      term *= -q / (m * m);
      sum += term;
      if (Math.abs(term) < 1e-17 * (1 + Math.abs(sum))) break;
    }
    return sum;
  }
  const chi = az - Math.PI / 4;
  const s = Math.sqrt(2 / (Math.PI * az));
  const z2 = az * az;
  const cosTerm = 1 - 9 / (128 * z2) + 11025 / (98304 * z2 * z2);
  const sinTerm = 1 / (8 * az) - 225 / (3072 * z2 * az);
  return s * (Math.cos(chi) * cosTerm + Math.sin(chi) * sinTerm);
}

/** Bessel J₁ (same splice strategy; needed only for the Fraunhofer Airy form). */
export function besselJ1(z: number): number {
  const az = Math.abs(z);
  const sign = z < 0 ? -1 : 1;
  if (az < 20) {
    const q = (z * z) / 4;
    let term = az / 2;
    let sum = term;
    for (let m = 1; m <= 80; m++) {
      term *= -q / (m * (m + 1));
      sum += term;
      if (Math.abs(term) < 1e-17 * (1 + Math.abs(sum))) break;
    }
    return sign * sum;
  }
  const chi = az - (3 * Math.PI) / 4;
  const s = Math.sqrt(2 / (Math.PI * az));
  const z2 = az * az;
  // ν=1: a₂=−15/128, a₄=−14175/98304 → cos series 1 + 15/(128z²) − 14175/(98304z⁴)
  const cosTerm = 1 + 15 / (128 * z2) - 14175 / (98304 * z2 * z2);
  const sinTerm = 3 / (8 * az) - 315 / (3072 * z2 * az);
  return sign * s * (Math.cos(chi) * cosTerm - Math.sin(chi) * sinTerm);
}

// ---- aperture geometry ---------------------------------------------------------

export interface Segment {
  x0: number;
  x1: number;
}

/** Slit segments on the aperture axis (centre-symmetric layout). */
export function slitSegments(p: DiffractionParams): Segment[] {
  const h = p.a / 2;
  if (p.aperture === 'slit') return [{ x0: -h, x1: h }];
  if (p.aperture === 'double') {
    return [
      { x0: -p.d / 2 - h, x1: -p.d / 2 + h },
      { x0: p.d / 2 - h, x1: p.d / 2 + h },
    ];
  }
  const segs: Segment[] = [];
  for (let i = 0; i < p.nSlits; i++) {
    const c = (i - (p.nSlits - 1) / 2) * p.d;
    segs.push({ x0: c - h, x1: c + h });
  }
  return segs;
}

/** Unitary total of the diffracted energy: Σ slit widths (slit family) or πR² (circle). */
export function apertureEnergy(p: DiffractionParams): number {
  if (p.aperture === 'circle') return Math.PI * p.radius * p.radius;
  return slitSegments(p).length * p.a;
}

/**
 * Fresnel number F = (aperture half-size)²/(λL) — F ≪ 1 is the Fraunhofer
 * regime where the far-field references are exact.
 */
export function fresnelNumber(p: DiffractionParams): number {
  const half = p.aperture === 'circle' ? p.radius : p.a / 2;
  return (half * half) / (p.lambda * p.L);
}

// ---- Fresnel–Kirchhoff evaluation ----------------------------------------------

/**
 * Even Simpson sub-interval count for one slit at screen coordinate x: the
 * chirp phase span across the slit is ≈ 2π·a·(|x|+a/2)/(λL); keep < π/6 per
 * sub-interval (≥ 12 samples per oscillation), bounded to [16, 4000].
 */
function slitIntervals(p: DiffractionParams, x: number): number {
  const span = (2 * Math.PI * p.a * (Math.abs(x) + p.a / 2)) / (p.lambda * p.L);
  let n = Math.ceil(span / (Math.PI / 6));
  n = Math.max(16, n);
  if (n % 2 === 1) n += 1;
  return Math.min(n, 4000);
}

/**
 * Complex 1-D Fresnel–Kirchhoff field of the slit-family aperture at screen
 * coordinate x (global phase e^{ikL} dropped; harmless for I = |U|²).
 */
export function fresnelSlitField(x: number, p: DiffractionParams): Complex {
  const c = Math.PI / (p.lambda * p.L);
  let accRe = 0;
  let accIm = 0;
  for (const seg of slitSegments(p)) {
    const intervals = slitIntervals(p, x);
    const h = (seg.x1 - seg.x0) / intervals;
    let sr = 0;
    let si = 0;
    for (let i = 0; i <= intervals; i++) {
      const xi = seg.x0 + i * h;
      const w = i === 0 || i === intervals ? 1 : i % 2 === 0 ? 2 : 4;
      const ph = c * (x - xi) * (x - xi);
      sr += w * Math.cos(ph);
      si += w * Math.sin(ph);
    }
    const f = h / 3;
    accRe += sr * f;
    accIm += si * f;
  }
  // prefactor 1/√(iλL) = e^{−iπ/4}/√(λL)
  const s = SQRT_HALF / Math.sqrt(p.lambda * p.L);
  const pr = s;
  const pi = -s;
  return { re: accRe * pr - accIm * pi, im: accRe * pi + accIm * pr };
}

/** Intensity of the slit-family aperture at x. */
export function slitIntensity(x: number, p: DiffractionParams): number {
  const u = fresnelSlitField(x, p);
  return u.re * u.re + u.im * u.im;
}

/**
 * Complex circular-hole Fresnel field at radius r (exact Hankel form; global
 * phases e^{ikL}e^{iπr²/(λL)} dropped). Radial Simpson intervals keep the
 * combined J₀-chirp phase change below π/6 per panel.
 */
export function airyFresnelField(r: number, p: DiffractionParams): Complex {
  const R = p.radius;
  const c = Math.PI / (p.lambda * p.L);
  const zc = (2 * Math.PI * r) / (p.lambda * p.L);
  const span = (2 * Math.PI * (r * R + (R * R) / 2)) / (p.lambda * p.L);
  let intervals = Math.max(32, Math.ceil(span / (Math.PI / 6)));
  if (intervals % 2 === 1) intervals += 1;
  intervals = Math.min(intervals, 4000);
  const h = R / intervals;
  let sr = 0;
  let si = 0;
  for (let i = 0; i <= intervals; i++) {
    const rho = i * h;
    const w = i === 0 || i === intervals ? 1 : i % 2 === 0 ? 2 : 4;
    const jv = besselJ0(zc * rho);
    const ph = c * rho * rho;
    // Jacobian weight ρ from the radial (Hankel) transform is essential.
    sr += w * jv * Math.cos(ph) * rho;
    si += w * jv * Math.sin(ph) * rho;
  }
  // U = (1/(iλL))·2π·∫ → multiply the Simpson result by −i·2π/(λL)
  const amp = (2 * Math.PI) / (p.lambda * p.L);
  const f = (h / 3) * amp;
  return { re: si * f, im: -sr * f };
}

/** Intensity of the circular hole at radius r. */
export function circleIntensity(r: number, p: DiffractionParams): number {
  const u = airyFresnelField(r, p);
  return u.re * u.re + u.im * u.im;
}

/** Uniform intensity profile across the screen window. */
export function sampleSlitIntensity(p: DiffractionParams, n: number): Profile1D {
  const count = Math.max(33, Math.round(n) | 1); // force odd
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const x = -p.screenHalf + (2 * p.screenHalf * i) / (count - 1);
    xs[i] = x;
    ys[i] = slitIntensity(x, p);
  }
  return { xs, ys };
}

/** Uniform radial intensity profile r ∈ [0, screenHalf] for the circular hole. */
export function sampleCircleIntensity(p: DiffractionParams, n: number): Profile1D {
  const count = Math.max(33, Math.round(n) | 1);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const r = (p.screenHalf * i) / (count - 1);
    xs[i] = r;
    ys[i] = circleIntensity(r, p);
  }
  return { xs, ys };
}

// ---- far-field references ------------------------------------------------------

/** Fraunhofer intensity for the slit-family apertures (null for the circle). */
export function fraunhofer1d(x: number, p: DiffractionParams): number | null {
  const lamL = p.lambda * p.L;
  const env = (p.a * p.a) / lamL * sinc((Math.PI * p.a * x) / lamL) ** 2;
  if (p.aperture === 'slit') return env;
  if (p.aperture === 'double') {
    const g = (Math.PI * p.d * x) / lamL;
    return 4 * env * Math.cos(g) * Math.cos(g);
  }
  if (p.aperture === 'grating') {
    const g = (Math.PI * p.d * x) / lamL;
    const s = Math.sin(g);
    const ratio = Math.abs(s) < 1e-12 ? p.nSlits : Math.sin(p.nSlits * g) / s;
    return env * ratio * ratio;
  }
  return null;
}

/** Fraunhofer Airy intensity for the circular hole. */
export function fraunhoferAiry(r: number, p: DiffractionParams): number {
  const D = 2 * p.radius;
  const z = (Math.PI * r * D) / (p.lambda * p.L);
  const t = z < 1e-9 ? 1 : (2 * besselJ1(z)) / z;
  const pre = (Math.PI * p.radius * p.radius) / (p.lambda * p.L);
  return pre * pre * t * t;
}

// ---- extreme-point detection -----------------------------------------------------

/** Vertex of the parabola through three (possibly non-uniform) samples. */
function refineVertex(x0: number, x1: number, x2: number, y0: number, y1: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / h0;
  const s1 = (y2 - y1) / h1;
  const curv = (s1 - s0) / (h0 + h1);
  if (!Number.isFinite(curv) || Math.abs(curv) < 1e-30) return x1;
  return (x0 + x1) / 2 - s0 / (2 * curv);
}

/** Local minima with parabolically refined positions. */
export function findLocalMinima(xs: ArrayLike<number>, ys: ArrayLike<number>): ExtremePoint[] {
  const out: ExtremePoint[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    const y = ys[i]!;
    const yl = ys[i - 1]!;
    const yr = ys[i + 1]!;
    if (y <= yl && y <= yr && (y < yl || y < yr)) {
      out.push({ x: refineVertex(xs[i - 1]!, xs[i]!, xs[i + 1]!, yl, y, yr), value: y });
    }
  }
  return out;
}

/** Local maxima with parabolically refined positions. */
export function findLocalMaxima(xs: ArrayLike<number>, ys: ArrayLike<number>): ExtremePoint[] {
  const out: ExtremePoint[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    const y = ys[i]!;
    const yl = ys[i - 1]!;
    const yr = ys[i + 1]!;
    if (y >= yl && y >= yr && (y > yl || y > yr)) {
      out.push({ x: refineVertex(xs[i - 1]!, xs[i]!, xs[i + 1]!, yl, y, yr), value: y });
    }
  }
  return out;
}

/** Median of a numeric array (copies + sorts). */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Dominant spacing among successive extreme-point gaps: cluster the sorted
 * gaps with a sliding window of relative width 2·relWindow and return the
 * median of the largest cluster. Robust against outlier gaps produced by
 * missing orders / envelope zeros (short gaps) or undetected extrema (long
 * gaps).
 */
export function dominantSpacing(diffs: number[], relWindow = 0.06): number {
  if (diffs.length === 0) return Number.NaN;
  const s = [...diffs].sort((a, b) => a - b);
  let bestLo = 0;
  let bestCount = 0;
  let lo = 0;
  for (let hi = 0; hi < s.length; hi++) {
    while (s[hi]! > s[lo]! * (1 + 2 * relWindow)) lo++;
    const count = hi - lo + 1;
    if (count > bestCount) {
      bestCount = count;
      bestLo = lo;
    }
  }
  return median(s.slice(bestLo, bestLo + bestCount));
}

// ---- screen energy (unitarity check) ----------------------------------------------

/** ∫ I dx over the screen window (composite Simpson on the samples). */
export function screenEnergySlit(p: DiffractionParams, samples: number): number {
  const n = samples % 2 === 0 ? samples + 1 : Math.max(33, samples);
  const h = (2 * p.screenHalf) / (n - 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x = -p.screenHalf + i * h;
    const w = i === 0 || i === n - 1 ? 1 : i % 2 === 0 ? 2 : 4;
    acc += w * slitIntensity(x, p);
  }
  return (acc * h) / 3;
}

/** 2π ∫ r·I(r) dr over [0, screenHalf] (composite Simpson). */
export function screenEnergyCircle(p: DiffractionParams, samples: number): number {
  const n = samples % 2 === 0 ? samples + 1 : Math.max(33, samples);
  const h = p.screenHalf / (n - 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const r = i * h;
    const w = i === 0 || i === n - 1 ? 1 : i % 2 === 0 ? 2 : 4;
    acc += w * r * circleIntensity(r, p);
  }
  return ((acc * h) / 3) * 2 * Math.PI;
}

// ---- embedded validation benchmarks -----------------------------------------------

/**
 * Benchmark ① — single-slit minima. a = 8λ, L = 2·10⁵λ (F ≈ 8·10⁻⁵, deep
 * Fraunhofer): the first three intensity minima must sit at x_m = m·λL/a
 * within 0.1 %.
 */
export function benchmarkSingleSlitMinima(): MinimaBenchmark {
  const p: DiffractionParams = {
    aperture: 'slit',
    a: 8,
    d: 0,
    nSlits: 1,
    radius: 0,
    lambda: 1,
    L: 2e5,
    screenHalf: 8.2e4,
  };
  const prof = sampleSlitIntensity(p, 3001);
  const detected = findLocalMinima(prof.xs, prof.ys).filter((m) => m.x > 0);
  const theory: number[] = [];
  const positions: number[] = [];
  let maxRelErr = 0;
  for (let m = 1; m <= 3; m++) {
    const xm = (m * p.lambda * p.L) / p.a;
    theory.push(xm);
    let best: ExtremePoint | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const d of detected) {
      const dist = Math.abs(d.x - xm);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    if (best) {
      positions.push(best.x);
      maxRelErr = Math.max(maxRelErr, Math.abs(best.x - xm) / xm);
    } else {
      positions.push(Number.NaN);
      maxRelErr = Number.NaN;
      break;
    }
  }
  return { positions, theory, maxRelErr };
}

/**
 * Benchmark ② — double-slit fringe spacing. a = 8λ, d = 40λ, L = 10⁵λ: the
 * intensity zeros sit exactly at the two-beam interference minima
 * x = (k + ½)·λL/d — unlike the maxima, these are NOT displaced by the tilt
 * of the single-slit envelope — so the dominant spacing of successive minima
 * must equal Δx = λL/d within 1 % (dominant-spacing clustering rejects the
 * half-spacing gaps around the missing orders where the envelope vanishes).
 */
export function benchmarkDoubleSlitSpacing(): SpacingBenchmark {
  const p: DiffractionParams = {
    aperture: 'double',
    a: 8,
    d: 40,
    nSlits: 2,
    radius: 0,
    lambda: 1,
    L: 1e5,
    screenHalf: 5.8e4,
  };
  const prof = sampleSlitIntensity(p, 2401);
  const minima = findLocalMinima(prof.xs, prof.ys).filter((m) => m.x > 0);
  const diffs: number[] = [];
  for (let i = 1; i < minima.length; i++) diffs.push(minima[i]!.x - minima[i - 1]!.x);
  const measured = dominantSpacing(diffs);
  const theory = (p.lambda * p.L) / p.d;
  return { measured, theory, relErr: Math.abs(measured - theory) / theory };
}

/**
 * Benchmark ③ — energy conservation in the near field. Single slit a = 20λ,
 * L = 500λ (F = 0.2, well beyond the Fraunhofer regime): the unitarity of the
 * Fresnel propagator requires ∫I dx = a over the screen; gate 5 %.
 */
export function benchmarkEnergyConservation(): EnergyBenchmark {
  const p: DiffractionParams = {
    aperture: 'slit',
    a: 20,
    d: 0,
    nSlits: 1,
    radius: 0,
    lambda: 1,
    L: 500,
    screenHalf: 400,
  };
  const numeric = screenEnergySlit(p, 8001);
  const theory = apertureEnergy(p);
  return { numeric, theory, relErr: Math.abs(numeric - theory) / theory };
}

/**
 * Benchmark ④ — Airy first dark ring. Circular hole R = 5λ, L = 10⁶λ
 * (F = 2.5·10⁻⁵): the first radial intensity minimum must sit at
 * r₁ = 1.21967·λL/D within 0.1 %.
 */
export function benchmarkAiryRing(): SpacingBenchmark {
  const p: DiffractionParams = {
    aperture: 'circle',
    a: 0,
    d: 0,
    nSlits: 0,
    radius: 5,
    lambda: 1,
    L: 1e6,
    screenHalf: 4e5,
  };
  const prof = sampleCircleIntensity(p, 4001);
  const minima = findLocalMinima(prof.xs, prof.ys);
  const theory = (AIRY_RING_FACTOR * p.lambda * p.L) / (2 * p.radius);
  const first = minima.length > 0 ? minima[0]!.x : Number.NaN;
  return { measured: first, theory, relErr: Math.abs(first - theory) / theory };
}
