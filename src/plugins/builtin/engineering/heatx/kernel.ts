// ==========================================================================
// eng-heat kernel — heat-transfer numeric core (pure TS)
//
// Pure numeric core: no DOM, no plugin-framework imports. Five modules:
//
//   conduction
//     - 1-D composite wall, steady state, series thermal-resistance chain
//       (convection films + conductive layers), closed form;
//     - 2-D steady rectangular domain, Laplace equation ∇²T = 0 solved by
//       successive over-relaxation (SOR) with the optimal relaxation factor
//       ω_opt = 2/(1 + sin(π/N)); each edge is either isothermal (constant
//       or profile) or convective (h·(T∞ − T) = k·∂T/∂n ghost-node form);
//     - transient conduction, explicit FTCS with the von Neumann stability
//       gate r = α·Δt/Δx² ≤ 1/2 (summed over both axes in 2-D) checked
//       before any run.
//
//   convection — Nusselt-number correlation library
//     - forced internal turbulent flow: Dittus–Boelter
//       Nu = 0.023·Re^0.8·Pr^n (n = 0.4 heating / 0.3 cooling) and
//       Gnielinski with the Petukhov friction factor
//       f = (0.79·ln Re − 1.64)^−2;
//     - natural convection, Churchill & Chu (1975) for the vertical plate
//       and the horizontal cylinder (all-Rayleigh forms).
//
//   radiation
//     - blackbody: Stefan–Boltzmann σT⁴, Wien displacement, Planck spectral
//       emissive power E_bλ;
//     - gray two-surface enclosure network (surface resistances + space
//       resistance) with analytic view factors: large parallel plates
//       (F12 = 1) and coaxial parallel disks (Incropera Table 13.1);
//     - combined radiation + convection through a linearized h_rad.
//
//   exchanger
//     - LMTD method (counter-flow / parallel-flow, closed form);
//     - ε-NTU method: counter-flow, parallel-flow, 1 shell pass with n
//       tube passes (Incropera Table 11.4 closed form), single-pass
//       cross-flow with one stream mixed;
//     - mutual cross-validation of the two methods (exact for
//       counter/parallel flow).
//
//   network
//     - 1-D thermal-resistance network nodal solver (conduction +
//       convection + radiation edges, arbitrary series/parallel topology);
//       Gauss–Seidel-free dense Gaussian elimination + Kirchhoff residuals.
//
// References: T. L. Bergman, A. S. Lavine, F. P. Incropera, D. P. DeWitt,
// "Fundamentals of Heat and Mass Transfer" (correlation tables, view-factor
// catalog, ε-NTU table); S. W. Churchill & H. H. S. Chu, Int. J. Heat Mass
// Transfer 18 (1975); W. H. Press et al., "Numerical Recipes" (SOR).
// ==========================================================================

export class HeatXError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeatXError';
  }
}

// ---- physical constants -----------------------------------------------------

/** Stefan–Boltzmann constant (W·m⁻²·K⁻⁴), CODATA 2018. */
export const STEFAN_BOLTZMANN = 5.670374419e-8;
/** Wien displacement constant (µm·K). */
export const WIEN_UM_K = 2897.771955;
/** Planck first radiation constant C₁ = 2πhc² (W·µm⁴/m²). */
export const PLANCK_C1 = 3.741771e8;
/** Planck second radiation constant C₂ = hc/k (µm·K). */
export const PLANCK_C2 = 1.438777e4;
/** Standard gravity (m/s²). */
export const G_GRAVITY = 9.80665;

// ==========================================================================
// Module 1 — conduction
// ==========================================================================

// ---- 1-D composite wall (steady, analytic) ---------------------------------

export interface WallLayer {
  /** Layer thickness (m). */
  L: number;
  /** Thermal conductivity (W/(m·K)). */
  k: number;
}

export interface WallInput {
  /** Layers from the hot side to the cold side. */
  layers: WallLayer[];
  /** Shared heat-transfer area (m²). */
  area: number;
  /** Hot-side fluid temperature (K or °C — differences only). */
  tHot: number;
  /** Cold-side fluid temperature. */
  tCold: number;
  /** Hot-side convection coefficient (W/(m²·K)). */
  hHot: number;
  /** Cold-side convection coefficient (W/(m²·K)). */
  hCold: number;
}

export interface WallResult {
  /** Convective film resistances (K/W). */
  rConvHot: number;
  rConvCold: number;
  /** Conductive resistance of each layer (K/W), hot → cold. */
  rLayers: number[];
  /** Total series resistance (K/W). */
  rTotal: number;
  /** Steady heat-flow rate (W). */
  q: number;
  /** Heat flux (W/m²). */
  qFlux: number;
  /** Temperatures at the n+1 wall nodes: hot surface, interfaces, cold surface. */
  nodeTemps: number[];
}

/**
 * Steady 1-D composite wall through the series resistance chain
 *   R = 1/(h_hot·A) + Σ L_i/(k_i·A) + 1/(h_cold·A),
 * q = ΔT/R, with all node temperatures from the analytic flux-continuity
 * walk T_{i+1} = T_i − q·R_i.
 */
