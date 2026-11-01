// ==========================================================================
// eng-vibration kernel — structural vibration analysis (pure numeric core).
//
// No DOM, no plugin-framework imports; the Jacobi eigensolver, the RK4
// integrator and all complex arithmetic are implemented locally.
//
// Modules
//   sdof             mass-spring-damper single degree of freedom:
//                      - free decay: fixed-step RK4 vs the exact closed form
//                      - harmonic forcing: analytic receptance H(jw) = X/F
//                      - half-power (-3 dB) identification of zeta and wn
//   mdof             N-DOF spring-mass-damper chains and the simply supported
//                      beam (lumped-mass / concentrated-stiffness model):
//                      generalized symmetric eigenproblem K*phi = w^2*M*phi
//                      with diagonal SPD M solved by cyclic Jacobi rotations
//                      after the scaling A = K/(sqrt(mi)*sqrt(mj)); modes are
//                      mass-normalized by construction; Rayleigh damping and
//                      modal-superposition harmonic response
//   frf              log-frequency-response sweeps in dB (sdof receptance or
//                      the drive-point FRF of the first mdof mode)
//   transmissibility base-isolation force/displacement transmissibility
//                      T(r) = sqrt((1+(2*zeta*r)^2) / ((1-r^2)^2+(2*zeta*r)^2));
//                      T(sqrt(2)) = 1 EXACTLY (algebraic identity) marks the
//                      isolation boundary, and the closed-form peak is
//                      T_max = 1/(2*zeta) * (1 + O(zeta^2))
//   unbalance        rotating unbalance excitation F0 = me*e*w^2: normalized
//                      amplitude m*X/(me*e) = r^2/sqrt((1-r^2)^2+(2*zeta*r)^2)
//                      peaks at EXACTLY 1/(2*zeta) on r = 1 where the phase
//                      lag is EXACTLY 90 deg; shaft orbit for an anisotropic
//                      rotor (ky/kx = kappa)
//
// References: S. S. Rao, "Mechanical Vibrations" (SDOF/MDOF response,
// transmissibility, rotating unbalance, half-power method); K.-J. Bathe,
// "Finite Element Procedures" (lumped-mass beam models, generalized
// eigenproblem); G. H. Golub & C. F. Van Loan, "Matrix Computations",
// ch. 8 (cyclic Jacobi); J. Stoer & R. Bulirsch, "Introduction to Numerical
// Analysis" (RK4).
// ==========================================================================

/** Raised for invalid parameters or solver limits. */
export class VibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VibrationError';
  }
}

// ---- small helpers ---------------------------------------------------------

/** n log-spaced samples in [lo, hi] (requires 0 < lo <= hi, n >= 2). */
export function logspace(lo: number, hi: number, n: number): number[] {
  if (!(lo > 0) || !(hi >= lo)) throw new VibrationError('logspace needs 0 < lo <= hi');
  if (!(n >= 2)) throw new VibrationError('logspace needs n >= 2');
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = lo * Math.pow(hi / lo, i / (n - 1));
  return out;
}

function toDeg(x: number): number {
  return (x * 180) / Math.PI;
}

// ==========================================================================
// SDOF — mass-spring-damper single degree of freedom
// ==========================================================================

export interface SdofParams {
  /** Mass (kg). */
  m: number;
  /** Stiffness (N/m). */
  k: number;
  /** Viscous damping coefficient (N*s/m). */
  c: number;
}

export interface SdofDerived {
  /** Undamped natural frequency (rad/s). */
  wn: number;
  /** Damping ratio (-). */
  zeta: number;
  /** Damped natural frequency (rad/s); 0 for zeta >= 1. */
  wd: number;
  /** Critical damping (N*s/m). */
  ccrit: number;
  /** Quality factor Q = 1/(2*zeta); Infinity for zeta = 0. */
  Q: number;
}

/** Validate the SDOF parameters and derive wn / zeta / wd / Q. */
export function sdofDerived(p: SdofParams): SdofDerived {
  if (!(p.m > 0)) throw new VibrationError('mass m must be > 0 kg');
  if (!(p.k > 0)) throw new VibrationError('stiffness k must be > 0 N/m');
  if (!(p.c >= 0)) throw new VibrationError('damping c must be >= 0 N*s/m');
  const wn = Math.sqrt(p.k / p.m);
  const ccrit = 2 * Math.sqrt(p.k * p.m);
  const zeta = p.c / ccrit;
  const wd = zeta < 1 ? wn * Math.sqrt(1 - zeta * zeta) : 0;
  return { wn, zeta, wd, ccrit, Q: zeta > 0 ? 1 / (2 * zeta) : Number.POSITIVE_INFINITY };
}

