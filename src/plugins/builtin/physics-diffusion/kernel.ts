// ==========================================================================
// physics-diffusion — 1-D / 2-D diffusion-equation solver kernel (pure TS)
//
// Solves ∂u/∂t = D ∇²u with
//   - FTCS (forward-time, central-space) explicit stepping, guarded by the
//     classic von Neumann stability ceiling D·Δt/Δx² ≤ 1/2 (summed over both
//     axes in 2-D) checked *before* any run;
//   - Crank–Nicolson (1-D), unconditionally stable, solved per step with the
//     Thomas algorithm on the tridiagonal half-step system (Crank & Nicolson,
//     1947; see also Press et al., Numerical Recipes §19.2);
//   - Dirichlet (frozen border value) or homogeneous Neumann (zero flux,
//     conservative flux-form ghost so Σu is conserved to machine precision)
//     boundary conditions;
//   - Gaussian-pulse / square-wave / single-sine-mode initial conditions.
//
// Analytic references used for verification (uniform relative-error
// convention |numeric − analytic| / |analytic|):
//   - sine mode on [0, L] (Dirichlet): u = sin(πx/L)·exp(−D(π/L)²t), exact;
//   - Gaussian pulse: infinite-domain heat kernel
//     u = σ₀/σ_t · exp(−r²/(2σ_t²)), σ_t² = σ₀² + 2Dt (exact on the unbounded
//     line/plane; the embedded benchmark uses a wide Neumann domain so the
//     wall error is negligible);
//   - square wave: Fourier-series solution (sine series for Dirichlet,
//     cosine series for Neumann), truncated at 160 terms.
//
// The 2-D convergence benchmark refines the grid by 2× at a fixed courant
// number and verifies second-order spatial convergence: the RMS error must
// drop by ≈4× (accepted band 3–5×).
// ==========================================================================

export type Dim = '1d' | '2d';
export type Scheme = 'ftcs' | 'cn';
export type Boundary = 'dirichlet' | 'neumann';
export type Initial = 'gauss' | 'square' | 'sine';

export interface DiffusionParams {
  dim: Dim;
  scheme: Scheme;
  /** Diffusivity D. */
  d: number;
  /** Grid points per axis (n−1 intervals). */
  n: number;
  /** Time step Δt. */
  dt: number;
  boundary: Boundary;
  initial: Initial;
  /** Domain side length L (square [0, L]² in 2-D). */
  domain: number;
}

/** Solution snapshot: u is row-major with ny = 1 in 1-D. */
export interface Field {
  dim: Dim;
  nx: number;
  ny: number;
  u: Float64Array;
  t: number;
}

/** Truncation order of the square-wave Fourier reference. */
export const FOURIER_TERMS = 160;
/** FTCS stability ceiling: D·Δt/Δx² (summed over axes) ≤ 1/2. */
export const STABILITY_LIMIT = 0.5;

/**
 * Crank–Nicolson is implemented for 1-D only (Thomas solver); in 2-D the
 * effective scheme falls back to FTCS. Callers surface this to the user.
 */
export function effectiveScheme(p: DiffusionParams): Scheme {
  return p.dim === '2d' ? 'ftcs' : p.scheme;
}

export function gridSpacing(p: DiffusionParams): { dx: number; dy: number } {
  const dx = p.domain / Math.max(1, p.n - 1);
  return { dx, dy: p.dim === '2d' ? dx : 0 };
}

/**
 * Total explicit-step diffusivity number D·Δt/Δx² (+ D·Δt/Δy² in 2-D).
 * The FTCS run gate requires this to be ≤ 1/2.
 */
export function courantNumber(p: DiffusionParams): number {
  const { dx } = gridSpacing(p);
  const r = (p.d * p.dt) / (dx * dx);
  return p.dim === '2d' ? 2 * r : r;
}

export function isStable(p: DiffusionParams): boolean {
  if (effectiveScheme(p) === 'cn') return true;
  return courantNumber(p) <= STABILITY_LIMIT + 1e-12;
}

/** Initial pulse width σ₀ = L/20 (keeps wall error negligible). */
export function sigma0(p: DiffusionParams): number {
  return p.domain / 20;
}

