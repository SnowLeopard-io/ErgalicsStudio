// ==========================================================================
// eng-fluid kernel — fluid mechanics numeric core (pure functions).
//
// Modules:
//   pipeflow   — Darcy–Weisbach pipe metrics: Reynolds number, flow-regime
//                classification (laminar < 2300, transitional, turbulent
//                > 4000), laminar friction 64/Re (analytic) and turbulent
//                Colebrook–White (implicit, solved by fixed-point iteration),
//                plus the explicit Haaland correlation used as cross-check.
//   bernoulli  — Bernoulli + continuity along a Venturi-style variable-area
//                duct: ideal pressure/velocity distributions for plotting.
//   blasius    — flat-plate laminar boundary layer: Blasius similarity ODE
//                f''' + (1/2)·f·f'' = 0 integrated with RK4 and a secant
//                shooting method on f''(0) (converges to 0.3320573…),
//                yielding δ99/x ≈ 5.0/√Re_x, δ*/x = 1.7208/√Re_x and the
//                local skin-friction Cf = 0.664/√Re_x; turbulent 1/7-power
//                law empirical comparison.
//   cylinder   — Rankine potential flow past a circular cylinder with
//                circulation Γ: surface Cp distribution, Kutta–Joukowski
//                lift L' = ρUΓ, ideal Cd = 0 (d'Alembert) contrasted with
//                an empirical real-fluid Cd(Re) reference.
//   lbm3d      — D3Q19 lattice-Boltzmann (BGK) square/rectangular straight
//                duct Poiseuille flow in lattice units: Zou/He velocity
//                inlet, extrapolation outflow, half-way bounce-back walls.
//                Float32Array CPU implementation, fully deterministic (no
//                RNG, no wall clock). The analytic reference is the exact
//                double-Fourier-series solution of the rectangular duct.
//
// References: F. M. White, "Fluid Mechanics" (Darcy–Weisbach, Moody chart,
// Blasius solution, potential flow); C. F. Colebrook (1939) and S. E.
// Haaland (1983) friction correlations as reproduced in White ch. 6;
// R. K. Shah & A. L. London, "Laminar Flow Forced Convection in Ducts" for
// the rectangular-duct series; Q. Zou & X. He (1997) for the velocity
// boundary condition; M. C. Sukop & D. T. Thorne, "Lattice Boltzmann
// Modeling" (D3Q19 BGK, half-way bounce-back).
// ==========================================================================

// ==========================================================================
// Shared error type
// ==========================================================================

/** Raised for invalid parameters or solver limits. */
export class FluidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluidError';
  }
}

// ==========================================================================
// Module 1: pipeflow — Darcy–Weisbach with laminar / Colebrook–White f
// ==========================================================================

/** Flow regime bands: laminar < 2300, transitional 2300–4000, turbulent > 4000. */
export type FlowRegime = 'laminar' | 'transitional' | 'turbulent';

export const RE_LAMINAR_MAX = 2300;
export const RE_TURBULENT_MIN = 4000;

export interface PipeFlowParams {
  /** Mean velocity (m/s). */
  u: number;
  /** Pipe diameter (m). */
  d: number;
  /** Density (kg/m³). */
  rho: number;
  /** Kinematic viscosity (m²/s). */
  nu: number;
  /** Pipe length (m). */
  length: number;
  /** Relative roughness ε/d (dimensionless, ≥ 0). */
  relRough: number;
}

export interface PipeFlowResult {
  re: number;
  regime: FlowRegime;
  /** Darcy friction factor. */
  f: number;
  /** Wall shear stress τw = f·ρu²/8 (Pa). */
  tauW: number;
  /** Pressure drop Δp = f·(L/d)·ρu²/2 (Pa). */
  dp: number;
  /** Head loss h_f = f·(L/d)·u²/(2g) (m). */
  headLoss: number;
  /** Pumping power = Δp·Q (W). */
  power: number;
}

export function validatePipeFlow(p: PipeFlowParams): void {
  if (!(p.u > 0)) throw new FluidError('u must be > 0 m/s');
  if (!(p.d > 0)) throw new FluidError('d must be > 0 m');
  if (!(p.rho > 0)) throw new FluidError('rho must be > 0 kg/m3');
  if (!(p.nu > 0)) throw new FluidError('nu must be > 0 m2/s');
  if (!(p.length > 0)) throw new FluidError('length must be > 0 m');
  if (!(p.relRough >= 0)) throw new FluidError('relRough must be >= 0');
}

/** Reynolds number Re = u·d/ν. */
export function reynoldsNumber(u: number, d: number, nu: number): number {
  return (u * d) / nu;
}

/** Flow-regime classification (fixed thresholds, see module header). */
export function classifyRegime(re: number): FlowRegime {
  if (re < RE_LAMINAR_MAX) return 'laminar';
  if (re <= RE_TURBULENT_MIN) return 'transitional';
  return 'turbulent';
}

/** Laminar (Hagen–Poiseuille) Darcy friction factor f = 64/Re (analytic). */
export function laminarFriction(re: number): number {
  return 64 / re;
}

