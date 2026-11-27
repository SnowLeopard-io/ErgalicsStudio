// ==========================================================================
// eng-control kernel — time-domain / frequency-domain analysis of first- and
// second-order plants with optional PID control (unity feedback).
// Pure numeric core: no DOM, no plugin-framework imports; all complex
// arithmetic is implemented locally.
//
// Plant models (unity DC gain):
//   first order:   τ·ẏ + y = u
//   second order:  ÿ + 2ζωn·ẏ + ωn²·y = ωn²·u
// Controller (ideal PID on the error e = r − y, r = unit step):
//   u = Kp·e + Ki·∫e dt + Kd·ė
// For the first-order plant the D-term creates an algebraic loop
// (ė = −ẏ = −(u − y)/τ) which is resolved in closed form:
//   u = [τ·Kp·(1 − y) + τ·Ki·xi + Kd·y] / (τ + Kd).
//
// Time domain: fixed-step RK4 integration of the (explicit) state-space
// system; metrics are overshoot σ% (vs. the DC final value), peak time,
// 2 %-band settling time (last exit of |y − y∞| ≤ 0.02·|y∞|) and the
// steady-state error at the end of the horizon.
//
// Frequency domain: direct evaluation at s = jω. Plant Bode:
//   |G| = 1/√(1+(ωτ)²)  or  ωn²/√((ωn²−ω²)² + (2ζωnω)²)
// Closed loop T = C·G/(1 + C·G) with C(jω) = Kp + j(ωKd − Ki/ω), used for
// the −3 dB bandwidth (relative to the DC value of |T|).
//
// References: standard undergraduate control texts, e.g. G. F. Franklin,
// J. D. Powell, A. Emami-Naeini, "Feedback Control of Dynamic Systems"
// (step-response formulas; ω_b = ωn·√(1−2ζ²+√(4ζ⁴−4ζ²+2)) for the
// second-order −3 dB bandwidth); RK4 per J. Stoer & R. Bulirsch,
// "Introduction to Numerical Analysis".
// ==========================================================================

export type SystemType = 'first' | 'second';

export interface ControlParams {
  type: SystemType;
  /** First-order time constant (s). */
  tau: number;
  /** Second-order natural frequency (rad/s). */
  wn: number;
  /** Second-order damping ratio. */
  zeta: number;
  /** PID proportional gain (0 = off). */
  kp: number;
  /** PID integral gain (0 = off). */
  ki: number;
  /** PID derivative gain (0 = off). */
  kd: number;
  /** Simulation horizon (s). */
  tEnd: number;
  /** RK4 fixed step (s). */
  dt: number;
}

export interface StepMetrics {
  /** σ% relative to the DC final value; NaN when undefined (e.g. y∞ = 0). */
  overshootPct: number;
  /** Time of the first maximum (s); NaN when there is no overshoot. */
  peakTime: number;
  /** 2 %-band settling time (s); NaN when undefined, Infinity when never settled. */
  settlingTime: number;
  /** |y(∞) − y(tEnd)| at the end of the horizon. */
  ess: number;
}

export interface StepSim {
  t: number[];
  y: number[];
  metrics: StepMetrics;
  /** DC gain of the simulated loop (plant, or closed loop with PID). */
  dcGain: number;
}

export interface BodePoint {
  /** Frequency (rad/s). */
  w: number;
  /** 20·log10|H| (dB). */
  magDb: number;
  /** arg H (degrees). */
  phaseDeg: number;
}

/** Raised for invalid parameters or solver limits. */
export class ControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlError';
  }
}

const MAX_STEPS = 400_000;

// ---- validation ------------------------------------------------------------

export function validateParams(p: ControlParams): void {
  if (!(p.tau > 0)) throw new ControlError('tau must be > 0 s');
  if (!(p.wn > 0)) throw new ControlError('wn must be > 0 rad/s');
  if (!(p.zeta >= 0)) throw new ControlError('zeta must be ≥ 0');
  if (!(p.tEnd > 0)) throw new ControlError('tEnd must be > 0 s');
  if (!(p.dt > 0)) throw new ControlError('dt must be > 0 s');
  if (Math.round(p.tEnd / p.dt) > MAX_STEPS) {
    throw new ControlError(`tEnd/dt exceeds ${MAX_STEPS} RK4 steps — increase dt or shorten tEnd`);
  }
  for (const g of [p.kp, p.ki, p.kd]) {
    if (!Number.isFinite(g) || g < 0) throw new ControlError('PID gains must be finite and ≥ 0');
  }
}