export function solveWall(input: WallInput): WallResult {
  const { layers, area, tHot, tCold, hHot, hCold } = input;
  if (layers.length === 0) throw new HeatXError('composite wall needs at least one layer');
  if (!(area > 0)) throw new HeatXError('area must be > 0 m2');
  if (!(hHot > 0) || !(hCold > 0)) throw new HeatXError('convection coefficients must be > 0');
  for (let i = 0; i < layers.length; i += 1) {
    const l = layers[i]!;
    if (!(l.L > 0)) throw new HeatXError(`layer ${i + 1}: thickness must be > 0 m`);
    if (!(l.k > 0)) throw new HeatXError(`layer ${i + 1}: conductivity must be > 0 W/(m·K)`);
  }

  const rConvHot = 1 / (hHot * area);
  const rConvCold = 1 / (hCold * area);
  const rLayers = layers.map((l) => l.L / (l.k * area));
  const rTotal = rConvHot + rLayers.reduce((a, b) => a + b, 0) + rConvCold;
  const q = (tHot - tCold) / rTotal;

  const nodeTemps: number[] = [tHot - q * rConvHot];
  for (let i = 0; i < rLayers.length; i += 1) {
    nodeTemps.push(nodeTemps[i]! - q * rLayers[i]!);
  }
  // Flux continuity: the last node must close back to the cold fluid exactly.
  return {
    rConvHot,
    rConvCold,
    rLayers,
    rTotal,
    q,
    qFlux: q / area,
    nodeTemps,
  };
}

/** Pure-conduction variant (fixed surface temperatures, no films): R = L/(k·A). */
export function solveWallFixedSurfaces(layers: WallLayer[], area: number, tHotSurf: number, tColdSurf: number): WallResult {
  const r = solveWall({
    layers,
    area,
    tHot: tHotSurf,
    tCold: tColdSurf,
    // h → ∞ drives the film resistance to zero; scale-invariant limit.
    hHot: 1e12 / Math.max(area, 1e-12),
    hCold: 1e12 / Math.max(area, 1e-12),
  });
  return r;
}

// ---- 2-D steady SOR (Laplace) ----------------------------------------------

/** Boundary condition of one rectangular-domain edge. */
export type EdgeBc =
  | { type: 'fixed'; t: number; /** Optional temperature profile along the edge, s ∈ [0,1]. */ profile?: (s: number) => number }
  | { type: 'conv'; h: number; tInf: number };

export interface SorInput {
  /** Domain size (m). */
  width: number;
  height: number;
  /** Grid points per axis (≥ 5). */
  nx: number;
  ny: number;
  /** Thermal conductivity (W/(m·K)) — scales the reported fluxes only. */
  k: number;
  left: EdgeBc;
  right: EdgeBc;
  bottom: EdgeBc;
  top: EdgeBc;
  /** Convergence tolerance on the max nodal update (K). Default 1e-8. */
  tolerance?: number;
  /** Iteration cap. Default 60·N². */
  maxIter?: number;
  /** Relaxation factor override (default: optimal 2/(1+sin(π/N))). */
  omega?: number;
}

export interface SorResult {
  T: Float64Array;
  nx: number;
  ny: number;
  iterations: number;
  /** Max |ΔT| of the final sweep (K). */
  residual: number;
  converged: boolean;
  omega: number;
  /** Integrated heat inflow through the hot boundary (W/m depth). */
  qIn: number;
  /** Integrated heat outflow through the cold boundary (W/m depth). */
  qOut: number;
  /** |qIn + qOut| imbalance (W/m depth) — global energy-balance check. */
  qImbalance: number;
}

function edgeTemp(bc: EdgeBc, s: number, interior: number, dx: number, k: number): number {
  if (bc.type === 'fixed') {
    return bc.profile ? bc.profile(s) : bc.t;
  }
  // Convective ghost-node form: h(T∞ − T_b) = k(T_b − T_int)/dx.
  const bi = (bc.h * dx) / k;
  return (bi * bc.tInf + interior) / (1 + bi);
}

/**
 * 2-D steady Laplace solve on a rectangle by SOR. Interior update is the
 * standard 5-point stencil; boundary nodes are refreshed every sweep from
 * their edge BC (isothermal / profile or convective ghost form).
 */
export function sorSolve2d(input: SorInput): SorResult {
  const nx = Math.max(5, Math.round(input.nx));
  const ny = Math.max(5, Math.round(input.ny));
  const { width, height, k } = input;
  if (!(width > 0) || !(height > 0)) throw new HeatXError('domain size must be > 0');
  if (!(k > 0)) throw new HeatXError('conductivity must be > 0');
  const dx = width / (nx - 1);
  const dy = height / (ny - 1);
  const tol = input.tolerance ?? 1e-8;
  const maxIter = input.maxIter ?? 60 * nx * ny;
  const nAvg = 0.5 * (nx + ny);
  const omega = input.omega ?? 2 / (1 + Math.sin(Math.PI / nAvg));
  if (!(omega > 1) || omega >= 2) throw new HeatXError('SOR omega must lie in (1, 2)');

  const T = new Float64Array(nx * ny);
  // Initial guess: mean of the fixed-edge temperatures (convective edges use tInf).
  const fixedTemps: number[] = [];
  const collect = (bc: EdgeBc): void => {
    if (bc.type === 'fixed') fixedTemps.push(bc.t);
    else fixedTemps.push(bc.tInf);
  };
  collect(input.left);
  collect(input.right);
  collect(input.bottom);
  collect(input.top);
  const tMean = fixedTemps.reduce((a, b) => a + b, 0) / fixedTemps.length;
  T.fill(tMean);

  const at = (ix: number, iy: number): number => T[iy * nx + ix]!;
  const setB = (ix: number, iy: number, v: number): void => {
    T[iy * nx + ix] = v;
  };

  const applyBoundaries = (): void => {
    for (let iy = 0; iy < ny; iy += 1) {
      const s = iy / (ny - 1);
      setB(0, iy, edgeTemp(input.left, s, at(1, iy), dx, k));
      setB(nx - 1, iy, edgeTemp(input.right, s, at(nx - 2, iy), dx, k));
    }
    for (let ix = 0; ix < nx; ix += 1) {
      const s = ix / (nx - 1);
      setB(ix, 0, edgeTemp(input.bottom, s, at(ix, 1), dy, k));
      setB(ix, ny - 1, edgeTemp(input.top, s, at(ix, ny - 2), dy, k));
    }
  };
  applyBoundaries();

  let iterations = 0;
  let residual = Number.POSITIVE_INFINITY;
  let converged = false;
  for (let iter = 1; iter <= maxIter; iter += 1) {
    let maxDelta = 0;
    for (let iy = 1; iy < ny - 1; iy += 1) {
      for (let ix = 1; ix < nx - 1; ix += 1) {
        const idx = iy * nx + ix;
        const gs = 0.5 * (at(ix - 1, iy) + at(ix + 1, iy) + at(ix, iy - 1) + at(ix, iy + 1));
        const next = at(ix, iy) + omega * (gs - at(ix, iy));
        T[idx] = next;
        maxDelta = Math.max(maxDelta, Math.abs(gs - next) * omega);
      }
    }
    applyBoundaries();
    iterations = iter;
    residual = maxDelta;
    if (maxDelta < tol) {
      converged = true;
      break;
    }
  }

  // Integrated boundary fluxes (per metre of depth): q = −k ∫ ∂T/∂n ds.
  let qIn = 0;
  let qOut = 0;
  for (let ix = 0; ix < nx; ix += 1) {
    // bottom edge: outward normal −y; top edge: +y.
    qIn += (k * (at(ix, 1) - at(ix, 0))) / dy * dx;
    qOut += (k * (at(ix, ny - 1) - at(ix, ny - 2))) / dy * dx;
  }
  for (let iy = 0; iy < ny; iy += 1) {
    qIn += (k * (at(1, iy) - at(0, iy))) / dx * dy;
    qOut += (k * (at(nx - 1, iy) - at(nx - 2, iy))) / dx * dy;
  }
  return {
    T,
    nx,
    ny,
    iterations,
    residual,
    converged,
    omega,
    qIn,
    qOut,
    qImbalance: Math.abs(qIn + qOut),
  };
}