/**
 * Explicit Haaland (1983) correlation — the cross-check reference for the
 * iterative Colebrook solver (published accuracy envelope ≈ 1.4 % vs
 * Colebrook, so it is used as an initial guess / sanity bound, never as the
 * accuracy standard).
 */
export function haalandFriction(re: number, relRough: number): number {
  const term = Math.pow(relRough / 3.7, 1.11) + 6.9 / re;
  const inv = -1.8 * Math.log10(term);
  return 1 / (inv * inv);
}

/**
 * Turbulent Colebrook–White equation, solved by fixed-point iteration on
 *  f = 1 / [ −2·log10( ε/(3.7·d) + 2.51/(Re·√f) ) ]²
 * started from Haaland; converges quadratically near the root. Returns the
 * converged Darcy friction factor for Re > 0 (valid in the turbulent regime).
 */
export function colebrookFriction(re: number, relRough: number): number {
  if (re <= 0) throw new FluidError('Re must be > 0 for Colebrook');
  let f = haalandFriction(re, relRough);
  for (let k = 0; k < 80; k += 1) {
    const sqrtF = Math.sqrt(f);
    const rhs = -2 * Math.log10(relRough / 3.7 + 2.51 / (re * sqrtF));
    const fNext = 1 / (rhs * rhs);
    if (Math.abs(fNext - f) <= 1e-13 * f) {
      return fNext;
    }
    f = fNext;
  }
  return f;
}

/**
 * Darcy friction factor across the whole Re range: analytic 64/Re in the
 * laminar branch, Colebrook–White for Re ≥ 4000, and a smooth log-Re
 * interpolation of 1/√f across the transitional band 2300–4000 (the book
 * convention for the Moody chart; the physics of transitional flow has no
 * single algebraic law).
 */
export function darcyFrictionFactor(re: number, relRough: number): number {
  if (re <= 0) throw new FluidError('Re must be > 0');
  if (re <= RE_LAMINAR_MAX) return laminarFriction(re);
  const fTurbHi = colebrookFriction(RE_TURBULENT_MIN, relRough);
  if (re >= RE_TURBULENT_MIN) return colebrookFriction(re, relRough);
  // Transitional band: interpolate 1/√f linearly in log10(Re).
  const invLam = Math.sqrt(laminarFriction(RE_LAMINAR_MAX));
  const invTurb = Math.sqrt(fTurbHi);
  const t = (Math.log10(re) - Math.log10(RE_LAMINAR_MAX)) / (Math.log10(RE_TURBULENT_MIN) - Math.log10(RE_LAMINAR_MAX));
  const inv = invLam + t * (invTurb - invLam);
  return 1 / (inv * inv);
}

/** Full Darcy–Weisbach metric set for one operating point. */
export function pipeFlowMetrics(p: PipeFlowParams): PipeFlowResult {
  validatePipeFlow(p);
  const re = reynoldsNumber(p.u, p.d, p.nu);
  const regime = classifyRegime(re);
  const f = regime === 'laminar' ? laminarFriction(re) : darcyFrictionFactor(re, p.relRough);
  const dyn = 0.5 * p.rho * p.u * p.u;
  const dp = f * (p.length / p.d) * dyn;
  const area = (Math.PI / 4) * p.d * p.d;
  return {
    re,
    regime,
    f,
    tauW: (f * dyn) / 4,
    dp,
    headLoss: dp / (p.rho * 9.80665),
    power: dp * p.u * area,
  };
}

export interface MoodyPoint {
  re: number;
  f: number;
}

export interface MoodyCurve {
  relRough: number;
  points: MoodyPoint[];
}

/**
 * Moody-chart data generator: one f(Re) curve per relative roughness, swept
 * log-spaced over [reMin, reMax] (clamped to sensible bounds 1e2…1e8).
 * Deterministic; uses darcyFrictionFactor so the laminar line and the
 * transitional interpolation are consistent with the operating point.
 */
export function moodyCurves(relRoughs: number[], reMin = 1e2, reMax = 1e8, n = 140): MoodyCurve[] {
  const lo = Math.max(1e2, reMin);
  const hi = Math.min(1e8, reMax);
  if (!(hi > lo)) throw new FluidError('moodyCurves: reMax must exceed reMin');
  const curves: MoodyCurve[] = [];
  for (const eps of relRoughs) {
    if (eps < 0) throw new FluidError('relative roughness must be >= 0');
    const points: MoodyPoint[] = [];
    for (let i = 0; i < n; i += 1) {
      const re = lo * Math.pow(hi / lo, i / (n - 1));
      points.push({ re, f: darcyFrictionFactor(re, eps) });
    }
    curves.push({ relRough: eps, points });
  }
  return curves;
}

// ==========================================================================
// Module 2: bernoulli — variable-area duct (Venturi) pressure/velocity data
// ==========================================================================

export interface BernoulliParams {
  /** Volumetric flow rate (m³/s). */
  q: number;
  /** Density (kg/m³). */
  rho: number;
  /** Inlet / throat / outlet diameters (m). */
  dInlet: number;
  dThroat: number;
  dOutlet: number;
  /** Axial lengths of the converging cone, throat and diffuser (m). */
  lConverge: number;
  lThroat: number;
  lDiffuse: number;
  /** Kinematic viscosity (m²/s) for the Reynolds readout. */
  nu: number;
  /** Number of sample stations along the axis. */
  n: number;
}

