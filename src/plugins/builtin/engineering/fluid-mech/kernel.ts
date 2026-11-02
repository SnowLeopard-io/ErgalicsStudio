// ==========================================================================
// eng-fluid kernel — analytic fluid mechanics, pure numeric core.
//
// No DOM, no plugin-framework imports. Modules:
//
// 1. Pipe flow: Reynolds number, flow-regime classification (laminar <
//    2300, transitional < 4000, turbulent), Darcy friction factor via
//    Colebrook–White (Newton iteration on x = 1/√f, Haaland seed), laminar
//    f = 64/Re and the Blasius smooth-pipe correlation 0.3164/Re^0.25 as
//    explicit fallbacks, Darcy–Weisbach head loss.
//
// 2. Ideal Bernoulli ducts: streamwise-smooth area variation (Hermite
//    smoothstep taper), continuity A(x)·v(x) = Q and the Bernoulli
//    invariant p + ½ρv² = p₀ along the duct; EGL/HGL head lines.
//
// 3. Flat-plate boundary layer: the Blasius similarity ODE
//    f''' + ½·f·f'' = 0 integrated with fixed-step RK4 under bisection
//    shooting on f''(0) (target f'(∞) = 1), yielding η99, δ*, θ, cf and
//    the canonical coefficients 5.0, 1.7208, 0.6641; a Pohlhausen quartic
//    family u/U = (2+λ/6)η − (λ/2)η² − (2−λ/2)η³ + (1−λ/6)η⁴ with shape
//    factor H(λ) and the separation criterion (wall shear 2 + λ/6 = 0 at
//    λ = −12, H = 3.5) for the qualitative adverse-gradient indicator.
//
// 4. Potential flow past a sphere / circular cylinder with circulation:
//    analytic velocity fields for streamline integration, Kutta–Joukowski
//    lift Cl = Γ/(U·a), surface stagnation points sinθ = Γ/(4πUa), and the
//    viscous drag estimates Stokes Cd = 24/Re and Schiller–Naumann.
//
// References: Moody (1944); Colebrook (1939); Haaland (1983); Blasius
// (1908) / Schlichting, "Boundary-Layer Theory"; Pohlhausen (1921);
// Schiller & Naumann (1935); Kutta (1902) / Joukowski (1906); Stokes (1851).
// ==========================================================================

// ---- shared constants --------------------------------------------------------

/** Standard gravity (m/s²). */
export const G = 9.80665;
/** Upper Reynolds number of the laminar regime (classical pipe-flow bound). */
export const RE_LAMINAR_MAX = 2300;
/** Upper Reynolds number of the transitional band (classical pipe-flow bound). */
export const RE_TRANSITIONAL_MAX = 4000;

export type FlowRegime = 'laminar' | 'transitional' | 'turbulent';

/** Raised for invalid parameters or solver limits. */
export class FluidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluidError';
  }
}

// ===========================================================================
// 1. Pipe flow — Darcy–Weisbach with Colebrook–White
// ===========================================================================

export interface PipeParams {
  /** Pipe inner diameter (m). */
  d: number;
  /** Mean (bulk) velocity (m/s). */
  v: number;
  /** Fluid density (kg/m³). */
  rho: number;
  /** Dynamic viscosity (Pa·s). */
  mu: number;
  /** Pipe length (m). */
  L: number;
  /** Absolute wall roughness (m). */
  eps: number;
}

export interface PipeResult {
  re: number;
  regime: FlowRegime;
  /** Darcy friction factor (dimensionless). */
  f: number;
  /** Relative roughness ε/d. */
  epsOverD: number;
  /** Darcy–Weisbach head loss (m of fluid). */
  hf: number;
  /** Static pressure drop ρ·g·hf (Pa). */
  dp: number;
  /** Wall shear stress τw = f·ρv²/8 (Pa). */
  tauW: number;
}

/** Reynolds number ρ·v·d/μ of an internal pipe flow. */
export function reynoldsNumber(rho: number, v: number, d: number, mu: number): number {
  return (rho * v * d) / mu;
}