/** Separation-of-variables reference: T = 0 on x=0, x=a, y=0; T = sin(πx/a) on y=b. */
export function separationOfVariablesRect(width: number, height: number, x: number, y: number): number {
  return (
    Math.sin((Math.PI * x) / width) *
    (Math.sinh((Math.PI * y) / width) / Math.sinh((Math.PI * height) / width))
  );
}

// ---- transient FTCS (1-D / 2-D) --------------------------------------------

/** FTCS stability ceiling: Σ_axes α·Δt/Δx² ≤ 1/2 (von Neumann). */
export const FTCS_LIMIT = 0.5;

export interface TransientInput {
  dim: '1d' | '2d';
  /** Thermal diffusivity α (m²/s). */
  alpha: number;
  /** Domain length along x (m). */
  length: number;
  /** Domain height along y (m), 2-D only. */
  height?: number;
  /** Grid points along x (≥ 9). */
  n: number;
  /** Time step (s). */
  dt: number;
  /** Dirichlet boundary temperatures (all four edges in 2-D). */
  tHot: number;
  tCold: number;
  /** Uniform initial temperature. */
  tInitial: number;
  /** Number of explicit steps. */
  steps: number;
}

export interface TransientResult {
  T: Float64Array;
  nx: number;
  ny: number;
  time: number;
  /** Summed courant number Σ α·Δt/Δx². */
  courant: number;
  /** Fourier number α·t/L² of the longest axis. */
  fourier: number;
}

/** Summed explicit-diffusion number of a transient configuration. */
export function ftcsCourant(p: TransientInput): number {
  const n = Math.max(9, Math.round(p.n));
  const dx = p.length / (n - 1);
  let r = (p.alpha * p.dt) / (dx * dx);
  if (p.dim === '2d') {
    const ny = n;
    const dy = (p.height ?? p.length) / (ny - 1);
    r += (p.alpha * p.dt) / (dy * dy);
  }
  return r;
}

/**
 * Run the explicit FTCS transient solve. Throws HeatXError when the von
 * Neumann gate r ≤ 1/2 (summed over axes) is violated — before any stepping.
 */
export function ftcsRun(p: TransientInput): TransientResult {
  if (!(p.alpha > 0)) throw new HeatXError('alpha must be > 0 m2/s');
  if (!(p.dt > 0)) throw new HeatXError('dt must be > 0 s');
  if (!(p.length > 0)) throw new HeatXError('domain length must be > 0');
  if (p.dim === '2d' && !((p.height ?? 0) > 0)) throw new HeatXError('2-D domain needs a height > 0');
  const courant = ftcsCourant(p);
  if (courant > FTCS_LIMIT * (1 + 1e-12)) {
    throw new HeatXError(`FTCS unstable: r = ${courant.toFixed(4)} > ${FTCS_LIMIT} — reduce dt or refine the grid`);
  }
  const n = Math.max(9, Math.round(p.n));
  const nx = n;
  const ny = p.dim === '2d' ? n : 1;
  const dx = p.length / (nx - 1);
  const dy = p.dim === '2d' ? (p.height ?? p.length) / (ny - 1) : 1;
  const rx = (p.alpha * p.dt) / (dx * dx);
  const ry = p.dim === '2d' ? (p.alpha * p.dt) / (dy * dy) : 0;

  let u = new Float64Array(nx * ny).fill(p.tInitial);
  let tmp = new Float64Array(nx * ny);
  // Dirichlet edges.
  for (let iy = 0; iy < ny; iy += 1) {
    u[iy * nx] = p.tCold;
    u[iy * nx + nx - 1] = p.dim === '2d' ? p.tCold : p.tHot;
  }
  if (p.dim === '2d') {
    for (let ix = 0; ix < nx; ix += 1) {
      u[ix] = p.tHot; // bottom edge hot
      u[(ny - 1) * nx + ix] = p.tCold; // top edge cold
    }
  }
  for (let s = 0; s < p.steps; s += 1) {
    if (p.dim === '1d') {
      for (let i = 1; i < nx - 1; i += 1) {
        tmp[i] = u[i]! + rx * (u[i - 1]! - 2 * u[i]! + u[i + 1]!);
      }
      tmp[0] = p.tCold;
      tmp[nx - 1] = p.tHot;
    } else {
      for (let iy = 1; iy < ny - 1; iy += 1) {
        for (let ix = 1; ix < nx - 1; ix += 1) {
          const idx = iy * nx + ix;
          tmp[idx] =
            u[idx]! +
            rx * (u[idx - 1]! - 2 * u[idx]! + u[idx + 1]!) +
            ry * (u[idx - nx]! - 2 * u[idx]! + u[idx + nx]!);
        }
      }
      for (let iy = 0; iy < ny; iy += 1) {
        tmp[iy * nx] = p.tCold;
        tmp[iy * nx + nx - 1] = p.tCold;
      }
      for (let ix = 0; ix < nx; ix += 1) {
        tmp[ix] = p.tHot;
        tmp[(ny - 1) * nx + ix] = p.tCold;
      }
    }
    const swap = u;
    u = tmp;
    tmp = swap;
  }
  const time = p.steps * p.dt;
  const lRef = p.dim === '2d' ? Math.max(p.length, p.height ?? 0) : p.length;
  return { T: u, nx, ny, time, courant, fourier: (p.alpha * time) / (lRef * lRef) };
}