export interface BernoulliPoint {
  /** Axial position (m). */
  x: number;
  /** Local diameter (m). */
  d: number;
  /** Local cross-section area (m²). */
  area: number;
  /** Mean velocity u = Q/A (m/s). */
  u: number;
  /** Static gauge pressure p = p_inlet + ½ρ(u_inlet² − u²) (Pa). */
  p: number;
  /** Reynolds number based on local diameter. */
  re: number;
}

export interface BernoulliResult {
  points: BernoulliPoint[];
  /** Inlet reference velocity (m/s). */
  uInlet: number;
  /** Static pressure drop inlet → throat (Pa), negative when accelerating. */
  dpThroat: number;
  /** Inlet Reynolds number. */
  reInlet: number;
}

export function validateBernoulli(p: BernoulliParams): void {
  if (!(p.q > 0)) throw new FluidError('q must be > 0 m3/s');
  if (!(p.rho > 0)) throw new FluidError('rho must be > 0 kg/m3');
  if (!(p.nu > 0)) throw new FluidError('nu must be > 0 m2/s');
  if (!(p.dInlet > 0) || !(p.dThroat > 0) || !(p.dOutlet > 0)) throw new FluidError('diameters must be > 0 m');
  if (!(p.lConverge >= 0) || !(p.lThroat > 0) || !(p.lDiffuse >= 0)) throw new FluidError('section lengths invalid');
  if (!(p.n >= 8)) throw new FluidError('n must be >= 8 stations');
}

/**
 * Piecewise-linear diameter profile: dInlet → dThroat over the converging
 * cone, constant through the throat, dThroat → dOutlet over the diffuser.
 */
function venturiDiameter(p: BernoulliParams, x: number): number {
  const xc = p.lConverge;
  const xt = xc + p.lThroat;
  if (x <= xc) return p.lConverge > 0 ? p.dInlet + ((p.dThroat - p.dInlet) * x) / p.lConverge : p.dThroat;
  if (x <= xt) return p.dThroat;
  if (p.lDiffuse > 0) return p.dThroat + ((p.dOutlet - p.dThroat) * (x - xt)) / p.lDiffuse;
  return p.dOutlet;
}

/**
 * Bernoulli + continuity along the Venturi: u(x) = Q/A(x) and the ideal
 * static pressure p(x) = p_in + ½ρ(u_in² − u²) (inviscid, no losses — the
 * classical Venturi benchmark). Pressure is reported relative to the inlet
 * static pressure (gauge), which is zero at x = 0.
 */
export function bernoulliProfile(p: BernoulliParams): BernoulliResult {
  validateBernoulli(p);
  const n = Math.round(p.n);
  const lTotal = p.lConverge + p.lThroat + p.lDiffuse;
  const aIn = (Math.PI / 4) * p.dInlet * p.dInlet;
  const uIn = p.q / aIn;
  const points: BernoulliPoint[] = [];
  let pThroat = 0;
  let throatSeen = false;
  for (let i = 0; i <= n; i += 1) {
    const x = (lTotal * i) / n;
    const d = venturiDiameter(p, x);
    const area = (Math.PI / 4) * d * d;
    const u = p.q / area;
    const pGauge = 0.5 * p.rho * (uIn * uIn - u * u);
    if (!throatSeen && d === p.dThroat && x >= p.lConverge && i > 0) {
      pThroat = pGauge;
      throatSeen = true;
    }
    points.push({ x, d, area, u, p: pGauge, re: reynoldsNumber(u, d, p.nu) });
  }
  return { points, uInlet: uIn, dpThroat: pThroat, reInlet: reynoldsNumber(uIn, p.dInlet, p.nu) };
}

// ==========================================================================
// Module 3: blasius — flat-plate laminar boundary layer (similarity ODE)
// ==========================================================================

/**
 * Blasius similarity ODE in the Prandtl convention:
 *   f''' + (1/2)·f·f'' = 0,  f(0)=0, f'(0)=0, f'(∞)=1.
 * The stream function is ψ = √(ν·U·x)·f(η), η = y·√(U/(ν·x)).
 * Solved as the first-order system f'=g, g'=h, h'=−½·f·h with RK4 and a
 * secant shooting method on the wall curvature h(0) = f''(0); the converged
 * value is f''(0) ≈ 0.3320573362 (textbook 0.332).
 */
export interface BlasiusSolution {
  /** Similarity coordinate grid. */
  eta: number[];
  /** f(η) — scaled stream function. */
  f: number[];
  /** f'(η) = u/U — the velocity profile. */
  fp: number[];
  /** Converged wall curvature f''(0). */
  fpp0: number;
  /** η where f' = 0.99 (so δ99/x = η99/√Re_x). */
  eta99: number;
  /** η∞ − f(η∞) — gives the displacement thickness δ* / x = 1.7208/√Re_x. */
  deltaStarEta: number;
  /** Number of secant iterations used by the shooting method. */
  iterations: number;
}

const BLASIUS_ETA_MAX = 10;
const BLASIUS_H = 0.005;