/** Exact free-decay solution x(t) for x(0) = x0, x'(0) = v0 (any damping ratio). */
export function sdofFreeDecayExact(p: SdofParams, x0: number, v0: number, t: number): number {
  const { wn, zeta } = sdofDerived(p);
  if (t <= 0) return x0;
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * wn * t);
    return env * (x0 * Math.cos(wd * t) + ((v0 + zeta * wn * x0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) {
    return Math.exp(-wn * t) * (x0 + (v0 + wn * x0) * t);
  }
  const s = wn * Math.sqrt(zeta * zeta - 1);
  const env = Math.exp(-zeta * wn * t);
  return env * (x0 * Math.cosh(s * t) + ((v0 + zeta * wn * x0) / s) * Math.sinh(s * t));
}

/** Exact free-decay velocity v(t) (analytic derivative of sdofFreeDecayExact). */
export function sdofFreeVelocityExact(p: SdofParams, x0: number, v0: number, t: number): number {
  const { wn, zeta } = sdofDerived(p);
  if (t <= 0) return v0;
  const zwn = zeta * wn;
  const c1 = v0 + zwn * x0;
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zwn * t);
    return env * (c1 * Math.cos(wd * t) - x0 * wd * Math.sin(wd * t)) - zwn * sdofFreeDecayExact(p, x0, v0, t);
  }
  if (zeta === 1) {
    const env = Math.exp(-wn * t);
    return env * (c1 - wn * (x0 + c1 * t));
  }
  const s = wn * Math.sqrt(zeta * zeta - 1);
  const env = Math.exp(-zwn * t);
  return env * (c1 * Math.cosh(s * t) + x0 * s * Math.sinh(s * t)) - zwn * sdofFreeDecayExact(p, x0, v0, t);
}

export interface DecaySim {
  t: number[];
  /** RK4 solution. */
  xNum: number[];
  /** Exact closed-form solution sampled on the same grid. */
  xExact: number[];
  /** RK4 velocity (phase-plane ordinate). */
  vNum: number[];
  /** Exact closed-form velocity sampled on the same grid. */
  vExact: number[];
  /** max |xNum - xExact|. */
  maxAbsDev: number;
  /** maxAbsDev / max(|xNum|, |xExact|). */
  maxRelDev: number;
}

/** Fixed-step RK4 integration of m*x'' + c*x' + k*x = 0 from (x0, v0). */
export function sdofFreeDecayRk4(p: SdofParams, x0: number, v0: number, tEnd: number, nSteps: number): DecaySim {
  sdofDerived(p); // validation
  if (!(tEnd > 0)) throw new VibrationError('tEnd must be > 0 s');
  if (!Number.isInteger(nSteps) || nSteps < 2) throw new VibrationError('nSteps must be an integer >= 2');
  const dt = tEnd / nSteps;
  const f = (x: number, v: number): [number, number] => [v, (-p.k * x - p.c * v) / p.m];

  const t: number[] = new Array(nSteps + 1);
  const xNum: number[] = new Array(nSteps + 1);
  const xExact: number[] = new Array(nSteps + 1);
  const vNum: number[] = new Array(nSteps + 1);
  const vExact: number[] = new Array(nSteps + 1);
  let x = x0;
  let v = v0;
  t[0] = 0;
  xNum[0] = x0;
  xExact[0] = x0;
  vNum[0] = v0;
  vExact[0] = v0;
  for (let i = 1; i <= nSteps; i += 1) {
    const [k1x, k1v] = f(x, v);
    const [k2x, k2v] = f(x + (dt / 2) * k1x, v + (dt / 2) * k1v);
    const [k3x, k3v] = f(x + (dt / 2) * k2x, v + (dt / 2) * k2v);
    const [k4x, k4v] = f(x + dt * k3x, v + dt * k3v);
    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    t[i] = i * dt;
    xNum[i] = x;
    xExact[i] = sdofFreeDecayExact(p, x0, v0, t[i]!);
    vNum[i] = v;
    vExact[i] = sdofFreeVelocityExact(p, x0, v0, t[i]!);
  }
  let maxX = 0;
  for (let i = 0; i <= nSteps; i += 1) maxX = Math.max(maxX, Math.abs(xNum[i]!), Math.abs(xExact[i]!));
  let maxAbsDev = 0;
  for (let i = 0; i <= nSteps; i += 1) maxAbsDev = Math.max(maxAbsDev, Math.abs(xNum[i]! - xExact[i]!));
  return { t, xNum, xExact, vNum, vExact, maxAbsDev, maxRelDev: maxX > 0 ? maxAbsDev / maxX : maxAbsDev };
}

export interface DecayIdentification {
  ok: boolean;
  /** Log decrement delta = ln(A_i / A_{i+1}) between successive positive peaks. */
  delta: number;
  /** Damping ratio zeta = delta / sqrt(4*pi^2 + delta^2). */
  zeta: number;
  /** Damped natural frequency from the mean peak spacing (rad/s). */
  wd: number;
  /** Undamped natural frequency wd / sqrt(1 - zeta^2) (rad/s). */
  wn: number;
  /** wn / (2*pi) (Hz). */
  fn: number;
  /** First peak amplitude (envelope reference). */
  a1: number;
  /** Number of positive peaks used. */
  peaks: number;
}

const DECAY_ID_NAN: DecayIdentification = {
  ok: false,
  delta: Number.NaN,
  zeta: Number.NaN,
  wd: Number.NaN,
  wn: Number.NaN,
  fn: Number.NaN,
  a1: Number.NaN,
  peaks: 0,
};

/**
 * Log-decrement identification of a lightly damped free decay from a sampled
 * displacement history: locate successive positive local maxima above 5 % of
 * the global amplitude, average delta = ln(A_i/A_{i+1}) = 2*pi*zeta/sqrt(1-zeta^2)
 * and the peak spacing T_d = 2*pi/wd. Needs at least 3 peaks (2 increments).
 */