/**
 * Fourier-series reference for the symmetric slab: uniform initial T_i, both
 * faces suddenly held at T_s. θ/θ_i = Σ_{m odd} (4/(mπ))·sin(mπx/L)·e^(−m²π²Fo).
 */
export function slabTransientSeries(x: number, length: number, alpha: number, t: number, ti: number, ts: number, terms = 200): number {
  const fo = (alpha * t) / (length * length);
  let theta = 0;
  for (let m = 1; m <= terms; m += 2) {
    const decay = Math.exp(-m * m * Math.PI * Math.PI * fo);
    if (decay < 1e-16) break;
    theta += (4 / (m * Math.PI)) * Math.sin((m * Math.PI * x) / length) * decay;
  }
  return ts + theta * (ti - ts);
}

// ==========================================================================
// Module 2 — convection (Nusselt correlations)
// ==========================================================================

export type ForcedCorrelation = 'dittus-boelter' | 'gnielinski';

export interface ForcedInput {
  correlation: ForcedCorrelation;
  /** Reynolds number (turbulent range Re ≳ 3000). */
  re: number;
  /** Prandtl number. */
  pr: number;
  /** true = fluid heated (n = 0.4), false = cooled (n = 0.3); D-B only. */
  heating: boolean;
  /** Fluid conductivity (W/(m·K)). */
  k: number;
  /** Tube inner diameter (m). */
  d: number;
}

export interface ForcedResult {
  nu: number;
  h: number;
}

/** Dittus–Boelter: Nu = 0.023·Re^0.8·Pr^n (valid ≈ 1e4 ≤ Re ≤ 1.2e5, 0.6 ≤ Pr ≤ 160). */
export function nusseltDittusBoelter(re: number, pr: number, heating: boolean): number {
  if (!(re > 0)) throw new HeatXError('Re must be > 0');
  if (!(pr > 0)) throw new HeatXError('Pr must be > 0');
  const n = heating ? 0.4 : 0.3;
  return 0.023 * Math.pow(re, 0.8) * Math.pow(pr, n);
}

/**
 * Gnielinski (with Petukhov friction factor): fully developed turbulent
 * duct flow, valid 3000 < Re < 5e6 and 0.5 < Pr < 2000.
 */
export function nusseltGnielinski(re: number, pr: number): number {
  if (!(re > 3000)) throw new HeatXError('Gnielinski requires Re > 3000');
  if (!(pr > 0)) throw new HeatXError('Pr must be > 0');
  const f = Math.pow(0.79 * Math.log(re) - 1.64, -2);
  const sqrtF8 = Math.sqrt(f / 8);
  const numerator = (f / 8) * (re - 1000) * pr;
  const denominator = 1 + 12.7 * sqrtF8 * (Math.pow(pr, 2 / 3) - 1);
  return numerator / denominator;
}

export function nusseltForced(input: ForcedInput): ForcedResult {
  const nu =
    input.correlation === 'dittus-boelter'
      ? nusseltDittusBoelter(input.re, input.pr, input.heating)
      : nusseltGnielinski(input.re, input.pr);
  if (!(input.d > 0) || !(input.k > 0)) throw new HeatXError('diameter and conductivity must be > 0');
  return { nu, h: (nu * input.k) / input.d };
}

export type NaturalGeometry = 'vertical-plate' | 'horizontal-cylinder';

export interface NaturalInput {
  geometry: NaturalGeometry;
  /** Prandtl number. */
  pr: number;
  /** Kinematic viscosity ν (m²/s). */
  nu: number;
  /** Thermal diffusivity α (m²/s). */
  alpha: number;
  /** Film temperature expansion coefficient β ≈ 1/T_film (1/K). */
  beta: number;
  /** Characteristic length: plate height L or cylinder diameter D (m). */
  length: number;
  /** |T_surface − T∞| (K). */
  dT: number;
  /** Fluid conductivity (W/(m·K)). */
  k: number;
  /** Gravity override (m/s²). */
  g?: number;
}

export interface NaturalResult {
  ra: number;
  nu: number;
  h: number;
}