/** Laminar-regime Darcy friction factor: exact Poiseuille value 64/Re. */
export function laminarFriction(re: number): number {
  return 64 / re;
}

/** Blasius smooth-pipe turbulent correlation f = 0.3164/Re^0.25 (4e3 ≤ Re ≤ 1e5). */
export function pipeBlasiusFriction(re: number): number {
  return 0.3164 / Math.pow(re, 0.25);
}

/**
 * Haaland (1983) explicit Swamee-style approximation of Colebrook–White,
 * used as the Newton seed and as the independent cross-check correlation:
 * 1/√f = −1.8·log10[ (ε/(3.7d))^1.11 + 6.9/Re ].
 */
export function haalandFriction(re: number, epsOverD: number): number {
  const term = Math.pow(epsOverD / 3.7, 1.11) + 6.9 / re;
  const invSqrtF = -1.8 * Math.log10(term);
  return 1 / (invSqrtF * invSqrtF);
}

/**
 * Colebrook–White implicit friction factor solved by Newton iteration on
 * x = 1/√f:  g(x) = x + 2·log10( ε/(3.7d) + 2.51·x/Re ) = 0.
 * Seeded from Haaland; converges quadratically to |g| < 1e-12. The smooth-wall
 * limit ε → 0 and the fully rough limit are both handled by the same iteration.
 */
export function colebrookWhite(re: number, epsOverD: number): number {
  if (!(re > 0)) throw new FluidError('Re must be > 0 for Colebrook–White');
  if (epsOverD < 0) throw new FluidError('relative roughness must be ≥ 0');
  const a = epsOverD / 3.7;
  const b = 2.51 / re;
  // Residual of the Colebrook equation in x = 1/√f.
  const g = (x: number): number => x + 2 * Math.log10(a + b * x);
  // dg/dx = 1 + 2/(ln10)·b/(a + b·x)  (a + b·x > 0 always for x > 0).
  const dg = (x: number): number => 1 + (2 / Math.LN10) * (b / (a + b * x));
  let x = 1 / Math.sqrt(haalandFriction(re, epsOverD)); // Haaland seed
  for (let i = 0; i < 60; i += 1) {
    const step = g(x) / dg(x);
    x -= step;
    if (!(x > 0)) throw new FluidError('Colebrook–White iteration left the physical domain');
    if (Math.abs(step) < 1e-13 * x) break;
  }
  if (Math.abs(g(x)) > 1e-9) throw new FluidError('Colebrook–White failed to converge');
  return 1 / (x * x);
}

/**
 * Full-range Darcy friction factor dispatcher:
 * - Re < 2300: laminar, exact 64/Re;
 * - 2300 ≤ Re < 4000: transitional, linear interpolation in Re between the
 *   laminar value at Re = 2300 and the Colebrook–White value at Re = 4000
 *   (the band itself has no universal closed form; the blend is documented);
 * - Re ≥ 4000: Colebrook–White (Newton), Haaland as the independent check.
 */
export function darcyFrictionFactor(re: number, epsOverD: number): number {
  if (re < RE_LAMINAR_MAX) return laminarFriction(re);
  if (re < RE_TRANSITIONAL_MAX) {
    const fLam = laminarFriction(RE_LAMINAR_MAX);
    const fTurb = colebrookWhite(RE_TRANSITIONAL_MAX, epsOverD);
    const t = (re - RE_LAMINAR_MAX) / (RE_TRANSITIONAL_MAX - RE_LAMINAR_MAX);
    return fLam + t * (fTurb - fLam);
  }
  return colebrookWhite(re, epsOverD);
}

/** Flow-regime classifier for pipe flow (laminar < 2300 ≤ transitional < 4000 ≤ turbulent). */
export function classifyRegime(re: number): FlowRegime {
  if (re < RE_LAMINAR_MAX) return 'laminar';
  if (re < RE_TRANSITIONAL_MAX) return 'transitional';
  return 'turbulent';
}

