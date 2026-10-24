// ==========================================================================
// physics-schrodinger — 1-D quantum mechanics kernel (pure functions, no DOM)
//
// Unit system: hbar = 1 and hbar^2/(2m) = 1 (so m = 1/2), giving
//   H = -d^2/dx^2 + V(x)
// and the analytic reference levels
//   infinite well [0, L]:  E_n = n^2 pi^2 / L^2          (n = 1, 2, ...)
//   harmonic oscillator:   V = omega^2 x^2 / 4,  E_n = (n + 1/2) omega
//   finite well |x| < a:   even:  k tan(k a)  = kappa
//                          odd:  -k cot(k a)  = kappa
//                          with k = sqrt(E), kappa = sqrt(V0 - E)
//
// Stationary states: 3-point finite differences produce a symmetric
// tridiagonal Hamiltonian which is diagonalised by an EISPACK tql2 port
// (implicit-shift QL with eigenvector accumulation, O(N^2) for tridiagonal
// input — no external dependency).
//
// Dynamics: Crank-Nicolson (unitary, unconditionally stable). Each step
// solves (I + i dt/2 H) psi^{n+1} = (I - i dt/2 H) psi^n with a complex
// Thomas sweep. For a free packet the analytic width is
//   sigma(t) = sqrt(sigma0^2 + t^2 / sigma0^2),  <x>(t) = x0 + 2 k0 t.
// ==========================================================================

export type PotentialKind = 'well' | 'harmonic' | 'finite-well' | 'double-well';

export interface PotentialParams {
  /** Infinite-well width L (domain [0, L]). */
  width: number;
  /** Harmonic / double-well curvature: V = (1/2) omega^2 x^2. */
  omega: number;
  /** Finite-well depth V0. */
  depth: number;
  /** Finite-well half width a. */
  halfWidth: number;
  /** Double-well central Gaussian barrier height. */
  barrierHeight: number;
  /** Double-well Gaussian barrier width sigma. */
  barrierWidth: number;
}

export const DEFAULT_POTENTIAL_PARAMS: PotentialParams = {
  width: 1,
  omega: 2,
  depth: 40,
  halfWidth: 1,
  barrierHeight: 8,
  barrierWidth: 0.5,
};

/** Spatial domain used for a given potential. */
export function domainFor(kind: PotentialKind, p: PotentialParams): [number, number] {
  if (kind === 'well') return [0, Math.max(p.width, 0.2)];
  if (kind === 'finite-well') {
    const a = Math.max(p.halfWidth, 0.1);
    return [-4 * a, 4 * a];
  }
  return [-8, 8];
}

/** Wider domain used for wave-packet dynamics so spreading packets fit. */
export function dynamicsDomainFor(kind: PotentialKind, p: PotentialParams): [number, number] {
  if (kind === 'well') return [0, Math.max(p.width, 0.2)];
  return [-16, 16];
}

/** Potential values on the interior grid points. */
export function buildPotential(kind: PotentialKind, p: PotentialParams, x: Float64Array): Float64Array {
  const n = x.length;
  const V = new Float64Array(n);
  if (kind === 'well') {
    // Dirichlet box: interior is flat; no need for a huge wall value.
    return V;
  }
  if (kind === 'harmonic') {
    // H = -d^2/dx^2 + V means hbar^2/(2m) = 1, i.e. m = 1/2 (hbar = 1), so
    // V = (1/2) m omega^2 x^2 = omega^2 x^2 / 4 and E_n = (n + 1/2) omega.
    const w4 = 0.25 * p.omega * p.omega;
    for (let i = 0; i < n; i++) V[i] = w4 * x[i]! * x[i]!;
    return V;
  }
  if (kind === 'finite-well') {
    const a = Math.max(p.halfWidth, 0.05);
    const depth = Math.max(p.depth, 0.1);
    for (let i = 0; i < n; i++) V[i] = Math.abs(x[i]!) <= a ? 0 : depth;
    return V;
  }
  // double-well: harmonic confinement + central Gaussian barrier
  const w4 = 0.25 * p.omega * p.omega;
  const s2 = 2 * Math.max(p.barrierWidth, 0.05) * Math.max(p.barrierWidth, 0.05);
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    V[i] = w4 * xi * xi + p.barrierHeight * Math.exp((-xi * xi) / s2);
  }
  return V;
}

export interface Grid {
  x: Float64Array;
  dx: number;
}

/** Interior grid of `n` points with Dirichlet boundaries at both ends. */
export function buildGrid(xMin: number, xMax: number, n: number): Grid {
  const count = Math.max(8, Math.floor(n));
  const dx = (xMax - xMin) / (count + 1);
  const x = new Float64Array(count);
  for (let i = 0; i < count; i++) x[i] = xMin + (i + 1) * dx;
  return { x, dx };
}