/** One RK4 march of the Blasius system for a given wall-curvature guess. */
function blasiusMarch(s0: number): { fp: number[]; f: number[]; eta: number[]; fpEnd: number } {
  const n = Math.round(BLASIUS_ETA_MAX / BLASIUS_H);
  const h = BLASIUS_ETA_MAX / n;
  const eta: number[] = new Array(n + 1);
  const f: number[] = new Array(n + 1);
  const fp: number[] = new Array(n + 1);
  let s = [0, 0, s0]; // [f, f', f'']
  eta[0] = 0;
  f[0] = 0;
  fp[0] = 0;
  const deriv = (st: number[], out: number[]): void => {
    out[0] = st[1]!;
    out[1] = st[2]!;
    out[2] = -0.5 * st[0]! * st[2]!;
  };
  const k1 = [0, 0, 0];
  const k2 = [0, 0, 0];
  const k3 = [0, 0, 0];
  const k4 = [0, 0, 0];
  const tmp = [0, 0, 0];
  for (let i = 1; i <= n; i += 1) {
    deriv(s, k1);
    for (let j = 0; j < 3; j += 1) tmp[j] = s[j]! + (h / 2) * k1[j]!;
    deriv(tmp, k2);
    for (let j = 0; j < 3; j += 1) tmp[j] = s[j]! + (h / 2) * k2[j]!;
    deriv(tmp, k3);
    for (let j = 0; j < 3; j += 1) tmp[j] = s[j]! + h * k3[j]!;
    deriv(tmp, k4);
    const next = [0, 0, 0];
    for (let j = 0; j < 3; j += 1) next[j] = s[j]! + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!);
    s = next;
    eta[i] = i * h;
    f[i] = s[0]!;
    fp[i] = s[1]!;
  }
  return { fp, f, eta, fpEnd: s[1]! };
}

/** Shooting solution of the Blasius boundary-value problem (secant on f''(0)). */
export function blasiusSolve(): BlasiusSolution {
  let s0 = 0.332;
  let s1 = 0.34;
  const m0 = blasiusMarch(s0);
  let m1 = blasiusMarch(s1);
  let g0 = m0.fpEnd - 1;
  let g1 = m1.fpEnd - 1;
  let it = 2;
  // Secant iteration until f'(ηmax) = 1 to machine precision.
  while (Math.abs(g1) > 1e-12 && it < 40) {
    const s2 = s1 - (g1 * (s1 - s0)) / (g1 - g0);
    s0 = s1;
    g0 = g1;
    s1 = s2;
    m1 = blasiusMarch(s1);
    g1 = m1.fpEnd - 1;
    it += 1;
  }
  const best = Math.abs(g1) <= Math.abs(g0) ? m1 : m0;
  // δ99: first grid index where f' ≥ 0.99 (linear interpolation).
  let eta99 = Number.NaN;
  for (let i = 1; i < best.fp.length; i += 1) {
    if (best.fp[i]! >= 0.99) {
      const y0 = best.fp[i - 1]!;
      const y1 = best.fp[i]!;
      const t = y1 > y0 ? (0.99 - y0) / (y1 - y0) : 0;
      eta99 = best.eta[i - 1]! + t * BLASIUS_H;
      break;
    }
  }
  // δ* in η units: lim(η − f(η)); at η = 10 the remainder is < 1e-9.
  const n = best.eta.length - 1;
  const deltaStarEta = best.eta[n]! - best.f[n]!;
  return { eta: best.eta, f: best.f, fp: best.fp, fpp0: Math.abs(g1) <= Math.abs(g0) ? s1 : s0, eta99, deltaStarEta, iterations: it };
}

export interface BlasiusMetrics {
  /** δ99/x = η99/√Re_x (m). */
  delta99: number;
  /** Displacement thickness δ* per unit x = 1.7208/√Re_x (m). */
  deltaStar: number;
  /** Momentum thickness θ/x = 0.664/√Re_x (m). */
  theta: number;
  /** Local skin-friction coefficient Cf = 2·f''(0)/√Re_x. */
  cf: number;
  /** Wall shear stress τw = Cf·½ρU² (Pa). */
  tauW: number;
}

/** Boundary-layer thicknesses and skin friction at streamwise station Re_x. */
export function blasiusMetricsAtRe(sol: BlasiusSolution, reX: number, rho = 1, uRef = 1): BlasiusMetrics {
  if (!(reX > 0)) throw new FluidError('Re_x must be > 0');
  const sq = Math.sqrt(reX);
  // θ/x = ∫f'(1−f')dη/√Re_x = 2f''(0)/√Re_x (von Kármán momentum integral:
  // dθ/dx = Cf/2 with θ ∝ √x reproduces the same 0.664/√Re_x).
  const cf = (2 * sol.fpp0) / sq;
  return {
    delta99: sol.eta99 / sq,
    deltaStar: sol.deltaStarEta / sq,
    theta: cf,
    cf,
    tauW: cf * 0.5 * rho * uRef * uRef,
  };
}

/**
 * Empirical turbulent flat-plate reference (1/7-power-law family):
 * δ99 = 0.37·x·Re_x^(−1/5) and Cf = 0.0592·Re_x^(−1/5), valid for
 * 5·10⁵ ≲ Re_x ≲ 10⁷ (Schlichting / White). Returned in the same
 * per-unit-x normalisation as the Blasius metrics.
 */