/** Darcy–Weisbach head loss h_f = f·(L/d)·v²/(2g) (m of fluid). */
export function darcyWeisbachHeadLoss(f: number, L: number, d: number, v: number): number {
  return (f * (L / d) * v * v) / (2 * G);
}

/** Full pipe-flow reduction: Re, regime, f, head loss, pressure drop, wall shear. */
export function pipeFlow(p: PipeParams): PipeResult {
  if (!(p.d > 0)) throw new FluidError('d must be > 0 m');
  if (!(p.v > 0)) throw new FluidError('v must be > 0 m/s');
  if (!(p.rho > 0)) throw new FluidError('rho must be > 0 kg/m³');
  if (!(p.mu > 0)) throw new FluidError('mu must be > 0 Pa·s');
  if (!(p.L > 0)) throw new FluidError('L must be > 0 m');
  if (!(p.eps >= 0)) throw new FluidError('eps must be ≥ 0 m');
  if (p.eps / p.d > 0.05) throw new FluidError('relative roughness eps/d must be ≤ 0.05');
  const re = reynoldsNumber(p.rho, p.v, p.d, p.mu);
  const epsOverD = p.eps / p.d;
  const f = darcyFrictionFactor(re, epsOverD);
  const hf = darcyWeisbachHeadLoss(f, p.L, p.d, p.v);
  return {
    re,
    regime: classifyRegime(re),
    f,
    epsOverD,
    hf,
    dp: p.rho * G * hf,
    tauW: (f * p.rho * p.v * p.v) / 8,
  };
}

// ---- Moody chart data --------------------------------------------------------

export interface MoodyPoint {
  re: number;
  f: number;
}

/** Laminar branch of the Moody chart: f = 64/Re sampled on a log-Re grid. */
export function moodyLaminarLine(n = 40): MoodyPoint[] {
  const pts: MoodyPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const re = 500 * Math.pow(RE_LAMINAR_MAX / 500, i / (n - 1));
    pts.push({ re, f: laminarFriction(re) });
  }
  return pts;
}

/**
 * Turbulent Colebrook–White branch for one relative roughness, sampled on a
 * log-Re grid over [4e3, 1e8]. Blasius correlation appended below 1e5 as the
 * dotted reference when the caller asks for it (see the plugin layer).
 */
export function moodyTurbulentCurve(epsOverD: number, n = 64): MoodyPoint[] {
  const pts: MoodyPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const re = RE_TRANSITIONAL_MAX * Math.pow(1e8 / RE_TRANSITIONAL_MAX, i / (n - 1));
    pts.push({ re, f: colebrookWhite(re, epsOverD) });
  }
  return pts;
}

/** Blasius smooth-pipe correlation branch, 4e3 ≤ Re ≤ 1e5 (its stated range). */
export function moodyBlasiusCurve(n = 32): MoodyPoint[] {
  const pts: MoodyPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const re = RE_TRANSITIONAL_MAX * Math.pow(1e5 / RE_TRANSITIONAL_MAX, i / (n - 1));
    pts.push({ re, f: pipeBlasiusFriction(re) });
  }
  return pts;
}

// ===========================================================================
// 2. Ideal Bernoulli ducts — continuity + energy
// ===========================================================================

export type DuctShape = 'converging' | 'diverging' | 'venturi';

export interface DuctParams {
  shape: DuctShape;
  /** Inlet diameter (m). */
  d1: number;
  /** Outlet (converging/diverging) or throat (venturi) diameter (m). */
  d2: number;
  /** Inlet mean velocity (m/s). */
  v1: number;
  /** Inlet gauge pressure (Pa). */
  p1: number;
  /** Duct length (m). */
  len: number;
  /** Fluid density (kg/m³). */
  rho: number;
}