/** Rayleigh number Ra = g·β·ΔT·L³/(ν·α). */
export function rayleighNumber(input: Omit<NaturalInput, 'geometry' | 'k'>): number {
  const g = input.g ?? G_GRAVITY;
  if (!(input.length > 0)) throw new HeatXError('characteristic length must be > 0');
  if (!(input.nu > 0) || !(input.alpha > 0)) throw new HeatXError('nu/alpha must be > 0');
  if (!(input.dT > 0)) throw new HeatXError('dT must be > 0');
  return (g * input.beta * input.dT * Math.pow(input.length, 3)) / (input.nu * input.alpha);
}

/**
 * Churchill & Chu (1975), all-Ra correlation.
 * Vertical plate:  Nu = [0.825 + 0.387·Ra^{1/6} / (1 + (0.492/Pr)^{9/16})^{8/27}]².
 * Horizontal cylinder: same form with 0.60 and 0.559.
 */
export function nusseltNatural(input: NaturalInput): NaturalResult {
  if (!(input.pr > 0)) throw new HeatXError('Pr must be > 0');
  const ra = rayleighNumber(input);
  const isPlate = input.geometry === 'vertical-plate';
  const a0 = isPlate ? 0.825 : 0.6;
  const cPr = isPlate ? 0.492 : 0.559;
  const denom = Math.pow(1 + Math.pow(cPr / input.pr, 9 / 16), 8 / 27);
  const nu = Math.pow(a0 + (0.387 * Math.pow(ra, 1 / 6)) / denom, 2);
  return { ra, nu, h: (nu * input.k) / input.length };
}

// ==========================================================================
// Module 3 — radiation
// ==========================================================================

/** Blackbody total emissive power E_b = σ·T⁴ (W/m²). */
export function blackbodyEmittance(tK: number): number {
  if (!(tK > 0)) throw new HeatXError('temperature must be > 0 K');
  return STEFAN_BOLTZMANN * Math.pow(tK, 4);
}

/** Wien displacement peak wavelength λmax = 2897.77 µm·K / T (µm). */
export function wienPeakWavelength(tK: number): number {
  if (!(tK > 0)) throw new HeatXError('temperature must be > 0 K');
  return WIEN_UM_K / tK;
}

/**
 * Planck spectral blackbody emissive power E_bλ (W/(m²·µm)):
 *   E_bλ = C₁ / λ⁵ / (exp(C₂/(λT)) − 1), λ in µm, T in K.
 */
export function planckSpectral(lambdaUm: number, tK: number): number {
  if (!(lambdaUm > 0) || !(tK > 0)) throw new HeatXError('lambda and T must be > 0');
  return PLANCK_C1 / (Math.pow(lambdaUm, 5) * (Math.exp(PLANCK_C2 / (lambdaUm * tK)) - 1));
}

export interface PlanckPoint {
  lambdaUm: number;
  /** E_bλ (W/(m²·µm)). */
  e: number;
}

/** Sampled Planck spectral curve for plotting (uniform λ grid). */
export function planckCurve(tK: number, lambdaStartUm: number, lambdaEndUm: number, n = 240): PlanckPoint[] {
  const pts: PlanckPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const lambdaUm = lambdaStartUm + ((lambdaEndUm - lambdaStartUm) * i) / (n - 1);
    pts.push({ lambdaUm, e: planckSpectral(lambdaUm, tK) });
  }
  return pts;
}

// ---- view factors -----------------------------------------------------------

export type ViewFactorGeometry = 'parallel-plates' | 'coaxial-disks';

export interface ViewFactorInput {
  geometry: ViewFactorGeometry;
  /** Coaxial disks only: radii (m) and axial separation (m). */
  r1?: number;
  r2?: number;
  separation?: number;
}

/**
 * Diffuse view factor F₁₂:
 *   large facing parallel plates → 1 (aligned infinite surfaces);
 *   coaxial parallel disks (Incropera Table 13.1):
 *     R_i = r_i/L, R_j = r_j/L, S = 1 + (1 + R_j²)/R_i²,
 *     F₁₂ = ½·(S − √(S² − 4·(R_j/R_i)²)).
 */
export function viewFactor(input: ViewFactorInput): number {
  if (input.geometry === 'parallel-plates') return 1;
  const { r1, r2, separation } = input;
  if (!(r1 && r1 > 0) || !(r2 && r2 > 0) || !(separation && separation > 0)) {
    throw new HeatXError('coaxial disks need r1, r2, separation > 0');
  }
  const ri = r1 / separation;
  const rj = r2 / separation;
  const s = 1 + (1 + rj * rj) / (ri * ri);
  const ratioSq = (rj / ri) * (rj / ri);
  const f = 0.5 * (s - Math.sqrt(s * s - 4 * ratioSq));
  return Math.min(1, Math.max(0, f));
}

export interface EnclosureInput extends ViewFactorInput {
  /** Surface temperatures (K). */
  t1: number;
  t2: number;
  /** Hemispherical emissivities ∈ (0, 1]. */
  eps1: number;
  eps2: number;
  /** Surface areas (m²). */
  area1: number;
  area2: number;
}

export interface EnclosureResult {
  f12: number;
  /** Surface resistance (1−ε)/(ε·A) of each surface (1/W). */
  rSurf1: number;
  rSurf2: number;
  /** Space resistance 1/(A₁·F₁₂) (1/W). */
  rSpace: number;
  /** Net radiative exchange q = σ(T₁⁴ − T₂⁴)/ΣR (W). */
  q: number;
}

/**
 * Gray diffuse two-surface enclosure network:
 *   q = σ(T₁⁴ − T₂⁴) / [ (1−ε₁)/(ε₁A₁) + 1/(A₁F₁₂) + (1−ε₂)/(ε₂A₂) ].
 */