// ---- symmetric tridiagonal eigensolver (EISPACK tql2 port) -----------------

export interface TridiagEigenResult {
  /** Eigenvalues in ascending order. */
  values: Float64Array;
  /** n x n row-major matrix; column j is the eigenvector of values[j]. */
  vectors: Float64Array;
}

/**
 * All eigenpairs of a real symmetric tridiagonal matrix.
 * `diag` (length n) holds the diagonal; `off` (length n-1) the sub/super
 * diagonal (off[i] couples i and i+1). Inputs are not modified.
 * Returns null if the QL iteration fails to converge (practically never
 * happens for Hermitian input).
 */
export function tridiagEigen(diag: Float64Array, off: Float64Array, n: number): TridiagEigenResult | null {
  const d = diag.slice(0, n);
  const e = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) e[i] = off[i]!;
  const z = new Float64Array(n * n);
  for (let i = 0; i < n; i++) z[i * n + i] = 1;
  if (n === 1) return { values: d, vectors: z };

  for (let l = 0; l < n; l++) {
    let iter = 0;
    let m = l;
    do {
      // Find the first negligible off-diagonal at or after l.
      m = l;
      while (m < n - 1) {
        const dd = Math.abs(d[m]!) + Math.abs(d[m + 1]!);
        if (Math.abs(e[m]!) + dd === dd) break;
        m++;
      }
      if (m !== l) {
        if (++iter > 120) return null;
        let g = (d[l + 1]! - d[l]!) / (2 * e[l]!);
        const r0 = Math.hypot(g, 1);
        g = d[m]! - d[l]! + e[l]! / (g + (g >= 0 ? r0 : -r0));
        let s = 1;
        let c = 1;
        let p = 0;
        let i = m - 1;
        let r = 0;
        for (i = m - 1; i >= l; i--) {
          const f = s * e[i]!;
          const b = c * e[i]!;
          r = Math.hypot(f, g);
          e[i + 1] = r;
          if (r === 0) {
            d[i + 1]! -= p;
            e[m] = 0;
            break;
          }
          s = f / r;
          c = g / r;
          g = d[i + 1]! - p;
          r = (d[i]! - g) * s + 2 * c * b;
          p = s * r;
          d[i + 1] = g + p;
          g = c * r - b;
          for (let k = 0; k < n; k++) {
            const idx = k * n;
            const f2 = z[idx + i + 1]!;
            z[idx + i + 1] = s * z[idx + i]! + c * f2;
            z[idx + i] = c * z[idx + i]! - s * f2;
          }
        }
        if (r === 0 && i >= l) continue;
        d[l]! -= p;
        e[l] = g;
        e[m] = 0;
      }
    } while (m !== l);
  }

  // Sort eigenpairs ascending (QL does not guarantee order).
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => d[a]! - d[b]!);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const src = order[j]!;
    values[j] = d[src]!;
    for (let k = 0; k < n; k++) vectors[k * n + j] = z[k * n + src]!;
  }
  return { values, vectors };
}

export interface StationaryResult {
  x: Float64Array;
  dx: number;
  V: Float64Array;
  /** Ascending eigenvalues (finite-difference approximation). */
  energies: Float64Array;
  /** Eigenvectors psi[j], normalised so sum(psi^2) dx = 1, max-lobe positive. */
  psi: Float64Array[];
}

/**
 * Solve the 1-D stationary problem H psi = E psi on the given grid with
 * Dirichlet boundaries. Returns all eigenpairs sorted ascending.
 */
export function solveStationary(V: Float64Array, x: Float64Array, dx: number): StationaryResult {
  const n = x.length;
  const diag = new Float64Array(n);
  const off = new Float64Array(Math.max(0, n - 1));
  const inv2 = 1 / (dx * dx);
  for (let i = 0; i < n; i++) diag[i] = 2 * inv2 + V[i]!;
  for (let i = 0; i < n - 1; i++) off[i] = -inv2;
  const eig = tridiagEigen(diag, off, n);
  if (!eig) throw new Error('tridiagonal eigensolver failed to converge');
  const psi: Float64Array[] = [];
  for (let j = 0; j < n; j++) {
    const v = new Float64Array(n);
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const val = eig.vectors[i * n + j]!;
      v[i] = val;
      sum2 += val * val;
    }
    const scale = 1 / Math.sqrt(Math.max(sum2 * dx, 1e-300));
    // Sign convention: largest-|value| entry positive.
    let maxI = 0;
    let maxA = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(v[i]!);
      if (a > maxA) {
        maxA = a;
        maxI = i;
      }
    }
    const sgn = v[maxI]! >= 0 ? scale : -scale;
    for (let i = 0; i < n; i++) v[i] = v[i]! * sgn;
    psi.push(v);
  }
  return { x, dx, V, energies: eig.values, psi };
}