export interface DuctStation {
  /** Streamwise coordinate (m). */
  x: number;
  /** Local inner diameter (m). */
  d: number;
  /** Local mean velocity from continuity (m/s). */
  v: number;
  /** Local gauge pressure from Bernoulli (Pa). */
  p: number;
  /** Hydraulic grade line p/(ρg) (m). */
  hgl: number;
  /** Energy grade line p/(ρg) + v²/(2g) (m) — constant for ideal flow. */
  egl: number;
}

/** Hermite smoothstep s(t) = 3t² − 2t³ (zero slope at both ends). */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Local duct diameter. Converging/diverging: one smoothstep taper d1 → d2
 * over the full length; venturi: converging over the first half, symmetric
 * diverging recovery over the second half.
 */
export function ductDiameter(shape: DuctShape, d1: number, d2: number, len: number, x: number): number {
  const t = len > 0 ? Math.min(1, Math.max(0, x / len)) : 1;
  if (shape === 'converging') return d1 + (d2 - d1) * smoothstep(t);
  if (shape === 'diverging') return d1 + (d2 - d1) * smoothstep(t);
  // venturi: taper down over [0, 0.5], recover symmetrically over [0.5, 1]
  const s = t <= 0.5 ? smoothstep(t / 0.5) : smoothstep((1 - t) / 0.5);
  return d1 + (d2 - d1) * s;
}

/**
 * Station table along the duct. Continuity gives v(x) = v1·(d1/d(x))² and the
 * Bernoulli invariant gives p(x) = p1 + ½ρ(v1² − v(x)²) (horizontal duct, no
 * losses). HGL = p/(ρg); EGL = HGL + v²/(2g) is exactly constant.
 */
export function ductStations(p: DuctParams, n = 200): DuctStation[] {
  if (!(p.d1 > 0) || !(p.d2 > 0)) throw new FluidError('duct diameters must be > 0 m');
  if (!(p.v1 > 0)) throw new FluidError('v1 must be > 0 m/s');
  if (!(p.len > 0)) throw new FluidError('duct length must be > 0 m');
  if (!(p.rho > 0)) throw new FluidError('rho must be > 0 kg/m³');
  const egl0 = p.p1 / (p.rho * G) + (p.v1 * p.v1) / (2 * G);
  const stations: DuctStation[] = [];
  for (let i = 0; i <= n; i += 1) {
    const x = (p.len * i) / n;
    const d = ductDiameter(p.shape, p.d1, p.d2, p.len, x);
    const v = p.v1 * (p.d1 / d) * (p.d1 / d); // continuity: A·v = const
    const hgl = p.p1 / (p.rho * G) + (p.v1 * p.v1 - v * v) / (2 * G);
    stations.push({ x, d, v, p: hgl * p.rho * G, hgl, egl: egl0 });
  }
  return stations;
}

/**
 * Continuity + Bernoulli self-check: maximum relative flow-rate imbalance
 * |A·v − Q₀|/Q₀ over the station table (should be ~1e-12) and the maximum
 * Bernoulli invariant drift of p + ½ρv² (also ~1e-12 in head units).
 */
export function ductConservation(p: DuctParams, n = 200): { continuityErr: number; energyErrHead: number } {
  const q0 = (Math.PI * p.d1 * p.d1) / 4 * p.v1;
  const e0 = p.p1 + 0.5 * p.rho * p.v1 * p.v1;
  let continuityErr = 0;
  let energyErrHead = 0;
  for (const s of ductStations(p, n)) {
    const q = (Math.PI * s.d * s.d) / 4 * s.v;
    continuityErr = Math.max(continuityErr, Math.abs(q - q0) / Math.abs(q0));
    const e = s.p + 0.5 * p.rho * s.v * s.v;
    energyErrHead = Math.max(energyErrHead, Math.abs(e - e0) / (p.rho * G));
  }
  return { continuityErr, energyErrHead };
}

// ===========================================================================
// 3. Flat-plate boundary layer — Blasius shooting + Pohlhausen family
// ===========================================================================