function initial1d(p: DiffusionParams, x: number): number {
  const L = p.domain;
  switch (p.initial) {
    case 'sine':
      return Math.sin((Math.PI * x) / L);
    case 'square':
      return x >= L / 4 && x <= (3 * L) / 4 ? 1 : 0;
    default: {
      const s = sigma0(p);
      const dx = x - L / 2;
      return Math.exp(-(dx * dx) / (2 * s * s));
    }
  }
}

function initial2d(p: DiffusionParams, x: number, y: number): number {
  const L = p.domain;
  switch (p.initial) {
    case 'sine':
      return Math.sin((Math.PI * x) / L) * Math.sin((Math.PI * y) / L);
    case 'square':
      return x >= L / 4 && x <= (3 * L) / 4 && y >= L / 4 && y <= (3 * L) / 4 ? 1 : 0;
    default: {
      const s = sigma0(p);
      const dx = x - L / 2;
      const dy = y - L / 2;
      return Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
    }
  }
}

export function makeInitialField(p: DiffusionParams): Field {
  const n = Math.max(9, Math.round(p.n));
  const { dx } = gridSpacing(p);
  const is2d = p.dim === '2d';
  const nx = n;
  const ny = is2d ? n : 1;
  const u = new Float64Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const y = iy * dx;
    for (let ix = 0; ix < nx; ix++) {
      u[iy * nx + ix] = is2d ? initial2d(p, ix * dx, y) : initial1d(p, ix * dx);
    }
  }
  return { dim: p.dim, nx, ny, u, t: 0 };
}

// ---- stepping ---------------------------------------------------------------

/** One FTCS 1-D step: u ← u + r·(u₋ − 2u + u₊) with boundary treatment. */
function stepFtcs1d(f: Field, p: DiffusionParams, out: Float64Array): void {
  const n = f.nx;
  const { dx } = gridSpacing(p);
  const r = (p.d * p.dt) / (dx * dx);
  const u = f.u;
  for (let i = 1; i < n - 1; i++) {
    out[i] = u[i]! + r * (u[i - 1]! - 2 * u[i]! + u[i + 1]!);
  }
  if (p.boundary === 'dirichlet') {
    out[0] = u[0]!;
    out[n - 1] = u[n - 1]!;
  } else {
    // Zero-flux, conservative flux-form ghost (u₋₁ = u₀, u_n = u_{n−1}):
    // the boundary flux vanishes so Σu is conserved to machine precision.
    out[0] = u[0]! + r * (u[1]! - u[0]!);
    out[n - 1] = u[n - 1]! + r * (u[n - 2]! - u[n - 1]!);
  }
  // Buffer swap is owned by advance() — do NOT reassign f.u here.
}

/** One FTCS 2-D step. Dirichlet freezes the border; Neumann uses the conservative self-ghost (zero flux) form. */
function stepFtcs2d(f: Field, p: DiffusionParams, out: Float64Array): void {
  const nx = f.nx;
  const ny = f.ny;
  const { dx } = gridSpacing(p);
  const rx = (p.d * p.dt) / (dx * dx);
  const ry = rx; // square domain, dx = dy
  const u = f.u;
  const dirichlet = p.boundary === 'dirichlet';
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx = iy * nx + ix;
      const border = ix === 0 || ix === nx - 1 || iy === 0 || iy === ny - 1;
      if (dirichlet && border) {
        out[idx] = u[idx]!; // frozen boundary value
        continue;
      }
      const left = ix > 0 ? u[idx - 1]! : u[idx]!;
      const right = ix < nx - 1 ? u[idx + 1]! : u[idx]!;
      const down = iy > 0 ? u[idx - nx]! : u[idx]!;
      const up = iy < ny - 1 ? u[idx + nx]! : u[idx]!;
      out[idx] = u[idx]! + rx * (left - 2 * u[idx]! + right) + ry * (down - 2 * u[idx]! + up);
    }
  }
  // Buffer swap is owned by advance() — do NOT reassign f.u here.
}

/**
 * Thomas algorithm for a tridiagonal system (a: sub, b: diag, c: super,
 * d: RHS). Mutates b and d; returns the solution vector.
 */
export function solveTridiagonal(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  d: Float64Array,
): Float64Array {
  const n = b.length;
  for (let i = 1; i < n; i++) {
    const m = a[i]! / b[i - 1]!;
    b[i] = b[i]! - m * c[i - 1]!;
    d[i] = d[i]! - m * d[i - 1]!;
  }
  const out = new Float64Array(n);
  out[n - 1] = d[n - 1]! / b[n - 1]!;
  for (let i = n - 2; i >= 0; i--) {
    out[i] = (d[i]! - c[i]! * out[i + 1]!) / b[i]!;
  }
  return out;
}