/**
 * Analytic reference levels for the idealised potentials. Entries are null
 * when no simple closed form exists (double well). Finite-well bound levels
 * come from the transcendental parity equations solved by bisection.
 */
export function analyticLevels(kind: PotentialKind, p: PotentialParams, count: number): Array<number | null> {
  const out: Array<number | null> = [];
  if (kind === 'well') {
    const L = Math.max(p.width, 0.2);
    for (let i = 0; i < count; i++) out.push(((i + 1) * (i + 1) * Math.PI * Math.PI) / (L * L));
    return out;
  }
  if (kind === 'harmonic') {
    for (let i = 0; i < count; i++) out.push((i + 0.5) * p.omega);
    return out;
  }
  if (kind === 'double-well') {
    for (let i = 0; i < count; i++) out.push(null);
    return out;
  }
  // finite well: even branches k tan(k a) = kappa, odd branches -k cot(k a) = kappa
  const a = Math.max(p.halfWidth, 0.05);
  const depth = Math.max(p.depth, 0.1);
  const kmax = Math.sqrt(depth);
  const levels: number[] = [];
  const bisect = (lo: number, hi: number, f: (k: number) => number): number => {
    let a0 = lo;
    let b0 = hi;
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (a0 + b0);
      if (mid <= a0 || mid >= b0) break;
      if (f(mid) > 0) b0 = mid;
      else a0 = mid;
    }
    return 0.5 * (a0 + b0);
  };
  const halfBranch = Math.PI / (2 * a);
  for (let m = 0; ; m++) {
    const lo = (m * Math.PI) / a + 1e-12;
    if (lo >= kmax) break;
    const hi = Math.min((m * Math.PI) / a + halfBranch * (1 - 1e-9), kmax);
    const f = (k: number): number => k * Math.tan(k * a) - Math.sqrt(Math.max(depth - k * k, 0));
    if (f(hi) > 0) levels.push(bisect(lo, hi, f) ** 2);
  }
  for (let m = 0; ; m++) {
    const lo = ((m + 0.5) * Math.PI) / a + 1e-12;
    if (lo >= kmax) break;
    const hi = Math.min(((m + 1) * Math.PI) / a - 1e-9, kmax);
    const f = (k: number): number => -k / Math.tan(k * a) - Math.sqrt(Math.max(depth - k * k, 0));
    if (f(hi) > 0) levels.push(bisect(lo, hi, f) ** 2);
  }
  levels.sort((p1, p2) => p1 - p2);
  for (let i = 0; i < count; i++) out.push(i < levels.length ? levels[i]! : null);
  return out;
}

// ---- Crank-Nicolson time evolution -----------------------------------------

export interface CnWork {
  cr: Float64Array;
  ci: Float64Array;
  dr: Float64Array;
  di: Float64Array;
  rr: Float64Array;
  ri: Float64Array;
}

export function makeCnWork(n: number): CnWork {
  return {
    cr: new Float64Array(n),
    ci: new Float64Array(n),
    dr: new Float64Array(n),
    di: new Float64Array(n),
    rr: new Float64Array(n),
    ri: new Float64Array(n),
  };
}

/**
 * Advance psi by one Crank-Nicolson step of  i dpsi/dt = (-d^2/dx^2 + V) psi:
 *   (I + i dt/2 H) psi^{n+1} = (I - i dt/2 H) psi^n,
 * solved by a complex Thomas sweep. Dirichlet boundaries (psi = 0 outside
 * the interior grid). In-place. The Cayley transform is unitary, so the norm
 * is conserved to solver precision.
 */