/** Solution of the Blasius similarity ODE on the η grid. */
export interface BlasiusSolution {
  /** η grid (uniform, 0 … ηMax). */
  eta: number[];
  f: number[];
  /** f' = u/U similarity velocity profile. */
  fp: number[];
  fpp: number[];
  /** Shooting value f''(0) (analytic 0.332057336…). */
  fpp0: number;
  /** 99% thickness coordinate η99 (analytic ≈ 5.0 → δ/x = 5/√Rex). */
  eta99: number;
  /** Displacement thickness coefficient δ* / √(νx/U) (analytic 1.7208). */
  deltaStar: number;
  /** Momentum thickness coefficient θ/√(νx/U) (analytic 0.6641). */
  theta: number;
}

/**
 * Fixed-step RK4 integration of f''' = −½·f·f'' with initial state
 * (0, 0, a). Classic RK4 on the 3-vector state.
 */
function blasiusRk4(a: number, etaMax: number, h: number): { f: number[]; fp: number[]; fpp: number[] } {
  const n = Math.round(etaMax / h);
  const f = new Array<number>(n + 1);
  const fp = new Array<number>(n + 1);
  const fpp = new Array<number>(n + 1);
  let s0 = 0; // f
  let s1 = 0; // f'
  let s2 = a; // f''
  f[0] = s0;
  fp[0] = s1;
  fpp[0] = s2;
  const deriv = (st0: number, st1: number, st2: number, out: number[]): void => {
    out[0] = st1;
    out[1] = st2;
    out[2] = -0.5 * st0 * st2;
  };
  const k = [0, 0, 0];
  for (let i = 1; i <= n; i += 1) {
    // k1
    deriv(s0, s1, s2, k);
    const k10 = k[0]!, k11 = k[1]!, k12 = k[2]!;
    // k2
    deriv(s0 + (h / 2) * k10, s1 + (h / 2) * k11, s2 + (h / 2) * k12, k);
    const k20 = k[0]!, k21 = k[1]!, k22 = k[2]!;
    // k3
    deriv(s0 + (h / 2) * k20, s1 + (h / 2) * k21, s2 + (h / 2) * k22, k);
    const k30 = k[0]!, k31 = k[1]!, k32 = k[2]!;
    // k4
    deriv(s0 + h * k30, s1 + h * k31, s2 + h * k32, k);
    const k40 = k[0]!, k41 = k[1]!, k42 = k[2]!;
    s0 += (h / 6) * (k10 + 2 * k20 + 2 * k30 + k40);
    s1 += (h / 6) * (k11 + 2 * k21 + 2 * k31 + k41);
    s2 += (h / 6) * (k12 + 2 * k22 + 2 * k32 + k42);
    f[i] = s0;
    fp[i] = s1;
    fpp[i] = s2;
  }
  return { f, fp, fpp };
}

let blasiusCache: BlasiusSolution | null = null;

/**
 * Blasius similarity solution by bisection shooting on a = f''(0): integrate
 * to ηMax = 12 with h = 0.005 and bisect until f'(ηMax) = 1. Deterministic;
 * the result is cached module-level (the ODE has no parameters).
 *
 * Benchmarks (Schlichting): f''(0) = 0.3320573, η99 ≈ 5.0,
 * δ* = 1.7208·√(νx/U), θ = 0.6641·√(νx/U), H = δ* / θ = 2.591.
 */