export function decayIdentify(t: number[], x: number[]): DecayIdentification {
  const n = t.length;
  if (n < 8 || x.length !== n) return { ...DECAY_ID_NAN };
  let xMax = 0;
  for (const v of x) if (Math.abs(v) > xMax) xMax = Math.abs(v);
  if (!(xMax > 0) || !Number.isFinite(xMax)) return { ...DECAY_ID_NAN };
  const floor = 0.05 * xMax;
  const pk: Array<{ t: number; a: number }> = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (x[i]! > x[i - 1]! && x[i]! >= x[i + 1]! && x[i]! > floor) {
      pk.push({ t: t[i]!, a: x[i]! });
    }
  }
  if (pk.length < 3) return { ...DECAY_ID_NAN };
  let sDelta = 0;
  let sPer = 0;
  for (let i = 0; i + 1 < pk.length; i += 1) {
    const ratio = pk[i]!.a / pk[i + 1]!.a;
    if (!(ratio > 1)) return { ...DECAY_ID_NAN }; // growing or flat peaks: not a stable decay
    sDelta += Math.log(ratio);
    sPer += pk[i + 1]!.t - pk[i]!.t;
  }
  const m = pk.length - 1;
  const delta = sDelta / m;
  const Td = sPer / m;
  if (!(delta > 0) || !(Td > 0) || delta > 4) return { ...DECAY_ID_NAN };
  const zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
  const wd = (2 * Math.PI) / Td;
  const wn = wd / Math.sqrt(1 - zeta * zeta);
  return { ok: true, delta, zeta, wd, wn, fn: wn / (2 * Math.PI), a1: pk[0]!.a, peaks: pk.length };
}

/** Receptance H(jw) = X/F = 1/(k - m*w^2 + j*c*w); phaseLagDeg is the angle by
 *  which the displacement lags the force, in [0, 180] degrees. */
export function sdofReceptance(p: SdofParams, w: number): { mag: number; phaseLagDeg: number } {
  sdofDerived(p); // validation
  const re = p.k - p.m * w * w;
  const im = p.c * w;
  const mag = 1 / Math.hypot(re, im);
  return { mag, phaseLagDeg: toDeg(Math.atan2(im, re)) };
}

export interface FrfSweep {
  /** Angular frequencies (rad/s), ascending. */
  w: number[];
  /** 20*log10|H| (dB). */
  magDb: number[];
  /** Displacement phase lag behind the force (degrees). */
  phaseLagDeg: number[];
}

/** Log-spaced receptance sweep over r = w/wn in [rLo, rHi]. */
export function sdofFrf(p: SdofParams, n = 800, rLo = 0.05, rHi = 20): FrfSweep {
  const { wn } = sdofDerived(p);
  const w = logspace(rLo * wn, rHi * wn, n);
  const magDb: number[] = new Array(n);
  const phaseLagDeg: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const h = sdofReceptance(p, w[i]!);
    magDb[i] = 20 * Math.log10(h.mag);
    phaseLagDeg[i] = h.phaseLagDeg;
  }
  return { w, magDb, phaseLagDeg };
}

export interface HalfPowerId {
  /** False when the sweep does not bracket a clean resonance peak. */
  ok: boolean;
  /** Resonance frequency from a parabolic peak refinement (rad/s). */
  wr: number;
  /** Identified undamped natural frequency wr/sqrt(1-2*zeta^2) (rad/s). */
  wn: number;
  /** Identified damping ratio (w2 - w1)/(2*wr). */
  zeta: number;
  /** Quality factor 1/(2*zeta). */
  Q: number;
  /** Refined peak level (dB). */
  peakDb: number;
  /** Lower / upper half-power (-3 dB) frequencies (rad/s). */
  w1: number;
  w2: number;
}

const HALF_POWER_NAN: HalfPowerId = {
  ok: false,
  wr: Number.NaN,
  wn: Number.NaN,
  zeta: Number.NaN,
  Q: Number.NaN,
  peakDb: Number.NaN,
  w1: Number.NaN,
  w2: Number.NaN,
};

/**
 * Half-power (-3 dB) identification from an FRF sweep: locate the resonance
 * peak (parabolic refinement on the log-frequency grid), then bracket the two
 * crossings of peak - 10*log10(2) dB by linear interpolation of magDb in
 * log w. Classic estimator zeta = (w2 - w1)/(2*wr); wn = wr/sqrt(1-2*zeta^2).
 * The estimator carries an O(zeta^2) method bias (~0.5% at zeta = 0.05).
 */