export function turbulentFlatPlate(reX: number): { delta99: number; cf: number } {
  if (!(reX > 0)) throw new FluidError('Re_x must be > 0');
  const fifth = Math.pow(reX, -0.2);
  return { delta99: 0.37 * fifth, cf: 0.0592 * fifth };
}

/**
 * Turbulent 1/7-power-law velocity profile u/U = (y/δ)^(1/7), sampled on the
 * given y/δ stations — the qualitative contrast curve for the Blasius plot
 * (fuller profile, sharper near-wall gradient).
 */
export function powerLawProfile(yOverDelta: number[], exponent = 1 / 7): number[] {
  return yOverDelta.map((t) => Math.pow(Math.max(t, 0), exponent));
}

// ==========================================================================
// Module 4: cylinder — Rankine potential flow with circulation
// ==========================================================================

/**
 * Tangential surface velocity of the spinning-cylinder (Rankine) solution,
 * normalised by U:  v_θ/U = −(2·sinθ + Γ/(2π·a·U)).
 * θ = 0 is the downstream axis; circulation Γ > 0 (counterclockwise) shifts
 * the stagnation points downward and produces lift.
 */
export function cylinderSurfaceVelocity(theta: number, gammaOver2PiAU: number): number {
  return -(2 * Math.sin(theta) + gammaOver2PiAU);
}

/**
 * Surface pressure coefficient Cp(θ) = 1 − (v_θ/U)² — for the ideal flow the
 * integrated pressure yields exactly the Kutta–Joukowski lift and zero drag
 * (d'Alembert's paradox).
 */
export function cylinderCp(theta: number, gammaOver2PiAU: number): number {
  const v = cylinderSurfaceVelocity(theta, gammaOver2PiAU);
  return 1 - v * v;
}

/** Kutta–Joukowski lift per unit span L' = ρ·U·Γ (N/m) and cl = L'/(½ρU²·2a). */
export function cylinderLift(rho: number, u: number, gamma: number, radius: number): { liftPerSpan: number; cl: number } {
  if (rho <= 0 || u <= 0 || radius <= 0) throw new FluidError('rho, U and radius must be > 0');
  const lift = rho * u * gamma;
  // Reference area per unit span is the projected chord c = 2a.
  const cl = lift / (0.5 * rho * u * u * 2 * radius);
  return { liftPerSpan: lift, cl };
}

/**
 * Ideal (potential-flow) drag coefficient: identically zero — d'Alembert's
 * paradox, the pedagogical contrast to the real curve below.
 */
export const IDEAL_CYLINDER_CD = 0;

/**
 * Empirical real-fluid Cd(Re) for a smooth circular cylinder — log-log
 * interpolation over the classical measured curve (Schlichting): the
 * low-Re decay, the subcritical plateau ≈ 1.0–1.2, the drag crisis between
 * Re ≈ 2·10⁵ and 5·10⁵, and the supercritical recovery. Order-of-magnitude
 * engineering reference (±10–20 %), not a correlation standard.
 */
const CYL_CD_TABLE: Array<[number, number]> = [
  [1, 10],
  [10, 2.8],
  [1e2, 1.45],
  [1e3, 1.0],
  [1e4, 1.1],
  [1e5, 1.2],
  [2e5, 1.15],
  [5e5, 0.35],
  [1e6, 0.4],
  [1e7, 0.7],
];

export function realCylinderCd(re: number): number {
  if (!(re > 0)) throw new FluidError('Re must be > 0');
  if (re <= CYL_CD_TABLE[0]![0]) {
    // Below the table: creeping-flow scaling Cd ≈ 10/Re (2-D cylinder,
    // logarithmically corrected — order of magnitude only).
    return 10 / re;
  }
  const last = CYL_CD_TABLE[CYL_CD_TABLE.length - 1]!;
  if (re >= last[0]) return last[1];
  for (let i = 1; i < CYL_CD_TABLE.length; i += 1) {
    const [re1, cd1] = CYL_CD_TABLE[i - 1]!;
    const [re2, cd2] = CYL_CD_TABLE[i]!;
    if (re <= re2) {
      const t = Math.log(re / re1) / Math.log(re2 / re1);
      return Math.exp(Math.log(cd1) + t * (Math.log(cd2) - Math.log(cd1)));
    }
  }
  return last[1];
}

export interface CylinderResult {
  /** θ grid (0…2π) and Cp samples. */
  theta: number[];
  cp: number[];
  /** Kutta–Joukowski lift per unit span (N/m). */
  liftPerSpan: number;
  /** Lift coefficient cl = Γ/(U·a) with chord = 2a reference. */
  cl: number;
  /** Ideal drag (always 0 — d'Alembert). */
  cdIdeal: number;
  /** Real-fluid empirical Cd(Re) with Re = 2aU/ν. */
  cdReal: number;
  /** Re based on diameter. */
  re: number;
  /** Stagnation angles (rad) when they exist on the surface, else empty. */
  stagnation: number[];
  /** Γ/(2πaU) — the rotation parameter actually used. */
  gammaParam: number;
}