/**
 * One Crank–Nicolson 1-D step:
 *   (I − r/2·A) uⁿ⁺¹ = (I + r/2·A) uⁿ,  A = second-difference operator,
 * solved with the Thomas algorithm. Unconditionally stable; second-order in
 * time and space.
 */
function stepCn1d(f: Field, p: DiffusionParams): void {
  const n = f.nx;
  const { dx } = gridSpacing(p);
  const r = (p.d * p.dt) / (dx * dx);
  const u = f.u;
  const dirichlet = p.boundary === 'dirichlet';

  const rhs = new Float64Array(n);
  if (dirichlet) {
    rhs[0] = u[0]!;
    rhs[n - 1] = u[n - 1]!;
  } else {
    // Conservative flux-form ghost (u₋₁ = u₀): A·row₀ = u₁ − u₀, so both the
    // LHS and RHS column sums are 1 and Σu is conserved exactly.
    rhs[0] = (1 - r / 2) * u[0]! + (r / 2) * u[1]!;
    rhs[n - 1] = (r / 2) * u[n - 2]! + (1 - r / 2) * u[n - 1]!;
  }
  for (let i = 1; i < n - 1; i++) {
    rhs[i] = (r / 2) * u[i - 1]! + (1 - r) * u[i]! + (r / 2) * u[i + 1]!;
  }

  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  if (dirichlet) {
    b[0] = 1;
    c[0] = 0;
    b[n - 1] = 1;
    a[n - 1] = 0;
  } else {
    b[0] = 1 + r / 2;
    c[0] = -r / 2;
    b[n - 1] = 1 + r / 2;
    a[n - 1] = -r / 2;
  }
  for (let i = 1; i < n - 1; i++) {
    a[i] = -r / 2;
    b[i] = 1 + r;
    c[i] = -r / 2;
  }
  f.u = solveTridiagonal(a, b, c, rhs);
}

/** Advance the field by `steps` time steps in place (updates `field.t`). */
export function advance(f: Field, p: DiffusionParams, steps: number): void {
  if (steps <= 0) return;
  if (p.dim === '1d' && effectiveScheme(p) === 'cn') {
    for (let s = 0; s < steps; s++) stepCn1d(f, p);
  } else {
    let tmp = new Float64Array(f.nx * f.ny);
    for (let s = 0; s < steps; s++) {
      if (p.dim === '1d') stepFtcs1d(f, p, tmp);
      else stepFtcs2d(f, p, tmp);
      const old = f.u;
      f.u = tmp;
      tmp = old;
    }
  }
  f.t += steps * p.dt;
}

/**
 * Stability-gated helper for benchmarks: build the initial field and run to
 * `tFinal` (rounded to a whole number of steps). Throws when an FTCS
 * configuration violates the stability ceiling.
 */
export function runToTime(p: DiffusionParams, tFinal: number): Field {
  if (!isStable(p)) {
    throw new Error(`FTCS unstable: courant number ${courantNumber(p).toFixed(3)} > ${STABILITY_LIMIT}`);
  }
  const f = makeInitialField(p);
  const steps = Math.max(1, Math.round(tFinal / p.dt));
  advance(f, p, steps);
  return f;
}

// ---- analytic references ----------------------------------------------------

/** Analytic reference at (x, t); null when no closed form applies. */
export function analytic1d(p: DiffusionParams, x: number, t: number): number | null {
  const L = p.domain;
  if (p.initial === 'sine') {
    if (p.boundary !== 'dirichlet') return null;
    return Math.sin((Math.PI * x) / L) * Math.exp((-p.d * Math.PI * Math.PI * t) / (L * L));
  }
  if (p.initial === 'gauss') {
    const s0 = sigma0(p);
    const s2 = s0 * s0 + 2 * p.d * t;
    const dx = x - L / 2;
    return Math.sqrt((s0 * s0) / s2) * Math.exp(-(dx * dx) / (2 * s2));
  }
  // Square wave: Fourier series (sine for Dirichlet, cosine for Neumann).
  let sum = p.boundary === 'neumann' ? 0.5 : 0;
  for (let m = 1; m <= FOURIER_TERMS; m++) {
    const decay = Math.exp((-p.d * m * m * Math.PI * Math.PI * t) / (L * L));
    if (decay < 1e-14) break;
    const w = (m * Math.PI) / L;
    if (p.boundary === 'dirichlet') {
      const bn = (2 / (m * Math.PI)) * (Math.cos((m * Math.PI) / 4) - Math.cos((3 * m * Math.PI) / 4));
      sum += bn * Math.sin(w * x) * decay;
    } else {
      const an = (2 / (m * Math.PI)) * (Math.sin((3 * m * Math.PI) / 4) - Math.sin((m * Math.PI) / 4));
      sum += an * Math.cos(w * x) * decay;
    }
  }
  return sum;
}