export function halfPowerIdentify(s: FrfSweep): HalfPowerId {
  const n = s.w.length;
  if (n < 5) return { ...HALF_POWER_NAN };
  let imax = 0;
  for (let i = 1; i < n; i += 1) if (s.magDb[i]! > s.magDb[imax]!) imax = i;
  if (imax === 0 || imax === n - 1) return { ...HALF_POWER_NAN };

  // Parabolic peak refinement in log w (grid is log-spaced => equal steps).
  const x1 = Math.log(s.w[imax - 1]!);
  const x2 = Math.log(s.w[imax]!);
  const x3 = Math.log(s.w[imax + 1]!);
  const y1 = s.magDb[imax - 1]!;
  const y2 = s.magDb[imax]!;
  const y3 = s.magDb[imax + 1]!;
  const den = y1 - 2 * y2 + y3;
  const delta = den < 0 ? (0.5 * (y1 - y3)) / den : 0; // vertex offset in grid steps
  const h = x2 - x1;
  const logWr = x2 + delta * h;
  const peakDb = y2 - 0.25 * (y1 - y3) * delta;
  const wr = Math.exp(logWr);
  const threshold = peakDb - 10 * Math.log10(2);

  // Left crossing: first sample below the threshold scanning down from imax.
  let w1 = Number.NaN;
  for (let i = imax - 1; i >= 1; i -= 1) {
    if (s.magDb[i]! <= threshold) {
      const f = (threshold - s.magDb[i]!) / (s.magDb[i + 1]! - s.magDb[i]!);
      w1 = Math.exp(Math.log(s.w[i]!) + f * (Math.log(s.w[i + 1]!) - Math.log(s.w[i]!)));
      break;
    }
  }
  // Right crossing: first sample below the threshold scanning up from imax.
  let w2 = Number.NaN;
  for (let i = imax + 1; i < n - 1; i += 1) {
    if (s.magDb[i]! <= threshold) {
      const f = (threshold - s.magDb[i]!) / (s.magDb[i - 1]! - s.magDb[i]!);
      w2 = Math.exp(Math.log(s.w[i]!) + f * (Math.log(s.w[i - 1]!) - Math.log(s.w[i]!)));
      break;
    }
  }
  if (!Number.isFinite(w1) || !Number.isFinite(w2)) {
    return { ...HALF_POWER_NAN, wr, peakDb, w1, w2 };
  }
  const zeta = (w2 - w1) / (2 * wr);
  if (!(zeta > 0) || !(zeta < Math.SQRT1_2)) {
    return { ...HALF_POWER_NAN, wr, peakDb, w1, w2 };
  }
  const wn = wr / Math.sqrt(1 - 2 * zeta * zeta);
  return { ok: true, wr, wn, zeta, Q: 1 / (2 * zeta), peakDb, w1, w2 };
}

// ==========================================================================
// MDOF — chains, simply supported beam, generalized Jacobi eigenanalysis
// ==========================================================================

export interface MdofModel {
  /** Number of DOFs. */
  n: number;
  /** Symmetric stiffness matrix (N/m). */
  K: number[][];
  /** Diagonal (lumped) mass matrix entries (kg). */
  mDiag: number[];
  /** Node positions for plotting (m or normalized). */
  positions: number[];
  /** Human-readable model label. */
  label: string;
}

function zeros(n: number): number[][] {
  const K: number[][] = new Array(n);
  for (let i = 0; i < n; i += 1) K[i] = new Array<number>(n).fill(0);
  return K;
}

/**
 * Fixed-fixed spring-mass chain. Element e (e = 0..n) connects DOF e-1 and DOF
 * e; DOF -1 and DOF n are the walls. `springs` holds n (element 0..n-1 below
 * each mass; the closing top spring reuses the last value) or n+1 stiffnesses.
 * With n masses and n+1 equal springs k the exact spectrum is
 * w_r = 2*sqrt(k/m)*sin(r*pi/(2*(n+1))).
 */
export function buildChain(masses: number[], springs: number[]): MdofModel {
  const n = masses.length;
  if (n < 1) throw new VibrationError('chain needs at least one mass');
  for (const m of masses) if (!(m > 0)) throw new VibrationError('chain masses must be > 0 kg');
  if (springs.length !== n && springs.length !== n + 1) {
    throw new VibrationError('chain needs n or n+1 spring stiffnesses for n masses');
  }
  const kArr = springs.length === n + 1 ? springs.slice() : [...springs, springs[springs.length - 1]!];
  for (const k of kArr) if (!(k > 0)) throw new VibrationError('chain stiffnesses must be > 0 N/m');
  const K = zeros(n);
  for (let e = 0; e <= n; e += 1) {
    const k = kArr[e]!;
    const a = e - 1;
    const b = e;
    if (a >= 0) {
      K[a]![a]! += k;
      K[a]![b]! -= k;
      K[b]![a]! -= k;
    }
    K[b]![b]! += k;
  }
  const positions: number[] = new Array(n);
  for (let j = 0; j < n; j += 1) positions[j] = (j + 1) / (n + 1);
  return { n, K, mDiag: masses.slice(), positions, label: 'chain' };
}

/**
 * Simply supported Euler-Bernoulli beam, lumped-mass / concentrated-stiffness
 * model: nInterior nodes at x_j = j*h with h = L/(nInterior+1), lumped mass
 * rhoA*h per node, bending stiffness from the 4th-order stencil
 * [1 -4 6 -4 1]*EI/h^3 with the moment-free mirror condition w(-1) = -w(1)
 * (and w(n+2) = -w(n)). With that boundary closure the sin(r*pi*j/(n+1))
 * vectors are EXACT discrete eigenmodes and the discrete spectrum is
 * w_r = 4*sin^2(r*pi/(2*(n+1))) * sqrt(EI/rhoA) / h^2, which converges to the
 * continuous beam theory w_r = (r*pi/L)^2*sqrt(EI/rhoA) from below.
 */