/** Full spinning-cylinder dataset: Cp(θ), lift, ideal vs real Cd. */
export function cylinderFlow(rho: number, u: number, radius: number, gamma: number, nu: number, n = 181): CylinderResult {
  if (rho <= 0 || u <= 0 || radius <= 0 || nu <= 0) throw new FluidError('rho, U, radius and nu must be > 0');
  if (n < 36) throw new FluidError('need at least 36 surface samples');
  const gammaParam = gamma / (2 * Math.PI * radius * u);
  const theta: number[] = [];
  const cp: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const th = (2 * Math.PI * i) / (n - 1);
    theta.push(th);
    cp.push(cylinderCp(th, gammaParam));
  }
  const lift = cylinderLift(rho, u, gamma, radius);
  const re = reynoldsNumber(u, 2 * radius, nu);
  // Stagnation points: v_θ = 0 → sinθ = −Γ/(4πaU); on-surface only when
  // |Γ| ≤ 4πaU, otherwise they lift off (subcritical Γ only here).
  const stagnation: number[] = [];
  const s = -gamma / (4 * Math.PI * radius * u);
  if (Math.abs(s) <= 1) {
    stagnation.push(Math.asin(s));
    stagnation.push(Math.PI - Math.asin(s));
  }
  return {
    theta,
    cp,
    liftPerSpan: lift.liftPerSpan,
    cl: lift.cl,
    cdIdeal: IDEAL_CYLINDER_CD,
    cdReal: realCylinderCd(re),
    re,
    stagnation,
    gammaParam,
  };
}

// ==========================================================================
// Module 5: lbm3d — D3Q19 lattice-Boltzmann (BGK) duct Poiseuille flow
// ==========================================================================

// D3Q19 discrete velocities (x = flow direction, y/z = cross-section).
const LBM_Q = 19;
const LBM_CX = [0, 1, -1, 0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 0, 0];
const LBM_CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, 1, -1, 0, 0, 0, 0, 1, 1, -1, -1];
const LBM_CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1];
// Weights: rest 1/3, axis 6×1/18, face diagonals 12×1/36.
const LBM_W = (() => {
  const w = new Array<number>(LBM_Q);
  w[0] = 1 / 3;
  for (let q = 1; q <= 6; q += 1) w[q] = 1 / 18;
  for (let q = 7; q < LBM_Q; q += 1) w[q] = 1 / 36;
  return w;
})();
// Opposite-direction map (|c_q| pairs).
const LBM_OPP = (() => {
  const opp = new Array<number>(LBM_Q);
  for (let q = 0; q < LBM_Q; q += 1) {
    for (let r = 0; r < LBM_Q; r += 1) {
      if (LBM_CX[q] === -LBM_CX[r] && LBM_CY[q] === -LBM_CY[r] && LBM_CZ[q] === -LBM_CZ[r]) {
        opp[q] = r;
        break;
      }
    }
  }
  return opp;
})();

export interface LbmDuctParams {
  /** Nodes along the flow direction (x), 16…40. */
  nx: number;
  /** Cross-section nodes in y, 8…20. */
  ny: number;
  /** Cross-section nodes in z, 12…40. */
  nz: number;
  /** Lattice kinematic viscosity ν (lattice units), 0.05…0.2. */
  nu: number;
  /** Prescribed inlet plug velocity u0 (lattice units), 0.01…0.1. */
  u0: number;
  /** Number of time steps (fixed → deterministic output). */
  steps: number;
}

export interface LbmProfilePoint {
  /** Cross-section coordinate ŷ from the duct centre (lattice units). */
  y: number;
  /** LBM axial velocity u_x. */
  u: number;
  /** Exact rectangular-duct Fourier-series reference at the same point. */
  uRef: number;
}

export interface LbmDuctResult {
  /** Centerline velocity profile (line through the section centre in z). */
  profile: LbmProfilePoint[];
  /** Bulk (area-averaged) axial velocity at the sampling plane. */
  uBulk: number;
  /** Maximum axial velocity on the sampling plane. */
  uMax: number;
  /** Analytic reference centreline maximum. */
  uRefMax: number;
  /** Volumetric flow rate per step (lattice units³) at the sampling plane. */
  flowRate: number;
  /** Hydraulic diameter D_h = 2·ny·nz/(ny+nz) (lattice units). */
  dh: number;
  /** Effective duct Reynolds number uBulk·D_h/ν. */
  re: number;
  /** Max |u − uRef| / uRefMax over the sampled profile. */
  profileErr: number;
  /** Lattice_BGK relaxation time τ = 3ν + ½. */
  tau: number;
  /** Grid and step echo (for the science output provenance). */
  nx: number;
  ny: number;
  nz: number;
  steps: number;
}

export function validateLbmDuct(p: LbmDuctParams): void {
  if (!(p.nx >= 16 && p.nx <= 40)) throw new FluidError('nx must be in [16, 40]');
  if (!(p.ny >= 8 && p.ny <= 20)) throw new FluidError('ny must be in [8, 20]');
  if (!(p.nz >= 12 && p.nz <= 40)) throw new FluidError('nz must be in [12, 40]');
  if (!(p.nu >= 0.05 && p.nu <= 0.2)) throw new FluidError('nu must be in [0.05, 0.2] lattice units');
  if (!(p.u0 >= 0.01 && p.u0 <= 0.1)) throw new FluidError('u0 must be in [0.01, 0.1] (low-Mach limit)');
  if (!(p.steps >= 1 && p.steps <= 5000)) throw new FluidError('steps must be in [1, 5000]');
}