export function enclosureExchange(input: EnclosureInput): EnclosureResult {
  for (const [name, eps] of [
    ['eps1', input.eps1],
    ['eps2', input.eps2],
  ] as const) {
    if (!(eps > 0) || eps > 1) throw new HeatXError(`${name} must lie in (0, 1]`);
  }
  if (!(input.area1 > 0) || !(input.area2 > 0)) throw new HeatXError('areas must be > 0');
  if (!(input.t1 > 0) || !(input.t2 > 0)) throw new HeatXError('temperatures must be > 0 K');
  const f12 = viewFactor(input);
  const rSurf1 = (1 - input.eps1) / (input.eps1 * input.area1);
  const rSurf2 = (1 - input.eps2) / (input.eps2 * input.area2);
  const rSpace = 1 / (input.area1 * f12);
  const q = (STEFAN_BOLTZMANN * (Math.pow(input.t1, 4) - Math.pow(input.t2, 4))) / (rSurf1 + rSpace + rSurf2);
  return { f12, rSurf1, rSurf2, rSpace, q };
}

// ---- combined convection + radiation ---------------------------------------

/** Linearized radiation coefficient h_rad = ε·σ·(Ts² + Tsur²)(Ts + Tsur) (W/(m²·K)). */
export function radiationCoefficient(tSurfK: number, tSurroundingsK: number, eps: number): number {
  if (!(eps > 0) || eps > 1) throw new HeatXError('emissivity must lie in (0, 1]');
  if (tSurfK <= 0 || tSurroundingsK <= 0) throw new HeatXError('temperatures must be > 0 K');
  return (
    eps *
    STEFAN_BOLTZMANN *
    (tSurfK * tSurfK + tSurroundingsK * tSurroundingsK) *
    (tSurfK + tSurroundingsK)
  );
}

export interface CombinedInput {
  /** Surface temperature (K). */
  tSurf: number;
  /** Fluid temperature for convection (K). */
  tFluid: number;
  /** Surroundings temperature for radiation (K). */
  tSurroundings: number;
  /** Convection coefficient (W/(m²·K)). */
  hConv: number;
  /** Surface emissivity. */
  eps: number;
  /** Area (m²). */
  area: number;
}

export interface CombinedResult {
  qConv: number;
  qRad: number;
  qTotal: number;
  hConv: number;
  hRad: number;
  hTotal: number;
}

/** Combined convection (to fluid) + net radiation (to surroundings). */
export function combinedSurfaceExchange(input: CombinedInput): CombinedResult {
  if (!(input.area > 0)) throw new HeatXError('area must be > 0');
  if (!(input.hConv >= 0)) throw new HeatXError('hConv must be ≥ 0');
  const hRad = radiationCoefficient(input.tSurf, input.tSurroundings, input.eps);
  const qConv = input.hConv * input.area * (input.tSurf - input.tFluid);
  const qRad = hRad * input.area * (input.tSurf - input.tSurroundings);
  return {
    qConv,
    qRad,
    qTotal: qConv + qRad,
    hConv: input.hConv,
    hRad,
    hTotal: input.hConv + hRad,
  };
}

// ==========================================================================
// Module 4 — heat exchanger (LMTD ↔ ε-NTU)
// ==========================================================================

export type ExchangerArrangement = 'counter' | 'parallel' | 'shell-tube' | 'crossflow';

export interface ExchangerSpec {
  arrangement: ExchangerArrangement;
  /** Inlet temperatures (K or °C — differences only). */
  thIn: number;
  tcIn: number;
  /** Capacity rates (W/K). */
  ch: number;
  cc: number;
  /** Overall conductance U·A (W/K). */
  ua: number;
  /** Shell-tube only: number of tube passes (approximated as 1 shell pass / n tube passes). */
  tubePasses?: number;
  /** Cross-flow only: which capacity stream is mixed. */
  crossflowMixed?: 'hot' | 'cold';
}

export interface LmtdResult {
  q: number;
  dT1: number;
  dT2: number;
  dTlm: number;
  /** Required U·A = q/ΔT_lm (W/K). */
  uaRequired: number;
}

/**
 * LMTD method from known outlet temperatures (counter/parallel flow):
 * q = C_h(T_h,i − T_h,o) = C_c(T_c,o − T_c,i), ΔT_lm = (ΔT₁ − ΔT₂)/ln(ΔT₁/ΔT₂).
 */
export function lmtdMethod(
  spec: Pick<ExchangerSpec, 'arrangement' | 'thIn' | 'tcIn' | 'ch' | 'cc'> & { thOut: number; tcOut: number },
): LmtdResult {
  const { thIn, thOut, tcIn, tcOut, ch, cc } = spec;
  if (!(ch > 0) || !(cc > 0)) throw new HeatXError('capacity rates must be > 0 W/K');
  const qh = ch * (thIn - thOut);
  const qc = cc * (tcOut - tcIn);
  if (Math.abs(qh - qc) > 1e-6 * Math.max(1, Math.abs(qh))) {
    throw new HeatXError('outlet temperatures violate the energy balance q_h = q_c');
  }
  const q = 0.5 * (qh + qc);
  let dT1: number;
  let dT2: number;
  if (spec.arrangement === 'parallel') {
    dT1 = thIn - tcIn;
    dT2 = thOut - tcOut;
  } else {
    dT1 = thIn - tcOut;
    dT2 = thOut - tcIn;
  }
  if (dT1 <= 0 || dT2 <= 0) throw new HeatXError('non-positive terminal temperature difference');
  const dTlm = Math.abs(dT1 - dT2) < 1e-9 * Math.max(dT1, dT2) ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  return { q, dT1, dT2, dTlm, uaRequired: q / dTlm };
}