/** Analytic 2-D reference at (x, y, t); null when no closed form applies. */
export function analytic2d(p: DiffusionParams, x: number, y: number, t: number): number | null {
  const L = p.domain;
  if (p.initial === 'sine') {
    if (p.boundary !== 'dirichlet') return null;
    const rate = (2 * p.d * Math.PI * Math.PI) / (L * L);
    return Math.sin((Math.PI * x) / L) * Math.sin((Math.PI * y) / L) * Math.exp(-rate * t);
  }
  if (p.initial === 'gauss') {
    const s0 = sigma0(p);
    const s2 = s0 * s0 + 2 * p.d * t;
    const dx = x - L / 2;
    const dy = y - L / 2;
    return ((s0 * s0) / s2) * Math.exp(-(dx * dx + dy * dy) / (2 * s2));
  }
  return null; // 2-D square wave: no compact reference
}

/**
 * Maximum relative error |u − ua| / |ua| over grid points where the analytic
 * magnitude is at least 5 % of its maximum (tail points would only measure
 * the truncation of the reference, not the solver). Returns null when no
 * analytic reference exists for the configuration.
 */
export function maxRelativeError(f: Field, p: DiffusionParams): number | null {
  const { dx } = gridSpacing(p);
  const is2d = f.dim === '2d';
  let maxUa = 0;
  for (let iy = 0; iy < f.ny; iy++) {
    for (let ix = 0; ix < f.nx; ix++) {
      const ua = is2d ? analytic2d(p, ix * dx, iy * dx, f.t) : analytic1d(p, ix * dx, f.t);
      if (ua === null) return null;
      const m = Math.abs(ua);
      if (m > maxUa) maxUa = m;
    }
  }
  if (maxUa <= 0) return null;
  const floor = 0.05 * maxUa;
  let worst = 0;
  for (let iy = 0; iy < f.ny; iy++) {
    for (let ix = 0; ix < f.nx; ix++) {
      const ua = is2d ? analytic2d(p, ix * dx, iy * dx, f.t) : analytic1d(p, ix * dx, f.t);
      if (ua === null) return null;
      if (Math.abs(ua) < floor) continue;
      const num = f.u[iy * f.nx + ix]!;
      const rel = Math.abs(num - ua) / Math.abs(ua);
      if (rel > worst) worst = rel;
    }
  }
  return worst;
}

/** RMS error against the analytic reference (requires one to exist). */
export function rmsError(f: Field, p: DiffusionParams): number | null {
  const { dx } = gridSpacing(p);
  const is2d = f.dim === '2d';
  let acc = 0;
  for (let iy = 0; iy < f.ny; iy++) {
    for (let ix = 0; ix < f.nx; ix++) {
      const ua = is2d ? analytic2d(p, ix * dx, iy * dx, f.t) : analytic1d(p, ix * dx, f.t);
      if (ua === null) return null;
      const e = f.u[iy * f.nx + ix]! - ua;
      acc += e * e;
    }
  }
  return Math.sqrt(acc / (f.nx * f.ny));
}

// ---- embedded validation benchmarks -----------------------------------------

export interface SineDecayBenchmark {
  numericAmplitude: number;
  analyticAmplitude: number;
  relErr: number;
}

/**
 * Benchmark ① — Fourier-mode decay. u(x,0) = sin(πx) on [0,1] with D = 1
 * must decay as exp(−π²t); Crank–Nicolson, N = 200, Δt = 1e-3, t = 0.1.
 */