/** DC gain of the simulated loop: open-loop plant = 1; with PID, 1 when Ki > 0, Kp/(1+Kp) for P-only, 0 for D-only. */
export function dcGain(p: ControlParams): number {
  const pidActive = p.kp > 0 || p.ki > 0 || p.kd > 0;
  if (!pidActive) return 1; // both plant forms have unity DC gain
  if (p.ki > 0) return 1; // integral action → zero steady-state error
  if (p.kp > 0) return p.kp / (1 + p.kp); // P-only, unity-feedback loop gain at DC
  return 0; // D-only: no DC path through the controller
}

// ---- state-space derivatives ----------------------------------------------

/** Writes the state derivative into `out` (allocation-free for RK4). */
type Deriv = (s: number[], out: number[]) => void;

interface Plant {
  nState: number;
  f: Deriv;
}

function makePlant(p: ControlParams): Plant {
  const pidActive = p.kp > 0 || p.ki > 0 || p.kd > 0;
  if (p.type === 'first') {
    if (!pidActive) {
      // τ·ẏ = 1 − y, state [y]
      return {
        nState: 1,
        f: (s, out) => {
          out[0] = (1 - s[0]!) / p.tau;
        },
      };
    }
    // state [y, xi]; u resolved from the algebraic D-loop (see header).
    return {
      nState: 2,
      f: (s, out) => {
        const y = s[0]!;
        const u = (p.tau * p.kp * (1 - y) + p.tau * p.ki * s[1]! + p.kd * y) / (p.tau + p.kd);
        out[0] = (u - y) / p.tau;
        out[1] = 1 - y;
      },
    };
  }
  if (!pidActive) {
    // state [y, ẏ]
    return {
      nState: 2,
      f: (s, out) => {
        out[0] = s[1]!;
        out[1] = p.wn * p.wn * (1 - s[0]!) - 2 * p.zeta * p.wn * s[1]!;
      },
    };
  }
  // state [y, ẏ, xi]; u = Kp·e + Ki·xi − Kd·ẏ (explicit, no loop)
  return {
    nState: 3,
    f: (s, out) => {
      const y = s[0]!;
      const yd = s[1]!;
      const u = p.kp * (1 - y) + p.ki * s[2]! - p.kd * yd;
      out[0] = yd;
      out[1] = p.wn * p.wn * (u - y) - 2 * p.zeta * p.wn * yd;
      out[2] = 1 - y;
    },
  };
}

// ---- RK4 step response -----------------------------------------------------

/** Simulate the unit-step response with fixed-step RK4 and extract the metrics. */
export function simulateStep(p: ControlParams): StepSim {
  validateParams(p);
  const plant = makePlant(p);
  const nSteps = Math.round(p.tEnd / p.dt);
  const dt = p.tEnd / nSteps;

  const t: number[] = new Array(nSteps + 1);
  const y: number[] = new Array(nSteps + 1);
  let s = new Array<number>(plant.nState).fill(0);
  t[0] = 0;
  y[0] = 0;

  const k1 = new Array<number>(plant.nState);
  const k2 = new Array<number>(plant.nState);
  const k3 = new Array<number>(plant.nState);
  const k4 = new Array<number>(plant.nState);
  const tmp = new Array<number>(plant.nState);

  for (let i = 1; i <= nSteps; i += 1) {
    // Classic RK4 on the explicit state-space system.
    plant.f(s, k1);
    for (let j = 0; j < plant.nState; j += 1) tmp[j] = s[j]! + (dt / 2) * k1[j]!;
    plant.f(tmp, k2);
    for (let j = 0; j < plant.nState; j += 1) tmp[j] = s[j]! + (dt / 2) * k2[j]!;
    plant.f(tmp, k3);
    for (let j = 0; j < plant.nState; j += 1) tmp[j] = s[j]! + dt * k3[j]!;
    plant.f(tmp, k4);
    const sNext = new Array<number>(plant.nState);
    for (let j = 0; j < plant.nState; j += 1) {
      sNext[j] = s[j]! + (dt / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!);
    }
    s = sNext;
    t[i] = i * dt;
    y[i] = s[0]!;
  }

  const ydc = dcGain(p);
  const metrics = extractMetrics(t, y, ydc);
  return { t, y, metrics, dcGain: ydc };
}