export function buildBeam(nInterior: number, EI: number, rhoA: number, L: number): MdofModel {
  if (!Number.isInteger(nInterior) || nInterior < 4) throw new VibrationError('beam needs an integer >= 4 interior nodes');
  if (!(EI > 0) || !(rhoA > 0) || !(L > 0)) throw new VibrationError('beam EI, rhoA and L must be > 0');
  const h = L / (nInterior + 1);
  const m = rhoA * h;
  const s = EI / (h * h * h);
  const n = nInterior;
  const K = zeros(n);
  for (let i = 0; i < n; i += 1) {
    K[i]![i]! += 6 * s;
    if (i + 1 < n) {
      K[i]![i + 1]! -= 4 * s;
      K[i + 1]![i]! -= 4 * s;
    }
    if (i + 2 < n) {
      K[i]![i + 2]! += s;
      K[i + 2]![i]! += s;
    }
  }
  K[0]![0]! -= s; // mirror w(-1) = -w(1)
  K[n - 1]![n - 1]! -= s; // mirror w(n+2) = -w(n)
  const positions: number[] = new Array(n);
  for (let j = 0; j < n; j += 1) positions[j] = (j + 1) * h;
  return { n, K, mDiag: new Array<number>(n).fill(m), positions, label: 'beam' };
}

export interface EigenDecomposition {
  /** Ascending eigenvalues. */
  values: number[];
  /** Orthonormal eigenvector matrix, columns match `values`. */
  vectors: number[][];
}

/**
 * Cyclic Jacobi eigenvalue iteration for a real symmetric matrix (Golub & Van
 * Loan ch. 8). Deterministic: fixed (p, q) rotation order, fixed sweep count.
 * Returns ascending eigenvalues and the matching orthonormal eigenvectors.
 */
export function jacobiEigenSym(aIn: number[][]): EigenDecomposition {
  const n = aIn.length;
  if (n < 1) throw new VibrationError('jacobiEigenSym: empty matrix');
  for (const row of aIn) if (row.length !== n) throw new VibrationError('jacobiEigenSym: matrix must be square');
  const a = aIn.map((row) => row.slice());
  const v = zeros(n);
  for (let i = 0; i < n; i += 1) v[i]![i] = 1;
  if (n === 1) return { values: [a[0]![0]!], vectors: v };

  let fro2 = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) fro2 += a[i]![j]! * a[i]![j]!;
  const scale = Math.sqrt(fro2);
  if (scale === 0) {
    // Zero matrix: the diagonal is already the (all-zero) spectrum.
    return { values: a.map((row) => row[0]!), vectors: v };
  }
  const tol = 1e-13 * scale;
  const skip = tol / (10 * n);
  const MAX_SWEEPS = 60;

  const offNorm = (): number => {
    let s = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) s += a[i]![j]! * a[i]![j]!;
    return Math.sqrt(2 * s);
  };

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) <= skip) continue;
        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const tau = (aqq - app) / (2 * apq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        for (let i = 0; i < n; i += 1) {
          if (i === p || i === q) continue;
          const aip = a[i]![p]!;
          const aiq = a[i]![q]!;
          a[i]![p] = c * aip - s * aiq;
          a[p]![i] = a[i]![p];
          a[i]![q] = s * aip + c * aiq;
          a[q]![i] = a[i]![q];
        }
        a[p]![p] = app - t * apq;
        a[q]![q] = aqq + t * apq;
        a[p]![q] = 0;
        a[q]![p] = 0;
        for (let i = 0; i < n; i += 1) {
          const vip = v[i]![p]!;
          const viq = v[i]![q]!;
          v[i]![p] = c * vip - s * viq;
          v[i]![q] = s * vip + c * viq;
        }
      }
    }
    if (offNorm() <= tol) break;
  }

  // Sort ascending (insertion sort on the diagonal; deterministic).
  const order: number[] = Array.from({ length: n }, (_, i) => i);
  for (let i = 1; i < n; i += 1) {
    const key = order[i]!;
    let j = i - 1;
    while (j >= 0 && a[order[j]!]![order[j]!]! > a[key]![key]!) {
      order[j + 1] = order[j]!;
      j -= 1;
    }
    order[j + 1] = key;
  }
  const values: number[] = new Array(n);
  const vectors = zeros(n);
  for (let r = 0; r < n; r += 1) {
    const src = order[r]!;
    values[r] = a[src]![src]!;
    for (let i = 0; i < n; i += 1) vectors[i]![r] = v[i]![src]!;
  }
  return { values, vectors };
}

export interface MdofModes {
  n: number;
  /** Ascending natural frequencies (rad/s). */
  omega: number[];
  /** Mass-normalized mode shapes, shapes[dof][mode]. */
  shapes: number[][];
}

/**
 * Generalized symmetric eigenproblem K*phi = w^2*M*phi with diagonal SPD M:
 * scale A = K_ij/(sqrt(mi)*sqrt(mj)), Jacobi-diagonalize A = V*Lambda*V^T,
 * then phi_ir = V_ir/sqrt(mi). The mass normalization sum(mi*phi_i^2) = 1
 * holds automatically because the Jacobi vectors are orthonormal.
 */