export function benchmarkSineDecay(): SineDecayBenchmark {
  const p: DiffusionParams = {
    dim: '1d',
    scheme: 'cn',
    d: 1,
    n: 200,
    dt: 1e-3,
    boundary: 'dirichlet',
    initial: 'sine',
    domain: 1,
  };
  const f = runToTime(p, 0.1);
  let amp = 0;
  for (let i = 0; i < f.u.length; i++) amp = Math.max(amp, Math.abs(f.u[i]!));
  const ana = Math.exp(-Math.PI * Math.PI * f.t);
  return { numericAmplitude: amp, analyticAmplitude: ana, relErr: Math.abs(amp - ana) / ana };
}

export interface GaussianBenchmark {
  relErrWidth2: number;
  relErrAmplitude: number;
  measuredSigma2: number;
  analyticSigma2: number;
}

/**
 * Benchmark ② — Gaussian heat kernel. The pulse width must grow as
 * σ²(t) = σ₀² + 2Dt and the peak must fall as σ₀/σ_t. Width is measured from
 * the interpolated full width at half maximum. Wide Neumann domain makes the
 * infinite-domain reference exact to well below the 1 % gate.
 */
export function benchmarkGaussian(): GaussianBenchmark {
  const p: DiffusionParams = {
    dim: '1d',
    scheme: 'cn',
    d: 1,
    n: 500,
    dt: 1e-3,
    boundary: 'neumann',
    initial: 'gauss',
    domain: 10,
  };
  const f = runToTime(p, 0.5);
  const s0 = sigma0(p);
  const s2 = s0 * s0 + 2 * p.d * f.t;

  let peak = 0;
  let iPeak = 0;
  for (let i = 0; i < f.u.length; i++) {
    if (f.u[i]! > peak) {
      peak = f.u[i]!;
      iPeak = i;
    }
  }
  const half = peak / 2;
  const dx = p.domain / (p.n - 1);
  // Half-maximum crossings around the peak, linearly interpolated.
  let xl = 0;
  for (let i = iPeak; i > 0; i--) {
    if (f.u[i - 1]! < half) {
      const fr = (half - f.u[i - 1]!) / (f.u[i]! - f.u[i - 1]!);
      xl = (i - 1 + fr) * dx;
      break;
    }
  }
  let xr = 0;
  for (let i = iPeak; i < f.u.length - 1; i++) {
    if (f.u[i + 1]! < half) {
      const fr = (half - f.u[i + 1]!) / (f.u[i]! - f.u[i + 1]!);
      xr = (i + 1 - fr) * dx;
      break;
    }
  }
  const fwhm = xr - xl;
  const sigma2num = (fwhm / (2 * Math.sqrt(2 * Math.LN2))) ** 2;
  const ampAna = s0 / Math.sqrt(s2);
  return {
    relErrWidth2: Math.abs(sigma2num - s2) / s2,
    relErrAmplitude: Math.abs(peak - ampAna) / ampAna,
    measuredSigma2: sigma2num,
    analyticSigma2: s2,
  };
}

export interface ConvergenceBenchmark {
  errCoarse: number;
  errFine: number;
  ratio: number;
}

/**
 * Benchmark ③ — 2-D second-order convergence. FTCS with the per-axis courant
 * number fixed at 0.2 (Δt = r·Δx² from the *actual* Δx = L/(n−1), so both
 * grids share the same effective r and the O(Δt) time error stays proportional
 * to Δx²) refines 32 → 64 points and must reduce the RMS error by ≈4×
 * (accepted 3–5×). r = 0.2 also sits safely away from the r = 1/6
 * time/space truncation-cancellation point, keeping the error cleanly O(Δx²).
 */
export function benchmarkConvergence2D(): ConvergenceBenchmark {
  const base = {
    dim: '2d' as const,
    scheme: 'ftcs' as const,
    d: 1,
    boundary: 'dirichlet' as const,
    initial: 'sine' as const,
    domain: 1,
  };
  const r = 0.2;
  const mk = (n: number): DiffusionParams => {
    const dx = base.domain / (n - 1);
    return { ...base, n, dt: r * dx * dx };
  };
  const coarse = mk(32);
  const fine = mk(64);
  const fc = runToTime(coarse, 0.05);
  const ff = runToTime(fine, 0.05);
  const errCoarse = rmsError(fc, coarse) ?? Number.NaN;
  const errFine = rmsError(ff, fine) ?? Number.NaN;
  return { errCoarse, errFine, ratio: errCoarse / errFine };
}