export function solveBlasius(): BlasiusSolution {
  if (blasiusCache) return blasiusCache;
  const etaMax = 12;
  const h = 0.005;
  const residual = (a: number): number => {
    const { fp } = blasiusRk4(a, etaMax, h);
    return fp[fp.length - 1]! - 1;
  };
  // Bisection on a ∈ [0.3, 0.36] — residual is monotone increasing in a
  // (larger initial curvature → faster approach of f' to 1).
  let lo = 0.3;
  let hi = 0.36;
  let a = 0.332;
  for (let i = 0; i < 52; i += 1) {
    a = 0.5 * (lo + hi);
    const r = residual(a);
    if (r > 0) hi = a;
    else lo = a;
  }
  const { f, fp, fpp } = blasiusRk4(a, etaMax, h);
  // η99: first crossing of f' = 0.99 (linear interpolation on the grid).
  let eta99 = etaMax;
  for (let i = 1; i < fp.length; i += 1) {
    if (fp[i]! >= 0.99) {
      const t = (0.99 - fp[i - 1]!) / (fp[i]! - fp[i - 1]!);
      eta99 = (i - 1 + t) * h;
      break;
    }
  }
  // δ* = ∫(1 − f')dη = ηMax − f(ηMax) + tail; the exponential tail beyond
  // η = 12 is < 1e-9 so the closed endpoint difference is used.
  const deltaStar = etaMax - f[f.length - 1]!;
  // θ = ∫f'(1 − f')dη by trapezoid (tail negligible).
  let theta = 0;
  for (let i = 1; i < fp.length; i += 1) {
    const g0 = fp[i - 1]! * (1 - fp[i - 1]!);
    const g1 = fp[i]! * (1 - fp[i]!);
    theta += 0.5 * h * (g0 + g1);
  }
  blasiusCache = { eta: f.map((_, i) => i * h), f, fp, fpp, fpp0: a, eta99, deltaStar, theta };
  return blasiusCache;
}

export interface BlThickness {
  /** Boundary-layer thickness δ99 = η99·√(νx/U) (m). */
  delta: number;
  /** Displacement thickness (m). */
  deltaStar: number;
  /** Momentum thickness (m). */
  theta: number;
  /** Local skin-friction coefficient cf = 2·f''(0)/√Rex. */
  cf: number;
  /** Local Reynolds number Rex = U·x/ν. */
  reX: number;
  /** η99 (exposed so callers can quote δ/x = η99/√Rex). */
  eta99: number;
}

/**
 * Blasius thicknesses at station x for kinematic viscosity ν = μ/ρ:
 * δ = η99·√(νx/U), δ* = 1.7208·√(νx/U), θ = 0.6641·√(νx/U),
 * cf = 2·f''(0)/√Rex. All coefficients come from the shooting solution.
 */
export function blasiusThicknesses(x: number, nu: number, uInf: number): BlThickness {
  if (!(x > 0)) throw new FluidError('x must be > 0 m');
  if (!(nu > 0)) throw new FluidError('nu must be > 0 m²/s');
  if (!(uInf > 0)) throw new FluidError('uInf must be > 0 m/s');
  const sol = solveBlasius();
  const reX = (uInf * x) / nu;
  const root = Math.sqrt(nu * x / uInf);
  return {
    delta: sol.eta99 * root,
    deltaStar: sol.deltaStar * root,
    theta: sol.theta * root,
    cf: (2 * sol.fpp0) / Math.sqrt(reX),
    reX,
    eta99: sol.eta99,
  };
}

// ---- Pohlhausen quartic family (pressure-gradient separation indicator) ------

/**
 * Pohlhausen quartic profile satisfying u(0)=0, u(1)=1, u'(1)=u''(1)=0,
 * u''(0) = −λ (λ = δ²/ν·du_e/dx):
 *   u/U = (2 + λ/6)η − (λ/2)η² − (2 − λ/2)η³ + (1 − λ/6)η⁴,
 * equivalently f₀(η) + (λ/6)·η(1−η)³ with f₀ the λ = 0 member.
 * λ > 0 favourable gradient (fuller profile), λ < 0 adverse; the wall shear
 * u'(0) = 2 + λ/6 vanishes at λ = −12 (separation), where H = 3.5.
 */
export function pohlhausenProfile(lambda: number, eta: number): number {
  const c = lambda / 6;
  const e = Math.min(1, Math.max(0, eta));
  return (2 + c) * e - (lambda / 2) * e * e - (2 - lambda / 2) * e * e * e + (1 - c) * e * e * e * e;
}