/** ε-NTU effectiveness of the configured arrangement (Incropera Table 11.4 forms). */
export function exchangerEffectiveness(spec: ExchangerSpec, ntu: number, cr: number): number {
  if (!(ntu >= 0)) throw new HeatXError('NTU must be ≥ 0');
  if (!(cr >= 0) || cr > 1) throw new HeatXError('Cr must lie in [0, 1]');
  if (ntu === 0) return 0;
  if (cr < 1e-10) return 1 - Math.exp(-ntu); // phase-change / Cmax → ∞ limit
  switch (spec.arrangement) {
    case 'counter':
      if (Math.abs(cr - 1) < 1e-10) return ntu / (1 + ntu);
      return (1 - Math.exp(-ntu * (1 - cr))) / (1 - cr * Math.exp(-ntu * (1 - cr)));
    case 'parallel':
      return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
    case 'shell-tube': {
      // 1 shell pass, 2/4/…n tube passes closed form (Γ = √(1+Cr²)).
      const gamma = Math.sqrt(1 + cr * cr);
      const e = Math.exp(-ntu * gamma);
      return 2 / (1 + cr + gamma * ((1 + e) / (1 - e)));
    }
    case 'crossflow':
      // Single-pass cross-flow with one stream mixed (role resolved below).
      return crossflowEps(ntu, cr, mixedRole(spec));
    default:
      throw new HeatXError('unknown exchanger arrangement');
  }
}

/**
 * Cross-flow single-pass with one stream mixed (Incropera Table 11.4):
 *   Cmax mixed, Cmin unmixed: ε = 1 − exp[−(1/Cr)(1 − exp(−Cr·NTU))];
 *   Cmin mixed, Cmax unmixed: ε = (1/Cr)·[1 − exp(−Cr·(1 − exp(−NTU)))].
 */
export function crossflowEps(ntu: number, cr: number, mixed: 'min' | 'max'): number {
  if (cr < 1e-10) return 1 - Math.exp(-ntu);
  if (mixed === 'max') {
    return 1 - Math.exp(-(1 / cr) * (1 - Math.exp(-cr * ntu)));
  }
  return (1 / cr) * (1 - Math.exp(-cr * (1 - Math.exp(-ntu))));
}

/** Which capacity stream is mixed, expressed as 'min' | 'max'. */
export function mixedRole(spec: Pick<ExchangerSpec, 'ch' | 'cc' | 'crossflowMixed'>): 'min' | 'max' {
  const mixed = spec.crossflowMixed ?? 'hot';
  const hotIsMin = spec.ch <= spec.cc;
  const mixedIsHot = mixed === 'hot';
  return mixedIsHot === hotIsMin ? 'min' : 'max';
}

export interface EpsNtuResult {
  q: number;
  thOut: number;
  tcOut: number;
  epsilon: number;
  ntu: number;
  cr: number;
  cmin: number;
  cmax: number;
  qMax: number;
}

/** ε-NTU method from inlet states + U·A. */
export function epsilonNtuMethod(spec: ExchangerSpec): EpsNtuResult {
  if (!(spec.ua > 0)) throw new HeatXError('U·A must be > 0 W/K');
  if (!(spec.ch > 0) || !(spec.cc > 0)) throw new HeatXError('capacity rates must be > 0 W/K');
  const cmin = Math.min(spec.ch, spec.cc);
  const cmax = Math.max(spec.ch, spec.cc);
  const cr = cmin / cmax;
  const ntu = spec.ua / cmin;
  const epsilon = exchangerEffectiveness(spec, ntu, cr);
  const qMax = cmin * (spec.thIn - spec.tcIn);
  const q = epsilon * qMax;
  return {
    q,
    thOut: spec.thIn - q / spec.ch,
    tcOut: spec.tcIn + q / spec.cc,
    epsilon,
    ntu,
    cr,
    cmin,
    cmax,
    qMax,
  };
}

export interface CrossValidation {
  qEpsNtu: number;
  qLmtd: number;
  /** |q_LMTD − q_εNTU| / q_εNTU. */
  relDiff: number;
  dTlm: number;
  uaRequired: number;
}

/**
 * Cross-validate the two design methods: solve with ε-NTU, then re-derive q
 * from the LMTD method on the resulting outlet temperatures. Mathematically
 * exact for counter/parallel flow (the residual is pure round-off).
 */
export function crossValidateMethods(spec: ExchangerSpec): CrossValidation {
  if (spec.arrangement !== 'counter' && spec.arrangement !== 'parallel') {
    throw new HeatXError('LMTD ↔ ε-NTU cross-validation applies to counter/parallel flow (others need the F correction)');
  }
  const eps = epsilonNtuMethod(spec);
  const lmtd = lmtdMethod({
    arrangement: spec.arrangement,
    thIn: spec.thIn,
    tcIn: spec.tcIn,
    thOut: eps.thOut,
    tcOut: eps.tcOut,
    ch: spec.ch,
    cc: spec.cc,
  });
  return {
    qEpsNtu: eps.q,
    qLmtd: lmtd.q,
    relDiff: Math.abs(lmtd.q - eps.q) / Math.abs(eps.q || 1),
    dTlm: lmtd.dTlm,
    uaRequired: lmtd.uaRequired,
  };
}

// ==========================================================================
// Module 5 — 1-D thermal-resistance network
// ==========================================================================

export interface NetworkEdge {
  from: number;
  to: number;
  /** Resistance (K/W). */
  r: number;
  /** Optional label for reporting/drawing. */
  label?: string;
}

export interface NetworkSpec {
  /** Node count; nodes are 0-based. */
  nNodes: number;
  /** Fixed-temperature (Dirichlet) nodes, node index → temperature. */
  fixed: Record<number, number>;
  edges: NetworkEdge[];
}

export interface NetworkResult {
  /** Nodal temperatures (all nodes; fixed ones copied through). */
  t: number[];
  /** Flow through each edge, positive from→to (W). */
  edgeFlow: number[];
  /** Max |Σq| over free nodes — Kirchhoff current-law residual (W). */
  kirchhoffMax: number;
  /** Equivalent resistance seen between the hottest and coldest fixed node. */
  rEquivalent: number;
  /** Total heat admitted by the hot fixed node(s) (W). */
  qTotal: number;
}