/**
 * Exact laminar steady solution for a rectangular duct with half-widths
 * (a, b) = (ny, nz)/2, driven by ∂p/∂x (White ch. 3 / Shah & London):
 *   u(ŷ,ẑ) = C·Σ_{n odd} (−1)^((n−1)/2)/n³ ·
 *            [1 − cosh(nπẑ/2a)/cosh(nπb/2a)]·cos(nπŷ/2a),
 * C = 16a²/(μπ³)·(−dp/dx). Here only the SHAPE matters: the caller
 * normalises the series so its cross-sectional mean equals the prescribed
 * inlet plug velocity (incompressible mass conservation), giving an absolute
 * velocity reference with no pressure gradient bookkeeping.
 */
export function ductPoiseuilleShape(y: number, z: number, halfY: number, halfZ: number, terms = 24): number {
  let s = 0;
  for (let k = 0; k < terms; k += 1) {
    const n = 2 * k + 1;
    const sign = k % 2 === 0 ? 1 : -1;
    const lambda = (n * Math.PI) / (2 * halfY);
    const coshRatio = Math.cosh(lambda * z) / Math.cosh(lambda * halfZ);
    s += (sign / (n * n * n)) * (1 - coshRatio) * Math.cos(lambda * y);
  }
  return s;
}

/**
 * One deterministic D3Q19 BGK run of straight-duct Poiseuille flow in
 * lattice units: Zou/He velocity inlet (plug u0), outward extrapolation
 * outflow, half-way bounce-back walls, Float32Array storage, fixed step
 * count — no RNG and no wall clock, so repeated runs are bit-identical.
 * The centerline u_x profile on the mid-length plane is compared against
 * the exact rectangular-duct series normalised to the same bulk velocity.
 *
 * Layout: populations are structure-of-arrays f[q·N + node] with node =
 * (x·ny + y)·nz + z. Streaming is implemented in pull form: f[q](n) =
 * fPost[q](n − c_q), with the three boundary cases —
 *   · source beyond a y/z wall → half-way bounce-back f[q](n) = fPost[opp q](n);
 *   · source beyond the inlet (x < 0) → Zou/He velocity condition (east
 *     populations rebuilt from non-equilibrium bounce-back; wall strips
 *     simply bounce back);
 *   · source beyond the outlet (x > nx−1) → zero-gradient extrapolation
 *     from the upstream plane (outward extrapolation outflow).
 */