export function cnStep(re: Float64Array, im: Float64Array, V: Float64Array, dx: number, dt: number, w: CnWork): void {
  const n = re.length;
  if (n === 0) return;
  const alpha = dt / 2;
  const inv2 = 1 / (dx * dx);
  // Matrix A = I + i alpha H. H is real symmetric tridiagonal with diagonal
  // h_i = 2/dx^2 + V_i and off-diagonal -1/dx^2, so:
  //   A diagonal     = 1 + i alpha h_i
  //   A off-diagonal = -i alpha / dx^2   (purely imaginary, same both sides)
  const offR = 0;
  const offI = -alpha * inv2;

  // RHS r = (I - i alpha H) psi = psi - i alpha (H psi); H psi is componentwise real.
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? re[i - 1]! : 0;
    const next = i < n - 1 ? re[i + 1]! : 0;
    const hRe = (2 * inv2 + V[i]!) * re[i]! - (prev + next) * inv2;
    const prevI = i > 0 ? im[i - 1]! : 0;
    const nextI = i < n - 1 ? im[i + 1]! : 0;
    const hIm = (2 * inv2 + V[i]!) * im[i]! - (prevI + nextI) * inv2;
    w.rr[i] = re[i]! + alpha * hIm;
    w.ri[i] = im[i]! - alpha * hRe;
  }

  // Complex Thomas sweep on A w = r. diag_i = 1 + i alpha (2/dx^2 + V_i).
  // Forward elimination:
  let denR = 1;
  let denI = alpha * (2 * inv2 + V[0]!);
  let denInv = 1 / (denR * denR + denI * denI);
  let cR = (offR * denR + offI * denI) * denInv;
  let cI = (offI * denR - offR * denI) * denInv;
  w.cr[0] = cR;
  w.ci[0] = cI;
  w.dr[0] = (w.rr[0]! * denR + w.ri[0]! * denI) * denInv;
  w.di[0] = (w.ri[0]! * denR - w.rr[0]! * denI) * denInv;
  for (let i = 1; i < n; i++) {
    denR = 1 - (offR * cR - offI * cI);
    denI = alpha * (2 * inv2 + V[i]!) - (offR * cI + offI * cR);
    denInv = 1 / (denR * denR + denI * denI);
    if (i < n - 1) {
      cR = (offR * denR + offI * denI) * denInv;
      cI = (offI * denR - offR * denI) * denInv;
      w.cr[i] = cR;
      w.ci[i] = cI;
    }
    const br = w.rr[i]! - (offR * w.dr[i - 1]! - offI * w.di[i - 1]!);
    const bi = w.ri[i]! - (offR * w.di[i - 1]! + offI * w.dr[i - 1]!);
    w.dr[i] = (br * denR + bi * denI) * denInv;
    w.di[i] = (bi * denR - br * denI) * denInv;
  }
  // Back substitution:
  re[n - 1] = w.dr[n - 1]!;
  im[n - 1] = w.di[n - 1]!;
  for (let i = n - 2; i >= 0; i--) {
    re[i] = w.dr[i]! - (w.cr[i]! * re[i + 1]! - w.ci[i]! * im[i + 1]!);
    im[i] = w.di[i]! - (w.cr[i]! * im[i + 1]! + w.ci[i]! * re[i + 1]!);
  }
}

/** Initial Gaussian packet  psi = (2 pi s^2)^(-1/4) exp(-(x-x0)^2/4s^2 + i k0 x). */
export function gaussianPacket(x: Float64Array, dx: number, x0: number, sigma0: number, k0: number): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const s2 = 4 * sigma0 * sigma0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - x0;
    const env = Math.exp((-d * d) / s2);
    const phase = k0 * x[i]!;
    re[i] = env * Math.cos(phase);
    im[i] = env * Math.sin(phase);
    norm += env * env;
  }
  norm *= dx;
  const scale = 1 / Math.sqrt(Math.max(norm, 1e-300));
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! * scale;
    im[i] = im[i]! * scale;
  }
  return { re, im };
}

export interface PacketStats {
  norm: number;
  meanX: number;
  sigmaX: number;
}

/** Norm, mean and width of |psi|^2 on the grid. */
export function packetStats(re: Float64Array, im: Float64Array, x: Float64Array, dx: number): PacketStats {
  const n = re.length;
  let norm = 0;
  let mx = 0;
  let mx2 = 0;
  for (let i = 0; i < n; i++) {
    const p = re[i]! * re[i]! + im[i]! * im[i]!;
    norm += p;
    mx += p * x[i]!;
    mx2 += p * x[i]! * x[i]!;
  }
  norm *= dx;
  mx = mx * dx / Math.max(norm, 1e-300);
  mx2 = mx2 * dx / Math.max(norm, 1e-300);
  const varX = Math.max(mx2 - mx * mx, 0);
  return { norm, meanX: mx, sigmaX: Math.sqrt(varX) };
}

/** Analytic free-packet width for H = -d^2/dx^2: sigma(t) = sqrt(s0^2 + t^2/s0^2). */
export function freePacketWidth(sigma0: number, t: number): number {
  const s0 = Math.max(sigma0, 1e-9);
  return Math.sqrt(s0 * s0 + (t / s0) * (t / s0));
}

/** Analytic free-packet centre: x0 + 2 k0 t (group velocity d(k^2)/dk = 2k). */
export function freePacketCenter(x0: number, k0: number, t: number): number {
  return x0 + 2 * k0 * t;
}

/** Relative error |computed - reference| / |reference| (unified benchmark metric). */
export function relErr(computed: number, reference: number): number {
  if (!Number.isFinite(computed) || !Number.isFinite(reference) || reference === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(computed - reference) / Math.abs(reference);
}