/**
 * Thermal-resistance network nodal solve. For each free node i Kirchhoff's
 * law Σ_j (T_j − T_i)/R_ij = 0 gives a linear system
 *   G·T_free = b,  G_ii = Σ 1/R,  G_ij = −1/R,  b_i = Σ T_fixed/R,
 * solved by Gaussian elimination with partial pivoting.
 */
export function solveNetwork(spec: NetworkSpec): NetworkResult {
  const n = spec.nNodes;
  if (n < 2) throw new HeatXError('network needs ≥ 2 nodes');
  const fixedEntries = Object.entries(spec.fixed);
  if (fixedEntries.length < 1) throw new HeatXError('network needs at least one fixed-temperature node');
  for (const [k, v] of fixedEntries) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) throw new HeatXError(`fixed node ${k} out of range`);
    if (!Number.isFinite(v)) throw new HeatXError('fixed temperatures must be finite');
  }
  if (spec.edges.length === 0) throw new HeatXError('network needs at least one edge');
  for (let e = 0; e < spec.edges.length; e += 1) {
    const edge = spec.edges[e]!;
    if (!(edge.r > 0)) throw new HeatXError(`edge ${e}: resistance must be > 0`);
    if (edge.from < 0 || edge.from >= n || edge.to < 0 || edge.to >= n) {
      throw new HeatXError(`edge ${e}: node index out of range`);
    }
  }

  const free: number[] = [];
  for (let i = 0; i < n; i += 1) if (spec.fixed[i] === undefined) free.push(i);
  const indexOf = new Map<number, number>();
  free.forEach((node, i) => indexOf.set(node, i));
  const m = free.length;

  // Dense conductance matrix + RHS.
  const a: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b: number[] = new Array<number>(m).fill(0);
  for (const edge of spec.edges) {
    const g = 1 / edge.r;
    const fi = indexOf.get(edge.from);
    const ti = indexOf.get(edge.to);
    if (fi !== undefined && ti !== undefined) {
      a[fi]![fi]! += g;
      a[ti]![ti]! += g;
      a[fi]![ti]! -= g;
      a[ti]![fi]! -= g;
    } else if (fi !== undefined) {
      // to is fixed.
      a[fi]![fi]! += g;
      b[fi]! += g * spec.fixed[edge.to]!;
    } else if (ti !== undefined) {
      a[ti]![ti]! += g;
      b[ti]! += g * spec.fixed[edge.from]!;
    }
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < m; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < m; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-14) {
      throw new HeatXError('singular network — a free node has no conducting path to a fixed node');
    }
    if (pivot !== col) {
      const swap = a[pivot]!;
      a[pivot] = a[col]!;
      a[col] = swap;
      const bt = b[pivot]!;
      b[pivot] = b[col]!;
      b[col] = bt;
    }
    for (let row = col + 1; row < m; row += 1) {
      const factor = a[row]![col]! / a[col]![col]!;
      if (factor === 0) continue;
      for (let c2 = col; c2 < m; c2 += 1) a[row]![c2]! -= factor * a[col]![c2]!;
      b[row]! -= factor * b[col]!;
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let row = m - 1; row >= 0; row -= 1) {
    let acc = b[row]!;
    for (let c2 = row + 1; c2 < m; c2 += 1) acc -= a[row]![c2]! * x[c2]!;
    x[row] = acc / a[row]![row]!;
  }

  const t = new Array<number>(n).fill(0);
  for (const [k, v] of fixedEntries) t[Number(k)] = v;
  free.forEach((node, i) => {
    t[node] = x[i]!;
  });

  const edgeFlow = spec.edges.map((edge) => (t[edge.from]! - t[edge.to]!) / edge.r);
  const kirchhoff = new Array<number>(n).fill(0);
  for (let e = 0; e < spec.edges.length; e += 1) {
    const edge = spec.edges[e]!;
    kirchhoff[edge.from]! += edgeFlow[e]!; // outflow
    kirchhoff[edge.to]! -= edgeFlow[e]!; // inflow
  }
  let kirchhoffMax = 0;
  for (const node of free) kirchhoffMax = Math.max(kirchhoffMax, Math.abs(kirchhoff[node]!));

  // Equivalent resistance between the hottest and coldest fixed nodes.
  let tHotFixed = -Infinity;
  let tColdFixed = Infinity;
  for (const [, v] of fixedEntries) {
    tHotFixed = Math.max(tHotFixed, v);
    tColdFixed = Math.min(tColdFixed, v);
  }
  // Net heat leaving the hottest fixed node(s) along incident edges.
  let qTotal = 0;
  for (const [k, v] of fixedEntries) {
    if (v !== tHotFixed) continue;
    const node = Number(k);
    for (let e = 0; e < spec.edges.length; e += 1) {
      const edge = spec.edges[e]!;
      if (edge.from === node) qTotal += edgeFlow[e]!;
      if (edge.to === node) qTotal -= edgeFlow[e]!;
    }
  }
  const rEquivalent = Math.abs(tHotFixed - tColdFixed) / Math.abs(qTotal || 1);
  return { t, edgeFlow, kirchhoffMax, rEquivalent, qTotal };
}

/** Radiation edge resistance R = 1/(h_rad·A) (K/W) built on the linearized h_rad. */
export function radiationResistance(tSurfK: number, tSurroundingsK: number, eps: number, area: number): number {
  const h = radiationCoefficient(tSurfK, tSurroundingsK, eps);
  if (!(area > 0)) throw new HeatXError('area must be > 0');
  return 1 / (h * area);
}