/** Metric extraction shared by the simulator and the analytic reference. */
export function extractMetrics(t: number[], y: number[], ydc: number): StepMetrics {
  // Steady-state error is defined against the unit-step reference r = 1
  // (so a P-only loop with y∞ = Kp/(1+Kp) correctly reports e_ss = 1/(1+Kp)).
  const ess = Math.abs(1 - y[y.length - 1]!);
  if (ydc <= 0) {
    // Overshoot/settling around a zero final value are ill-defined.
    return { overshootPct: Number.NaN, peakTime: Number.NaN, settlingTime: Number.NaN, ess };
  }
  let maxY = -Infinity;
  let peakIdx = 0;
  for (let i = 0; i < y.length; i += 1) {
    if (y[i]! > maxY) {
      maxY = y[i]!;
      peakIdx = i;
    }
  }
  const overshoot = maxY - ydc;
  const overshootPct = overshoot > Math.abs(ydc) * 1e-12 ? (overshoot / ydc) * 100 : 0;
  const peakTime = overshootPct > 0 ? t[peakIdx]! : Number.NaN;
  const band = 0.02 * Math.abs(ydc);
  let lastOutside = -1;
  for (let i = y.length - 1; i >= 0; i -= 1) {
    if (Math.abs(y[i]! - ydc) > band) {
      lastOutside = i;
      break;
    }
  }
  const settlingTime = lastOutside < 0 ? 0 : lastOutside + 1 < t.length ? t[lastOutside + 1]! : Number.POSITIVE_INFINITY;
  return { overshootPct, peakTime, settlingTime, ess };
}

// ---- analytic references ---------------------------------------------------

/** Closed-form unit-step response of the second-order plant (any ζ). */
export function analyticSecondOrderStep(wn: number, zeta: number, t: number): number {
  if (t <= 0) return 0;
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * wn * t);
    return 1 - env * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-wn * t) * (1 + wn * t);
  }
  const wd = wn * Math.sqrt(zeta * zeta - 1);
  const env = Math.exp(-zeta * wn * t);
  return 1 - env * (Math.cosh(wd * t) + (zeta / Math.sqrt(zeta * zeta - 1)) * Math.sinh(wd * t));
}