export interface PohlhausenShape {
  /** δ* / δ from composite Simpson integration of ∫(1 − u/U)dη. */
  deltaStarOverDelta: number;
  /** θ/δ from ∫(u/U)(1 − u/U)dη. */
  thetaOverDelta: number;
  /** Shape factor H = δ* / θ. */
  H: number;
  /** Normalised wall shear u'(0) = 2 + λ/6 (≤ 0 ⇒ separated). */
  wallShear: number;
  /** True when λ ≤ −12 (vanishing/negative wall shear). */
  separated: boolean;
}

/**
 * Integral moments of the Pohlhausen profile by composite Simpson (exact to
 * machine precision for the quartic). Separation indicator: wall shear
 * 2 + λ/6 ≤ 0 at λ ≤ −12, with the textbook shape factor H = 3.5 there.
 */
export function pohlhausenShape(lambda: number): PohlhausenShape {
  const n = 2000; // even panel count
  const h = 1 / n;
  const integrand = (eta: number, which: 'ds' | 'th'): number => {
    const u = pohlhausenProfile(lambda, eta);
    return which === 'ds' ? 1 - u : u * (1 - u);
  };
  const simpson = (which: 'ds' | 'th'): number => {
    let sum = 0;
    for (let i = 0; i <= n; i += 1) {
      const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      sum += w * integrand(i * h, which);
    }
    return (sum * h) / 3;
  };
  const ds = simpson('ds');
  const th = simpson('th');
  const wallShear = 2 + lambda / 6;
  return { deltaStarOverDelta: ds, thetaOverDelta: th, H: ds / th, wallShear, separated: wallShear <= 0 };
}

// ===========================================================================
// 4. Potential flow past a sphere / cylinder — streamlines, Cd/Cl
// ===========================================================================

export type BodyKind = 'sphere' | 'cylinder';

/** Velocity of the analytic field at one point (flow along +x, body at origin). */
export function potentialFlowVelocity(body: BodyKind, uInf: number, a: number, gamma: number, x: number, y: number, z: number): [number, number, number] {
  const r2 = x * x + y * y + z * z;
  if (body === 'sphere') {
    const r3 = r2 * Math.sqrt(r2);
    const k = (a * a * a) / 2;
    // φ = U·x·(1 + a³/(2r³)) → v = ∇φ (uniform stream + 3-D doublet):
    // v_x = U[1 + (a³/2r³)(1 − 3x²/r²)], v_y = −3U·a³·x·y/(2r⁵), v_z likewise.
    const u = uInf * (1 + (k / r3) * (1 - (3 * x * x) / r2));
    const vy = (-3 * uInf * k * x * y) / (r3 * r2);
    const vz = (-3 * uInf * k * x * z) / (r3 * r2);
    return [u, vy, vz];
  }
  // Cylinder: 2-D field in the z = const planes, circulation counterclockwise.
  const r4 = r2 * r2;
  const u = uInf * (1 + (a * a / r2) * (1 - (2 * x * x) / r2)) - (gamma * y) / (2 * Math.PI * r2);
  const v = (-2 * uInf * a * a * x * y) / r4 + (gamma * x) / (2 * Math.PI * r2);
  return [u, v, 0];
}

/** Stokes drag law Cd = 24/Re (exact creeping-flow result for a sphere). */
export function sphereCdStokes(re: number): number {
  return 24 / re;
}

/**
 * Schiller–Naumann (1935) sphere drag correlation,
 * Cd = (24/Re)·(1 + 0.15·Re^0.687), valid for Re ≤ 1000; it degenerates to
 * the Stokes law as Re → 0 (used as the finite-Re drag estimate).
 */
export function sphereCdSchillerNaumann(re: number): number {
  return (24 / re) * (1 + 0.15 * Math.pow(re, 0.687));
}

/**
 * Drag force on a sphere from a Cd-based estimate:
 * Fd = ½·ρ·U²·Cd·πa². With Cd = 24/Re (Re = ρU·2a/μ) this reproduces the
 * Stokes closed form F = 6πμaU exactly.
 */