export function runLbmDuct(p: LbmDuctParams): LbmDuctResult {
  validateLbmDuct(p);
  const { nx, ny, nz, nu, u0 } = p;
  const steps = Math.round(p.steps);
  const omega = 1 / (3 * nu + 0.5);
  const N = nx * ny * nz;
  const idx = (x: number, y: number, z: number): number => (x * ny + y) * nz + z;

  // Flattened lattice tables (typed arrays for hot-loop speed).
  const CX = Int32Array.from(LBM_CX);
  const CY = Int32Array.from(LBM_CY);
  const CZ = Int32Array.from(LBM_CZ);
  const OPP = Int32Array.from(LBM_OPP);
  const W = Float64Array.from(LBM_W);

  let cur = new Float32Array(LBM_Q * N);
  let post = new Float32Array(LBM_Q * N);
  const ux = new Float32Array(N);
  // Initialise at rest at unit density: f = feq(ρ=1, u=0) = w.
  for (let q = 0; q < LBM_Q; q += 1) {
    cur.fill(W[q]!, q * N, (q + 1) * N);
  }

  // Inlet equilibrium constants for the plug profile u = (u0, 0, 0):
  // feq_q(ρ) = w_q·ρ·(1 ± 3u0 + 3u0²) for cx = ±1, w_q·ρ·(1 − 1.5u0²) for cx = 0.
  const u02 = u0 * u0;
  const kInPlus = 1 + 3 * u0 + 3 * u02;
  const kInMinus = 1 - 3 * u0 + 3 * u02;
  const kInZero = 1 - 1.5 * u02;

  for (let step = 0; step < steps; step += 1) {
    // ---- collide: cur → post (BGK) ----------------------------------------
    for (let n = 0; n < N; n += 1) {
      let r = 0;
      let mx = 0;
      for (let q = 0; q < LBM_Q; q += 1) {
        const fv = cur[q * N + n]!;
        r += fv;
        mx += CX[q]! * fv;
      }
      const vx = mx / r;
      ux[n] = vx;
      const rest = 1 - 1.5 * vx * vx;
      for (let q = 0; q < LBM_Q; q += 1) {
        const cu = 3 * CX[q]! * vx;
        const feq = W[q]! * r * (rest + cu + 0.5 * cu * cu);
        const fOld = cur[q * N + n]!;
        post[q * N + n] = fOld - omega * (fOld - feq);
      }
    }

    // ---- stream: post → cur (pull) with wall / inlet / outlet handling ----
    for (let x = 0; x < nx; x += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let z = 0; z < nz; z += 1) {
          const n = idx(x, y, z);
          const isWall = y === 0 || y === ny - 1 || z === 0 || z === nz - 1;
          cur[0 * N + n] = post[0 * N + n]!; // rest population never leaves
          for (let q = 1; q < LBM_Q; q += 1) {
            const sx = x - CX[q]!;
            const sy = y - CY[q]!;
            const sz = z - CZ[q]!;
            let val: number;
            if (sx >= 0 && sx < nx && sy >= 0 && sy < ny && sz >= 0 && sz < nz) {
              val = post[q * N + idx(sx, sy, sz)]!;
            } else if (sy < 0 || sy > ny - 1 || sz < 0 || sz > nz - 1) {
              // Half-way bounce-back at a wall (physical wall sits half-way).
              val = post[OPP[q]! * N + n]!;
            } else if (sx < 0) {
              // Inlet side: fluid nodes get Zou/He below; wall strips bounce.
              val = isWall ? post[OPP[q]! * N + n]! : 0;
            } else {
              // Outlet side (sx > nx−1): zero-gradient outflow — copy the
              // same population from the upstream plane (outward extrapolation).
              val = post[q * N + idx(nx - 2, y, z)]!;
            }
            cur[q * N + n] = val;
          }
        }
      }
    }

    // ---- Zou/He velocity inlet on fluid nodes of the x = 0 plane ----------
    // Unknown east populations {1,7,8,11,12}; density from the mass balance
    // ρ(1 − u0) = Σ_known f + W, W = f2+f9+f10+f13+f14 (see module comment).
    for (let y = 1; y < ny - 1; y += 1) {
      for (let z = 1; z < nz - 1; z += 1) {
        const n = idx(0, y, z);
        const base = n; // readability
        const f2 = cur[2 * N + base]!;
        const f9 = cur[9 * N + base]!;
        const f10 = cur[10 * N + base]!;
        const f13 = cur[13 * N + base]!;
        const f14 = cur[14 * N + base]!;
        const wSum = f2 + f9 + f10 + f13 + f14;
        let known = wSum;
        for (const q of [0, 3, 4, 5, 6, 15, 16, 17, 18]) {
          known += cur[q * N + base]!;
        }
        const rhoIn = (known + wSum) / (1 - u0);
        // Rebuild the five east-pointing populations by non-equilibrium
        // bounce-back: f_q = f_opp(q) + feq_q(ρ,u0) − feq_opp(q)(ρ,u0).
        const feq = (q: number): number => {
          const cx = CX[q]!;
          const k = cx === 1 ? kInPlus : cx === -1 ? kInMinus : kInZero;
          return W[q]! * rhoIn * k;
        };
        cur[1 * N + base] = f2 + feq(1) - feq(2);
        cur[7 * N + base] = f10 + feq(7) - feq(10);
        cur[8 * N + base] = f9 + feq(8) - feq(9);
        cur[11 * N + base] = f14 + feq(11) - feq(14);
        cur[12 * N + base] = f13 + feq(12) - feq(13);
      }
    }

    // Swap: cur now holds the streamed state; post becomes the next scratch.
    const tmp = cur;
    cur = post;
    post = tmp;
  }

  // ---- sampling: mid-length plane, centerline profile -----------------------
  const xS = Math.floor(nx / 2);
  const zC = Math.floor(nz / 2);
  const halfY = ny / 2;
  const halfZ = nz / 2;
  // Normalise the exact series so its cross-sectional mean equals u0
  // (incompressible mass conservation ties the LBM bulk to the inlet plug).
  let shapeSum = 0;
  for (let y = 0; y < ny; y += 1) {
    for (let z = 0; z < nz; z += 1) {
      shapeSum += ductPoiseuilleShape(y + 0.5 - halfY, z + 0.5 - halfZ, halfY, halfZ);
    }
  }
  const shapeMean = shapeSum / (ny * nz);
  const scale = u0 / shapeMean;
  const uRefMax = scale * ductPoiseuilleShape(0, 0, halfY, halfZ);

  let flowRate = 0;
  let uMax = 0;
  for (let y = 0; y < ny; y += 1) {
    for (let z = 0; z < nz; z += 1) {
      const v = ux[idx(xS, y, z)]!;
      flowRate += v;
      if (v > uMax) uMax = v;
    }
  }
  const uBulk = flowRate / (ny * nz);

  const profile: LbmProfilePoint[] = [];
  let profileErr = 0;
  for (let y = 0; y < ny; y += 1) {
    const yC = y + 0.5 - halfY;
    const zC2 = zC + 0.5 - halfZ;
    const u = ux[idx(xS, y, zC)]!;
    const uRef = scale * ductPoiseuilleShape(yC, zC2, halfY, halfZ);
    profile.push({ y: yC, u, uRef });
    const err = Math.abs(u - uRef) / uRefMax;
    if (err > profileErr) profileErr = err;
  }

  const dh = (2 * ny * nz) / (ny + nz);
  return {
    profile,
    uBulk,
    uMax,
    uRefMax,
    flowRate,
    dh,
    re: (uBulk * dh) / nu,
    profileErr,
    tau: 3 * nu + 0.5,
    nx,
    ny,
    nz,
    steps,
  };
}