/** Analytic overshoot σ% = 100·exp(−ζπ/√(1−ζ²)); 0 for ζ ≥ 1. */
export function analyticOvershootPct(zeta: number): number {
  if (zeta <= 0 || zeta >= 1) return zeta === 0 ? 100 : 0;
  return 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

/** Analytic peak time tp = π/(ωn·√(1−ζ²)); NaN for ζ ≥ 1. */
export function analyticPeakTime(wn: number, zeta: number): number {
  if (zeta <= 0 || zeta >= 1) return Number.NaN;
  return Math.PI / (wn * Math.sqrt(1 - zeta * zeta));
}

/**
 * Exact 2 %-band settling time of the analytic second-order step response:
 * the last time |y(t) − 1| = 0.02, located on a coarse grid and refined by
 * bisection. (The textbook value 4/(ζωn) is only an envelope approximation —
 * for e.g. ζ = 0.3 the true value is ~19 % smaller.)
 */
export function analyticSettlingTimeExact(wn: number, zeta: number, band = 0.02): number {
  const g = (t: number): number => Math.abs(analyticSecondOrderStep(wn, zeta, t) - 1) - band;
  const tEnv = (Math.log(1 / band) + 2) / (Math.max(zeta, 1e-6) * wn); // envelope decay + margin
  const tPeriod = zeta < 1 ? (2 * Math.PI) / (wn * Math.sqrt(1 - zeta * zeta)) : 4 / wn;
  const tScan = Math.min(Math.max(tEnv + 2 * tPeriod, 10 / wn), 5e4);
  const n = 4000;
  const h = tScan / n;
  // Locate the LAST grid sample still outside the band: the crossing into
  // the band right after it is the settling time (the response never
  // leaves the band again).
  let lastOutside = -1;
  for (let i = 0; i <= n; i += 1) {
    if (g(i * h) > 0) lastOutside = i;
  }
  if (lastOutside < 0) return 0; // never leaves the band
  if (lastOutside === n) return Number.POSITIVE_INFINITY; // still outside at scan end
  let lo = lastOutside * h; // g > 0
  let hi = (lastOutside + 1) * h; // g ≤ 0
  for (let k = 0; k < 80; k += 1) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact 2 %-band settling time of the first-order step response (monotonic): τ·ln(1/band). */
export function analyticFirstOrderSettlingTime(tau: number, band = 0.02): number {
  return -tau * Math.log(band);
}

/** Textbook envelope approximations, for coarse screens only. */
export function textbookSettlingTime2pct(wn: number, zeta: number): number {
  return 4 / (zeta * wn);
}

// ---- complex arithmetic (self-implemented) ---------------------------------

interface Cx {
  re: number;
  im: number;
}

function cAbs(z: Cx): number {
  return Math.hypot(z.re, z.im);
}

function cArgDeg(z: Cx): number {
  return (Math.atan2(z.im, z.re) * 180) / Math.PI;
}

function cDiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function cMul(a: Cx, b: Cx): Cx {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** Plant transfer function G(jω) (self-implemented complex arithmetic). */
export function plantG(p: ControlParams, w: number): Cx {
  if (p.type === 'first') {
    return cDiv({ re: 1, im: 0 }, { re: 1, im: w * p.tau });
  }
  return cDiv(
    { re: p.wn * p.wn, im: 0 },
    { re: p.wn * p.wn - w * w, im: 2 * p.zeta * p.wn * w },
  );
}

/** Open-loop plant Bode point G(jω). */
export function plantBode(p: ControlParams, w: number): BodePoint {
  const G = plantG(p, w);
  return { w, magDb: 20 * Math.log10(cAbs(G)), phaseDeg: cArgDeg(G) };
}

/** Ideal PID controller C(jω) = Kp + j(ωKd − Ki/ω) at s = jω (ω > 0). */
function controllerC(p: ControlParams, w: number): Cx {
  return { re: p.kp, im: w * p.kd - p.ki / w };
}

/** Closed-loop Bode point T = C·G/(1 + C·G) at s = jω (unity feedback). */
export function closedLoopBode(p: ControlParams, w: number): BodePoint {
  const pidActive = p.kp > 0 || p.ki > 0 || p.kd > 0;
  if (!pidActive) return plantBode(p, w); // T = G when the controller is off
  const G = plantG(p, w);
  const C = controllerC(p, w);
  const L = cMul(C, G);
  const T = cDiv(L, { re: 1 + L.re, im: L.im });
  return { w, magDb: 20 * Math.log10(cAbs(T)), phaseDeg: cArgDeg(T) };
}

/**
 * Log-spaced Bode sweep of the closed loop T(jω) (equal to the plant when
 * all PID gains are zero). `n` points from 0.01·ωc to 1000·ωc.
 */
export function bodeSweep(p: ControlParams, n = 400): BodePoint[] {
  validateParams(p);
  const wc = p.type === 'first' ? 1 / p.tau : p.wn;
  const lo = 0.01 * wc;
  const hi = 1000 * wc;
  const pts: BodePoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const w = lo * Math.pow(hi / lo, i / (n - 1));
    pts.push(closedLoopBode(p, w));
  }
  return pts;
}

/**
 * Closed-loop −3 dB (half-power) bandwidth: first frequency where
 * 20·log10|T| falls 10·log10(2) ≈ 3.0103 dB below its DC value, i.e. the
 * classic half-power point |T|² = |T(0)|²/2. This is the definition behind
 * the analytic Franklin ω_b, and for a unity-DC first-order low-pass it
 * lands exactly on ω = 1/τ. Interpolated between sweep samples.
 * Returns Infinity when no crossing occurs inside the swept range and NaN
 * when the DC gain is non-positive (no meaningful bandwidth).
 */
export function closedLoopBandwidth(p: ControlParams): number {
  const ydc = dcGain(p);
  if (ydc <= 0) return Number.NaN;
  const dcDb = 20 * Math.log10(ydc);
  // Denser-than-plot sweep: linear interpolation error scales as h², and the
  // bandwidth is used as a numeric benchmark (< 1e-3 rel. err vs. analytic).
  const pts = bodeSweep(p, 1600);
  const threshold = dcDb - 10 * Math.log10(2);
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (!Number.isFinite(a.magDb) || !Number.isFinite(b.magDb)) continue;
    if (b.magDb < threshold) {
      // Linear interpolation of magDb in log ω.
      const f = (threshold - a.magDb) / (b.magDb - a.magDb);
      const logW = Math.log(a.w) + f * (Math.log(b.w) - Math.log(a.w));
      return Math.exp(logW);
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Analytic −3 dB bandwidth of the second-order plant (Franklin et al.). */
export function analyticSecondOrderBandwidth(wn: number, zeta: number): number {
  const inner = 4 * zeta ** 4 - 4 * zeta * zeta + 2;
  return wn * Math.sqrt(1 - 2 * zeta * zeta + Math.sqrt(inner));
}