export function sphereDragForce(rho: number, mu: number, uInf: number, a: number, cd: number): number {
  const re = (rho * uInf * 2 * a) / mu;
  // Stokes limit: with Cd = 24/Re the Cd-based form collapses to F = 6πμaU exactly.
  if (cd === 24 / re) return 6 * Math.PI * mu * a * uInf;
  return 0.5 * rho * uInf * uInf * cd * Math.PI * a * a;
}

/**
 * Kutta–Joukowski lift coefficient of a circular cylinder with circulation Γ
 * (per unit span reference area 2a): Cl = ρUΓ / (½ρU²·2a) = Γ/(U·a).
 * Sign: Γ > 0 (counterclockwise) gives lift along +y.
 */
export function cylinderCl(uInf: number, a: number, gamma: number): number {
  return gamma / (uInf * a);
}

/**
 * Angular position of the two surface stagnation points of a cylinder with
 * circulation: v_θ(a) = −2U·sinθ + Γ/(2πa) = 0 ⇒ sinθ = Γ/(4πUa).
 * Returns [θ₁, θ₂] (radians) when |Γ| < 4πUa, otherwise null (stagnation
 * points lifted off the surface — detached).
 */
export function cylinderStagnationAngles(uInf: number, a: number, gamma: number): [number, number] | null {
  const s = gamma / (4 * Math.PI * uInf * a);
  if (Math.abs(s) >= 1) return null;
  const t = Math.asin(s);
  return [t, Math.PI - t];
}

/** Surface tangential speed ratio |v_θ|/U of the selected body at angle θ. */
export function surfaceSpeedRatio(body: BodyKind, uInf: number, a: number, gamma: number, theta: number): number {
  if (body === 'sphere') {
    return Math.abs(1.5 * uInf * Math.sin(theta)) / uInf; // sphere: v_θ(a) = −(3/2)U·sinθ
  }
  return Math.abs(-2 * uInf * Math.sin(theta) + gamma / (2 * Math.PI * a)) / uInf;
}

/** Combined Re/Cd/Cl reduction published by the drag-lift panel. */
export interface AeroResult {
  re: number;
  /** Potential-flow drag is exactly zero (d'Alembert). */
  cdPotential: number;
  cdStokes: number;
  cdSchillerNaumann: number;
  /** Stokes-limit drag force F = 6πμaU (N). */
  fdStokes: number;
  /** Schiller–Naumann drag force at the operating Re (N). */
  fdSchiller: number;
  /** Kutta–Joukowski lift coefficient (cylinder only; sphere = 0). */
  cl: number;
  /** Magnus lift force per unit span ρUΓ (N/m, cylinder only). */
  liftPerSpan: number;
  /** Surface stagnation angles (cylinder; null when detached). */
  stagnation: [number, number] | null;
}

export function aeroReduction(body: BodyKind, rho: number, mu: number, uInf: number, a: number, gamma: number): AeroResult {
  if (!(a > 0)) throw new FluidError('radius must be > 0 m');
  if (!(uInf > 0)) throw new FluidError('U must be > 0 m/s');
  if (!(rho > 0)) throw new FluidError('rho must be > 0 kg/m³');
  if (!(mu > 0)) throw new FluidError('mu must be > 0 Pa·s');
  const re = (rho * uInf * 2 * a) / mu;
  const cdStokes = sphereCdStokes(re);
  const cl = body === 'cylinder' ? cylinderCl(uInf, a, gamma) : 0;
  const cdSn = re <= 1000 ? sphereCdSchillerNaumann(re) : Number.NaN;
  return {
    re,
    cdPotential: 0,
    cdStokes,
    cdSchillerNaumann: cdSn,
    fdStokes: sphereDragForce(rho, mu, uInf, a, cdStokes),
    fdSchiller: Number.isFinite(cdSn) ? sphereDragForce(rho, mu, uInf, a, cdSn) : Number.NaN,
    cl,
    liftPerSpan: rho * uInf * gamma,
    stagnation: body === 'cylinder' ? cylinderStagnationAngles(uInf, a, gamma) : null,
  };
}