export function generalizedEigenDiagM(model: MdofModel): MdofModes {
  const { n, K, mDiag } = model;
  if (n < 1) throw new VibrationError('empty MDOF model');
  if (mDiag.length !== n || K.length !== n) throw new VibrationError('MDOF model size mismatch');
  for (const m of mDiag) if (!(m > 0)) throw new VibrationError('masses must be > 0 (diagonal SPD M)');
  const A: number[][] = K.map((row, i) =>
    row.map((val, j) => val / (Math.sqrt(mDiag[i]!) * Math.sqrt(mDiag[j]!))),
  );
  const eig = jacobiEigenSym(A);
  let lamMax = 0;
  for (const lam of eig.values) lamMax = Math.max(lamMax, Math.abs(lam));
  if (!(lamMax > 0)) throw new VibrationError('stiffness matrix is singular (zero spectrum)');
  const omega: number[] = new Array(n);
  for (let r = 0; r < n; r += 1) {
    const lam = eig.values[r]!;
    if (lam <= lamMax * 1e-12) throw new VibrationError('stiffness matrix is not positive definite');
    omega[r] = Math.sqrt(lam);
  }
  const shapes: number[][] = zeros(n);
  for (let i = 0; i < n; i += 1) {
    const sq = Math.sqrt(mDiag[i]!);
    for (let r = 0; r < n; r += 1) shapes[i]![r] = eig.vectors[i]![r]! / sq;
  }
  // Sign convention: the largest-|component| of every mode is positive.
  for (let r = 0; r < n; r += 1) {
    let bi = 0;
    let bv = 0;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(shapes[i]![r]!) > bv) {
        bv = Math.abs(shapes[i]![r]!);
        bi = i;
      }
    }
    if (shapes[bi]![r]! < 0) for (let i = 0; i < n; i += 1) shapes[i]![r] = -shapes[i]![r]!;
  }
  return { n, omega, shapes };
}

/** Rayleigh damping coefficients achieving zeta at w1 and w2:
 *  alpha = 2*zeta*w1*w2/(w1+w2), beta = 2*zeta/(w1+w2). */
export function rayleighAlphaBeta(w1: number, w2: number, zeta: number): { alpha: number; beta: number } {
  if (!(w1 > 0 && w2 > w1)) throw new VibrationError('rayleighAlphaBeta needs 0 < w1 < w2');
  if (!(zeta >= 0)) throw new VibrationError('rayleigh zeta must be >= 0');
  return { alpha: (2 * zeta * w1 * w2) / (w1 + w2), beta: (2 * zeta) / (w1 + w2) };
}

/** Modal damping ratios zeta_r = alpha/(2*w_r) + beta*w_r/2. */
export function rayleighModalZeta(omega: number[], alpha: number, beta: number): number[] {
  return omega.map((w) => alpha / (2 * w) + (beta * w) / 2);
}

/**
 * Modal damping ratios for per-DOF viscous dashpots to ground, C = diag(c_i):
 * with mass-normalized modes the modal damping ratio is
 * zeta_r = (phi_r^T C phi_r) / (2*w_r) = (sum_i c_i * phi_ir^2) / (2*w_r).
 */
export function modalZetaDiagC(shapes: number[][], cDiag: number[], omega: number[]): number[] {
  const n = omega.length;
  if (cDiag.length !== n || shapes.length !== n) {
    throw new VibrationError('damping list length must match the DOF count');
  }
  for (const c of cDiag) if (!(c >= 0)) throw new VibrationError('dampings must be >= 0 N*s/m');
  return omega.map((w, r) => {
    let cr = 0;
    for (let i = 0; i < n; i += 1) cr += cDiag[i]! * shapes[i]![r]! * shapes[i]![r]!;
    return cr / (2 * w);
  });
}

// ---- analytic references ---------------------------------------------------

/** Exact fixed-fixed uniform chain spectrum w_r = 2*sqrt(k/m)*sin(r*pi/(2*(n+1))). */
export function chainAnalyticOmega(n: number, m: number, k: number): number[] {
  if (!(n >= 1)) throw new VibrationError('chainAnalyticOmega needs n >= 1');
  const out: number[] = new Array(n);
  for (let r = 1; r <= n; r += 1) out[r - 1] = 2 * Math.sqrt(k / m) * Math.sin((r * Math.PI) / (2 * (n + 1)));
  return out;
}

/** Mass-normalized uniform-chain mode shape phi_r(j) ~ sin(r*j*pi/(n+1)). */
export function chainAnalyticMassMode(n: number, r: number, m: number): number[] {
  const phi: number[] = new Array(n);
  let s2 = 0;
  for (let j = 1; j <= n; j += 1) {
    const val = Math.sin((r * j * Math.PI) / (n + 1));
    phi[j - 1] = val;
    s2 += val * val;
  }
  const c = Math.sqrt(1 / (m * s2));
  for (let j = 0; j < n; j += 1) phi[j] = phi[j]! * c;
  return phi;
}

/** Exact discrete spectrum of buildBeam (see the builder docstring). */
export function beamDiscreteOmega(nModes: number, EI: number, rhoA: number, L: number, nInterior: number): number[] {
  const h = L / (nInterior + 1);
  const c = Math.sqrt(EI / rhoA) / (h * h);
  const out: number[] = new Array(nModes);
  for (let r = 1; r <= nModes; r += 1) {
    const half = (r * Math.PI) / (2 * (nInterior + 1));
    out[r - 1] = 4 * Math.sin(half) * Math.sin(half) * c;
  }
  return out;
}

/** Continuous simply-supported Euler-Bernoulli beam theory w_r = (r*pi/L)^2*sqrt(EI/rhoA). */
export function beamContinuousOmega(nModes: number, EI: number, rhoA: number, L: number): number[] {
  const c = Math.sqrt(EI / rhoA);
  const out: number[] = new Array(nModes);
  for (let r = 1; r <= nModes; r += 1) {
    const k = (r * Math.PI) / L;
    out[r - 1] = k * k * c;
  }
  return out;
}

// ---- modal superposition harmonic response ---------------------------------

export interface ResponseC {
  /** In-phase part of the complex response X(w). */
  re: number[];
  /** Quadrature part of the complex response X(w). */
  im: number[];
}

/**
 * Modal superposition X(w) = sum_r phi_r (phi_r^T F) / (w_r^2 - w^2 + 2i zeta_r
 * w_r w) with mass-normalized modes. Decoupled per mode, so no linear system
 * is solved.
 */
export function modalResponse(modes: MdofModes, zetas: number[], force: number[], w: number): ResponseC {
  const n = modes.n;
  if (zetas.length !== n || force.length !== n) throw new VibrationError('zeta/force length must match DOF count');
  const re: number[] = new Array(n).fill(0);
  const im: number[] = new Array(n).fill(0);
  for (let r = 0; r < n; r += 1) {
    let b = 0;
    for (let j = 0; j < n; j += 1) b += modes.shapes[j]![r]! * force[j]!;
    const wr = modes.omega[r]!;
    const zr = zetas[r]!;
    const dRe = wr * wr - w * w;
    const dIm = 2 * zr * wr * w;
    const d = dRe * dRe + dIm * dIm;
    const fRe = (b * dRe) / d;
    const fIm = (-b * dIm) / d;
    for (let i = 0; i < n; i += 1) {
      const phi = modes.shapes[i]![r]!;
      re[i] = re[i]! + phi * fRe;
      im[i] = im[i]! + phi * fIm;
    }
  }
  return { re, im };
}

export interface MdofFrf {
  w: number[];
  /** 20*log10|X_drive| for a unit force at the drive DOF (dB). */
  magDb: number[];
  /** Phase lag of the drive-point response (degrees, 0..360 wrapping to [0,180]). */
  phaseLagDeg: number[];
}

/** Drive-point FRF (unit force at `driveDof`, response at the same DOF), full modal superposition. */
export function mdofDriveFrf(modes: MdofModes, zetas: number[], driveDof: number, wLo: number, wHi: number, n = 600): MdofFrf {
  if (!(driveDof >= 0 && driveDof < modes.n)) throw new VibrationError('driveDof out of range');
  const w = logspace(wLo, wHi, n);
  const force = new Array<number>(modes.n).fill(0);
  force[driveDof] = 1;
  const magDb: number[] = new Array(n);
  const phaseLagDeg: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const { re, im } = modalResponse(modes, zetas, force, w[i]!);
    const reD = re[driveDof]!;
    const imD = im[driveDof]!;
    magDb[i] = 20 * Math.log10(Math.hypot(reD, imD));
    // lag = -arg(X) mapped into [0, 360); a passive response never leads the
    // force, so any arg in (90, 180] degrees is numerical wrap-around.
    let theta = toDeg(Math.atan2(imD, reD));
    if (theta > 90) theta -= 360;
    phaseLagDeg[i] = Math.min(360, Math.max(0, -theta));
  }
  return { w, magDb, phaseLagDeg };
}

// ==========================================================================
// Transmissibility — base isolation
// ==========================================================================

/**
 * Absolute-transmissibility magnitude of a damped isolator at frequency ratio
 * r = w/wn: T(r) = sqrt((1+(2*zeta*r)^2) / ((1-r^2)^2+(2*zeta*r)^2)).
 * T(sqrt(2)) = 1 EXACTLY for every zeta; T > 1 below sqrt(2) (amplification)
 * and T < 1 above it (isolation).
 */
export function transmissibility(zeta: number, r: number): number {
  if (!(zeta >= 0)) throw new VibrationError('transmissibility zeta must be >= 0');
  const d = (1 - r * r) * (1 - r * r) + 4 * zeta * zeta * r * r;
  return Math.sqrt((1 + 4 * zeta * zeta * r * r) / d);
}

export interface TransPeak {
  /** Frequency ratio at the peak. */
  rPeak: number;
  /** Peak transmissibility (Infinity for zeta = 0). */
  tMax: number;
}

/**
 * Closed-form peak of T(r): differentiating T^2 in u = r^2 gives
 * 2*zeta^2*u^2 + u - 1 = 0, hence u* = (sqrt(1 + 8*zeta^2) - 1)/(4*zeta^2)
 * and r_peak = sqrt(u*) = sqrt(sqrt(1+8*zeta^2)-1)/(2*zeta) (just below 1).
 * For small zeta, T_max = 1/(2*zeta) * (1 + O(zeta^2)).
 */
export function transmissibilityPeak(zeta: number): TransPeak {
  if (!(zeta >= 0)) throw new VibrationError('transmissibility zeta must be >= 0');
  if (zeta === 0) return { rPeak: 1, tMax: Number.POSITIVE_INFINITY };
  const z2 = zeta * zeta;
  const u = (Math.sqrt(1 + 8 * z2) - 1) / (4 * z2);
  const t2 = (1 + 4 * z2 * u) / ((1 - u) * (1 - u) + 4 * z2 * u);
  return { rPeak: Math.sqrt(u), tMax: Math.sqrt(t2) };
}

export interface TransSweep {
  r: number[];
  /** Curves[c][i] = T(zetaList[c], r[i]). */
  curves: number[][];
}

/** Log-r sweep of transmissibility curves for a family of damping ratios. */
export function transmissibilitySweep(zetaList: number[], rLo = 0.1, rHi = 10, n = 500): TransSweep {
  if (zetaList.length === 0) throw new VibrationError('zetaList must not be empty');
  const r = logspace(rLo, rHi, n);
  const curves: number[][] = zetaList.map((z) => {
    if (!(z >= 0)) throw new VibrationError('transmissibility zeta must be >= 0');
    return r.map((ri) => transmissibility(z, ri));
  });
  return { r, curves };
}

// ==========================================================================
// Unbalance — rotating unbalance excitation
// ==========================================================================

export interface UnbalancePoint {
  r: number;
  /** Normalized amplitude m*X/(me*e) = r^2/sqrt((1-r^2)^2+(2*zeta*r)^2). */
  ampNorm: number;
  /** Phase lag of the displacement behind the unbalance force (degrees). */
  phaseLagDeg: number;
}

/**
 * Rotating-unbalance response of the SDOF (mass m, unbalance me*e at speed
 * w = r*wn): the normalized amplitude m*X/(me*e) = r^2/|1-r^2+2i*zeta*r| peaks
 * at r_peak = 1/sqrt(1-2*zeta^2) (zeta < 1/sqrt(2)) with peak value
 * 1/(2*zeta*sqrt(1-zeta^2)); at r = 1 the amplitude is EXACTLY 1/(2*zeta) and
 * the phase lag is EXACTLY 90 degrees (algebraic identities, valid for every
 * zeta > 0).
 */
export function unbalancePoint(zeta: number, r: number): UnbalancePoint {
  if (!(zeta > 0)) throw new VibrationError('unbalance zeta must be > 0');
  const d = (1 - r * r) * (1 - r * r) + 4 * zeta * zeta * r * r;
  return {
    r,
    ampNorm: (r * r) / Math.sqrt(d),
    phaseLagDeg: toDeg(Math.atan2(2 * zeta * r, 1 - r * r)),
  };
}

export interface UnbalancePeakCF {
  /** Frequency ratio at the peak, r_peak = 1/sqrt(1-2*zeta^2). */
  rPeak: number;
  /** Peak normalized amplitude, 1/(2*zeta*sqrt(1-zeta^2)). */
  ampPeak: number;
}

/**
 * Closed-form peak of the normalized unbalance amplitude: writing u = r^2 the
 * amplitude squared is u^2/(u^2 + (4*zeta^2-2)*u + 1), whose derivative
 * vanishes at u = 1/(1-2*zeta^2); hence r_peak = 1/sqrt(1-2*zeta^2) and
 * A_peak = 1/(2*zeta*sqrt(1-zeta^2)). Requires zeta < 1/sqrt(2) — above that
 * the amplitude grows monotonically and no interior peak exists.
 */
export function unbalancePeak(zeta: number): UnbalancePeakCF {
  if (!(zeta > 0)) throw new VibrationError('unbalance zeta must be > 0');
  const den = 1 - 2 * zeta * zeta;
  if (!(den > 0)) {
    throw new VibrationError('no interior unbalance peak for zeta >= 1/sqrt(2)');
  }
  return { rPeak: 1 / Math.sqrt(den), ampPeak: 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)) };
}

export interface UnbalanceSweep {
  r: number[];
  ampNorm: number[];
  phaseLagDeg: number[];
}

/** Log-r sweep of the normalized unbalance amplitude and phase. */
export function unbalanceSweep(zeta: number, n = 600, rLo = 0.05, rHi = 5): UnbalanceSweep {
  if (!(zeta > 0)) throw new VibrationError('unbalance zeta must be > 0');
  const r = logspace(rLo, rHi, n);
  const ampNorm: number[] = new Array(n);
  const phaseLagDeg: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const pt = unbalancePoint(zeta, r[i]!);
    ampNorm[i] = pt.ampNorm;
    phaseLagDeg[i] = pt.phaseLagDeg;
  }
  return { r, ampNorm, phaseLagDeg };
}

/**
 * Shaft orbit at frequency ratio r for an anisotropic rotor (ky/kx = kappa,
 * isotropic when 1). Per-direction normalized amplitudes from the unbalance
 * response (y-direction natural-frequency ratio kappa), the y-force component
 * lagging the x-force by 90 degrees:
 *   x = X cos(t - phi_x),  y = Y cos(t - pi/2 - phi_y),  t = w*t over one turn.
 * Amplitudes are in the normalized m*X/(me*e) scale; multiply by me*e/m for
 * physical metres. Returns n+1 samples closing the loop.
 */
export function unbalanceOrbit(zeta: number, r: number, kappa: number, n = 144): { x: number[]; y: number[] } {
  if (!(zeta > 0)) throw new VibrationError('unbalance zeta must be > 0');
  if (!(kappa > 0)) throw new VibrationError('orbit kappa must be > 0');
  if (!Number.isInteger(n) || n < 8) throw new VibrationError('orbit needs an integer n >= 8 samples');
  const dx = (1 - r * r) * (1 - r * r) + 4 * zeta * zeta * r * r;
  const dy = (kappa - r * r) * (kappa - r * r) + 4 * zeta * zeta * r * r;
  const X = (r * r) / Math.sqrt(dx);
  const Y = (r * r) / Math.sqrt(dy);
  const phiX = Math.atan2(2 * zeta * r, 1 - r * r);
  const phiY = Math.atan2(2 * zeta * r, kappa - r * r);
  const x: number[] = new Array(n + 1);
  const y: number[] = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    const tau = (2 * Math.PI * i) / n;
    x[i] = X * Math.cos(tau - phiX);
    y[i] = Y * Math.cos(tau - Math.PI / 2 - phiY);
  }
  return { x, y };
}
