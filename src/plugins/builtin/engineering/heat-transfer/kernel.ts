// ==========================================================================
// eng-heat kernel — heat-transfer numeric core.
// Pure numeric module: no DOM, no plugin-framework, no cross-plugin imports.
//
// Five solvers (one per workbench mode):
//   1. 2-D conduction  — explicit FTCS or Peaceman-Rachford ADI finite
//      differences on a rectangular plate with Dirichlet / insulated (zero
//      Neumann) / convective (Robin) edges and an optional circular volumetric
//      hot-spot source; steady state reached by time marching to a residual
//      gate. Includes marching-squares isotherm extraction.
//   2. Convection      — forced external flat plate (laminar / mixed-turbulent),
//      forced internal tube (fully-developed laminar + Dittus-Boelter) and
//      natural vertical plate (Churchill-Chu) with regime classification.
//   3. Radiation       — Stefan-Boltzmann emission, Wien peak, Planck spectral
//      curve, gray two-surface network with closed-form view factors for
//      aligned parallel rectangles and coaxial parallel disks.
//   4. Heat exchanger  — LMTD and effectiveness-NTU methods with mutual
//      cross-validation and closed-form axial temperature profiles.
//   5. Resistance      — series/parallel composite wall with convection films,
//      interface node temperatures.
//
// References: Incropera, DeWitt, Bergman & Lavine, "Fundamentals of Heat and
// Mass Transfer" (correlations, view factors, LMTD / eps-NTU); Peaceman &
// Rachford (1955) ADI; Churchil & Chu (1975); CODATA 2018 Stefan-Boltzmann
// constant. All computations are deterministic.
// ==========================================================================

// ---- constants -------------------------------------------------------------

/** CODATA 2018 Stefan-Boltzmann constant (W / m2 K4). */
export const STEFAN_BOLTZMANN = 5.670374419e-8;
/** Wien displacement constant b = lambda_max * T (m K). */
export const WIEN_CONSTANT = 2.897771955e-3;
/** Planck first radiation constant 2 pi h c^2 (W m2). */
export const PLANCK_C1 = 3.741771e-16;
/** Planck second radiation constant h c / k_B (m K). */
export const PLANCK_C2 = 1.438777e-2;
/** Standard gravity (m/s2). */
export const G_ACC = 9.80665;

/** Raised for invalid parameters or solver limits. */
export class HeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeatError';
  }
}

// ---- mode 1: 2-D conduction -------------------------------------------------

export type EdgeKind = 'dirichlet' | 'insulated' | 'convection';

export interface EdgeSpec {
  kind: EdgeKind;
  /** Dirichlet temperature (K); ignored for the other kinds. */
  value: number;
}

export interface SourceSpec {
  enabled: boolean;
  /** Center position as a fraction of W / H (0..1). */
  cx: number;
  cy: number;
  /** Radius as a fraction of the plate diagonal scale (0..0.5). */
  r: number;
  /** Volumetric source strength q''' (W/m3). */
  q: number;
}

export interface ConductionParams {
  /** Plate width (x, m). */
  W: number;
  /** Plate height (y, m). */
  H: number;
  /** Nodes in x (8..128). */
  nx: number;
  /** Nodes in y (8..128). */
  ny: number;
  /** Thermal diffusivity alpha = k / (rho c) (m2/s). */
  alpha: number;
  /** Thermal conductivity (W/(m K)) — used for fluxes and Robin BCs. */
  k: number;
  edges: { left: EdgeSpec; right: EdgeSpec; top: EdgeSpec; bottom: EdgeSpec };
  /** Shared convective-film coefficient for 'convection' edges (W/(m2 K)). */
  hConv: number;
  /** Ambient temperature for 'convection' edges (K). */
  tInf: number;
  source: SourceSpec;
  scheme: 'explicit' | 'adi';
  runMode: 'steady' | 'transient';
  /** End time for transient runs (s). */
  tEnd: number;
  /** Time step (s); 0 = automatic (stability-limited for explicit). */
  dt: number;
  /** Optional uniform initial temperature (K); default: tInf, else mean of the Dirichlet values. */
  initT?: number;
}

export interface ConductionResult {
  nx: number;
  ny: number;
  /** Row-major temperature field, T[j * nx + i], j = 0 is y = 0. */
  T: Float64Array;
  /** Physical time reached (s). */
  time: number;
  iterations: number;
  /** Max |delta T| of the last iteration (K). */
  residual: number;
  converged: boolean;
  maxT: number;
  minT: number;
  meanT: number;
  dtUsed: number;
  /** Courant numbers rx = alpha dt / dx^2, ry = alpha dt / dy^2. */
  rx: number;
  ry: number;
}

const MAX_GRID = 128;
const MAX_STEPS = 20_000;
const MAX_ITER_STEADY = 300_000;

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.round(Number.isFinite(v) ? v : lo);
  return Math.min(hi, Math.max(lo, n));
}

function edgeOf(e: EdgeSpec, name: string): EdgeSpec {
  const kind = e?.kind;
  if (kind !== 'dirichlet' && kind !== 'insulated' && kind !== 'convection') {
    throw new HeatError(`${name} edge kind must be dirichlet | insulated | convection`);
  }
  if (kind === 'dirichlet' && !Number.isFinite(e.value)) {
    throw new HeatError(`${name} edge needs a finite Dirichlet temperature`);
  }
  return e;
}

export function validateConduction(p: ConductionParams): void {
  if (!(p.W > 0) || !(p.H > 0)) throw new HeatError('plate W and H must be > 0 m');
  if (!(p.alpha > 0)) throw new HeatError('alpha must be > 0 m2/s');
  if (!(p.k > 0)) throw new HeatError('k must be > 0 W/(m K)');
  edgeOf(p.edges.left, 'left');
  edgeOf(p.edges.right, 'right');
  edgeOf(p.edges.top, 'top');
  edgeOf(p.edges.bottom, 'bottom');
  if (p.edges.left.kind === 'convection' || p.edges.right.kind === 'convection' || p.edges.top.kind === 'convection' || p.edges.bottom.kind === 'convection') {
    if (!(p.hConv > 0)) throw new HeatError('hConv must be > 0 for convection edges');
    if (!Number.isFinite(p.tInf)) throw new HeatError('tInf must be finite for convection edges');
  }
  if (p.source.enabled) {
    if (!Number.isFinite(p.source.q) || p.source.q < 0) throw new HeatError("source q''' must be finite and >= 0");
    const allBlocked =
      p.edges.left.kind === 'insulated' && p.edges.right.kind === 'insulated' &&
      p.edges.top.kind === 'insulated' && p.edges.bottom.kind === 'insulated';
    if (allBlocked && p.source.q > 0) throw new HeatError('volumetric source needs a sink (Dirichlet or convection edge)');
  }
  if (p.runMode === 'transient' && !(p.tEnd > 0)) throw new HeatError('tEnd must be > 0 s for transient runs');
  if (p.dt < 0) throw new HeatError('dt must be >= 0 (0 = automatic)');
}

/** Source indicator: true inside the circular hot-spot region. */
function inSource(p: ConductionParams, x: number, y: number): boolean {
  if (!p.source.enabled || p.source.q === 0) return false;
  const dx = (x / p.W - p.source.cx) * p.W;
  const dy = (y / p.H - p.source.cy) * p.H;
  const r = p.source.r * Math.min(p.W, p.H);
  return dx * dx + dy * dy <= r * r;
}

/** Deterministic initial field: Dirichlet edges set, interior = mild default. */
function initField(p: ConductionParams, nx: number, ny: number): Float64Array {
  const T = new Float64Array(nx * ny);
  let seed = p.initT ?? p.tInf;
  if (!Number.isFinite(seed)) {
    const vals: number[] = [];
    if (p.edges.left.kind === 'dirichlet') vals.push(p.edges.left.value);
    if (p.edges.right.kind === 'dirichlet') vals.push(p.edges.right.value);
    if (p.edges.top.kind === 'dirichlet') vals.push(p.edges.top.value);
    if (p.edges.bottom.kind === 'dirichlet') vals.push(p.edges.bottom.value);
    seed = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 300;
  }
  T.fill(seed);
  const dx = p.W / (nx - 1);
  const dy = p.H / (ny - 1);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (inSource(p, i * dx, j * dy)) T[j * nx + i] = seed + 1; // tiny deterministic perturbation
    }
  }
  applyBoundary(p, T, nx, ny, dx, dy, p.tInf);
  return T;
}

/** Apply all edge conditions (explicit / post-step). */
function applyBoundary(p: ConductionParams, T: Float64Array, nx: number, ny: number, dx: number, dy: number, tInf: number): void {
  const bi = (d: number): number => (p.hConv * d) / p.k; // cell Biot h*d/k
  const robin = (neighbor: number, d: number): number => (neighbor + bi(d) * tInf) / (1 + bi(d));
  for (let i = 0; i < nx; i += 1) {
    // bottom (j = 0)
    if (p.edges.bottom.kind === 'dirichlet') T[i] = p.edges.bottom.value;
    else if (p.edges.bottom.kind === 'insulated') T[i] = T[nx + i]!;
    else T[i] = robin(T[nx + i]!, dy);
    // top (j = ny-1)
    const t = (ny - 1) * nx + i;
    if (p.edges.top.kind === 'dirichlet') T[t] = p.edges.top.value;
    else if (p.edges.top.kind === 'insulated') T[t] = T[(ny - 2) * nx + i]!;
    else T[t] = robin(T[(ny - 2) * nx + i]!, dy);
  }
  // Side columns applied last: a Dirichlet side wins at the corners it shares.
  for (let j = 0; j < ny; j += 1) {
    const l = j * nx;
    if (p.edges.left.kind === 'dirichlet') T[l] = p.edges.left.value;
    else if (p.edges.left.kind === 'insulated') T[l] = T[l + 1]!;
    else T[l] = robin(T[l + 1]!, dx);
    const r = j * nx + nx - 1;
    if (p.edges.right.kind === 'dirichlet') T[r] = p.edges.right.value;
    else if (p.edges.right.kind === 'insulated') T[r] = T[r - 1]!;
    else T[r] = robin(T[r - 1]!, dx);
  }
}

/** One explicit FTCS step (T <- new array; `tmp` reused). */
function explicitStep(p: ConductionParams, T: Float64Array, nx: number, ny: number, dx: number, dy: number, rx: number, ry: number, dt: number, tmp: Float64Array): void {
  const srcRate = p.source.enabled ? (p.source.q * p.alpha) / p.k : 0;
  for (let j = 1; j < ny - 1; j += 1) {
    for (let i = 1; i < nx - 1; i += 1) {
      const c = j * nx + i;
      const lap = rx * (T[c - 1]! - 2 * T[c]! + T[c + 1]!) + ry * (T[c - nx]! - 2 * T[c]! + T[c + nx]!);
      let v = T[c]! + lap;
      if (srcRate !== 0 && inSource(p, i * dx, j * dy)) v += srcRate * dt;
      tmp[c] = v;
    }
  }
  tmp.set(T.subarray(0, nx), 0); // keep the old bottom row readable during the swap
  applyBoundary(p, tmp, nx, ny, dx, dy, p.tInf);
}

/** Thomas algorithm solve of a tridiagonal system in place. */
function thomas(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array, n: number): void {
  for (let i = 1; i < n; i += 1) {
    const m = a[i]! / b[i - 1]!;
    b[i] = b[i]! - m * c[i - 1]!;
    d[i] = d[i]! - m * d[i - 1]!;
  }
  d[n - 1] = d[n - 1]! / b[n - 1]!;
  for (let i = n - 2; i >= 0; i -= 1) d[i] = (d[i]! - c[i]! * d[i + 1]!) / b[i]!;
}

/**
 * One Peaceman-Rachford ADI step over dt: an x-implicit half step (dt/2)
 * followed by a y-implicit half step (dt/2). The y half step reuses the same
 * coefficient convention as the x half step (edge rows get their proper
 * implicit weights), so the split is a consistent second-order discretization
 * of the semi-discrete system and preserves steady states exactly.
 * Returns max |delta T| over the full step.
 */
function adiStep(p: ConductionParams, T: Float64Array, nx: number, ny: number, dx: number, dy: number, rx: number, ry: number, dt: number, work: Float64Array): number {
  const srcRate = p.source.enabled ? (p.source.q * p.alpha) / p.k : 0;
  const biX = (p.hConv * dx) / p.k; // cell Biot on x-edges
  const biY = (p.hConv * dy) / p.k; // cell Biot on y-edges
  const nMax = Math.max(nx, ny);
  const a = new Float64Array(nMax);
  const b = new Float64Array(nMax);
  const c = new Float64Array(nMax);
  const d = new Float64Array(nMax);
  const src = (i: number, j: number): number => (srcRate !== 0 && inSource(p, i * dx, j * dy) ? srcRate * dt : 0);

  // Half step 1 (dt/2): implicit in x for every row j, y treated explicitly
  // with half weights; boundary rows receive their half-cell implicit weights
  // (Dirichlet rows pinned, Neumann/Robin rows via mirror coefficients).
  const rxh = rx / 2;
  for (let j = 0; j < ny; j += 1) {
    const yEdgeLow = p.edges.bottom.kind === 'dirichlet' && j === 0;
    const yEdgeHigh = p.edges.top.kind === 'dirichlet' && j === ny - 1;
    for (let i = 0; i < nx; i += 1) {
      const base = T[j * nx + i]!;
      const s = src(i, j) / 2;
      // Neighbors in y (half-cell mirror at the insulated/Robin edge rows).
      const yl = j > 0 ? T[(j - 1) * nx + i]! : T[nx + i]!;
      const yh = j < ny - 1 ? T[(j + 1) * nx + i]! : T[(ny - 2) * nx + i]!;
      // The half-cell mirror at edge rows already encodes the (dt/2) worth,
      // so one uniform PR weight fits every row.
      let yExp = (ry / 2) * (yl - 2 * base + yh);
      if (yEdgeLow || yEdgeHigh) yExp = 0; // pinned row: no y update
      // Robin edges: the surface flux belongs to the explicit operator as
      // well (mirror term (ry/2) * 2 * biY * (tInf - T)), otherwise each
      // edge loses half of its driving flux per full step.
      if (j === 0 && p.edges.bottom.kind === 'convection') yExp += ry * biY * (p.tInf - base);
      if (j === ny - 1 && p.edges.top.kind === 'convection') yExp += ry * biY * (p.tInf - base);
      // Tridiagonal row for the implicit x solve (proper edge weights).
      if (i === 0) {
        if (p.edges.left.kind === 'dirichlet') { a[0] = 0; b[0] = 1; c[0] = 0; d[0] = p.edges.left.value; }
        else if (p.edges.left.kind === 'convection') {
          a[0] = 0; b[0] = 1 + 2 * rxh * (1 + biX); c[0] = -2 * rxh; d[0] = base + yExp + s + 2 * rxh * biX * p.tInf;
        } else { a[0] = 0; b[0] = 1 + 2 * rxh; c[0] = -2 * rxh; d[0] = base + yExp + s; }
      } else if (i === nx - 1) {
        if (p.edges.right.kind === 'dirichlet') { a[i] = 0; b[i] = 1; c[i] = 0; d[i] = p.edges.right.value; }
        else if (p.edges.right.kind === 'convection') {
          a[i] = -2 * rxh; b[i] = 1 + 2 * rxh * (1 + biX); c[i] = 0; d[i] = base + yExp + s + 2 * rxh * biX * p.tInf;
        } else { a[i] = -2 * rxh; b[i] = 1 + 2 * rxh; c[i] = 0; d[i] = base + yExp + s; }
      } else {
        a[i] = -rxh; b[i] = 1 + 2 * rxh; c[i] = -rxh; d[i] = base + yExp + s;
      }
    }
    thomas(a, b, c, d, nx);
    for (let i = 0; i < nx; i += 1) work[j * nx + i] = d[i]!;
  }

  // Half step 2 (dt/2): implicit in y for every column i, x treated
  // explicitly from the intermediate field with half weights (mirror image
  // of half step 1, so both half steps share one coefficient convention).
  const ryh = ry / 2;
  let maxDelta = 0;
  for (let i = 0; i < nx; i += 1) {
    const xEdgeLow = p.edges.left.kind === 'dirichlet' && i === 0;
    const xEdgeHigh = p.edges.right.kind === 'dirichlet' && i === nx - 1;
    for (let j = 0; j < ny; j += 1) {
      const base = work[j * nx + i]!;
      const s = src(i, j) / 2;
      const xl = i > 0 ? work[j * nx + i - 1]! : work[j * nx + 1]!;
      const xh = i < nx - 1 ? work[j * nx + i + 1]! : work[j * nx + nx - 2]!;
      let xExp = (rx / 2) * (xl - 2 * base + xh);
      if (xEdgeLow || xEdgeHigh) xExp = 0; // pinned column: no x update
      // Robin edges: surface flux in the explicit operator (see half step 1).
      if (i === 0 && p.edges.left.kind === 'convection') xExp += rx * biX * (p.tInf - base);
      if (i === nx - 1 && p.edges.right.kind === 'convection') xExp += rx * biX * (p.tInf - base);
      if (j === 0) {
        if (p.edges.bottom.kind === 'dirichlet') { a[0] = 0; b[0] = 1; c[0] = 0; d[0] = p.edges.bottom.value; }
        else if (p.edges.bottom.kind === 'convection') {
          a[0] = 0; b[0] = 1 + 2 * ryh * (1 + biY); c[0] = -2 * ryh; d[0] = base + xExp + s + 2 * ryh * biY * p.tInf;
        } else { a[0] = 0; b[0] = 1 + 2 * ryh; c[0] = -2 * ryh; d[0] = base + xExp + s; }
      } else if (j === ny - 1) {
        if (p.edges.top.kind === 'dirichlet') { a[j] = 0; b[j] = 1; c[j] = 0; d[j] = p.edges.top.value; }
        else if (p.edges.top.kind === 'convection') {
          a[j] = -2 * ryh; b[j] = 1 + 2 * ryh * (1 + biY); c[j] = 0; d[j] = base + xExp + s + 2 * ryh * biY * p.tInf;
        } else { a[j] = -2 * ryh; b[j] = 1 + 2 * ryh; c[j] = 0; d[j] = base + xExp + s; }
      } else {
        a[j] = -ryh; b[j] = 1 + 2 * ryh; c[j] = -ryh; d[j] = base + xExp + s;
      }
    }
    thomas(a, b, c, d, ny);
    for (let j = 0; j < ny; j += 1) {
      const nv = d[j]!;
      const old = T[j * nx + i]!;
      const dv = Math.abs(nv - old);
      if (dv > maxDelta) maxDelta = dv;
      T[j * nx + i] = nv;
    }
  }
  return maxDelta;
}

/** Field statistics. */
function stats(T: Float64Array): { maxT: number; minT: number; meanT: number } {
  let mx = -Infinity;
  let mn = Infinity;
  let sum = 0;
  for (let i = 0; i < T.length; i += 1) {
    const v = T[i]!;
    if (v > mx) mx = v;
    if (v < mn) mn = v;
    sum += v;
  }
  return { maxT: mx, minT: mn, meanT: sum / T.length };
}

/**
 * Solve the 2-D conduction problem. Steady mode time-marches until the max
 * per-step change drops below `steadyTol` (K); transient mode runs exactly
 * tEnd / dt steps. Deterministic.
 */
export function solveConduction(p: ConductionParams, steadyTol = 1e-3): ConductionResult {
  validateConduction(p);
  const nx = clampInt(p.nx, 8, MAX_GRID);
  const ny = clampInt(p.ny, 8, MAX_GRID);
  const dx = p.W / (nx - 1);
  const dy = p.H / (ny - 1);
  const invDx2 = 1 / (dx * dx);
  const invDy2 = 1 / (dy * dy);
  const dtMax = 0.45 / (p.alpha * (invDx2 + invDy2)); // 2-D explicit stability: rx + ry <= 1/2

  let dt = p.dt;
  if (p.scheme === 'explicit' && dt === 0) dt = dtMax * 0.95;
  if (p.scheme === 'adi' && dt === 0) {
    dt = p.runMode === 'steady' ? dtMax * 20 : Math.min(dtMax * 20, p.tEnd / 200);
  }
  if (!(dt > 0)) throw new HeatError('dt must be > 0 (or 0 for automatic)');
  const rx = p.alpha * dt * invDx2;
  const ry = p.alpha * dt * invDy2;
  if (p.scheme === 'explicit' && rx + ry > 0.5) {
    throw new HeatError(`explicit scheme unstable: rx+ry = ${(rx + ry).toFixed(3)} > 0.5 — reduce dt (max ~${dtMax.toPrecision(4)} s) or use ADI`);
  }

  const T = initField(p, nx, ny);
  const scratch = new Float64Array(nx * ny);
  const work = new Float64Array(nx * ny);
  let iterations = 0;
  let residual = 0;
  let converged = true;
  let time = 0;

  if (p.runMode === 'steady') {
    const cap = p.scheme === 'adi' ? 200_000 : MAX_ITER_STEADY;
    for (let it = 0; it < cap; it += 1) {
      residual = p.scheme === 'adi' ? adiStep(p, T, nx, ny, dx, dy, rx, ry, dt, work) : stepExplicitResidual(p, T, scratch, nx, ny, dx, dy, rx, ry, dt);
      iterations = it + 1;
      if (residual < steadyTol) break;
      if (it === cap - 1) converged = false;
    }
  } else {
    let nSteps = Math.ceil(p.tEnd / dt);
    if (nSteps > MAX_STEPS) {
      throw new HeatError(`tEnd/dt needs ${nSteps} steps (cap ${MAX_STEPS}) — increase dt or shorten tEnd`);
    }
    dt = p.tEnd / nSteps;
    const rx2 = p.alpha * dt * invDx2;
    const ry2 = p.alpha * dt * invDy2;
    for (let s = 0; s < nSteps; s += 1) {
      if (p.scheme === 'adi') adiStep(p, T, nx, ny, dx, dy, rx2, ry2, dt, work);
      else stepExplicitResidual(p, T, scratch, nx, ny, dx, dy, rx2, ry2, dt);
      time = (s + 1) * dt;
      iterations = s + 1;
    }
    residual = 0;
  }

  const st = stats(T);
  return {
    nx, ny, T, time, iterations, residual, converged,
    maxT: st.maxT, minT: st.minT, meanT: st.meanT,
    dtUsed: dt, rx, ry,
  };
}

/** Explicit step that also reports max |delta T| (tmp holds the new field). */
function stepExplicitResidual(p: ConductionParams, T: Float64Array, tmp: Float64Array, nx: number, ny: number, dx: number, dy: number, rx: number, ry: number, dt: number): number {
  explicitStep(p, T, nx, ny, dx, dy, rx, ry, dt, tmp);
  let maxDelta = 0;
  for (let i = 0; i < T.length; i += 1) {
    const dv = Math.abs(tmp[i]! - T[i]!);
    if (dv > maxDelta) maxDelta = dv;
    T[i] = tmp[i]!;
  }
  return maxDelta;
}

/**
 * Marching-squares isotherm extraction. Returns segments in grid-index
 * coordinates (corner (i, j) at position i * dx, j * dy) for one level.
 */
export function marchingSquares(T: Float64Array, nx: number, ny: number, level: number): Array<[number, number, number, number]> {
  const segs: Array<[number, number, number, number]> = [];
  const lerp = (v0: number, v1: number): number => {
    const den = v1 - v0;
    return Math.abs(den) < 1e-30 ? 0.5 : (level - v0) / den;
  };
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const v00 = T[j * nx + i]!; // corner (i, j)
      const v10 = T[j * nx + i + 1]!; // (i+1, j)
      const v11 = T[(j + 1) * nx + i + 1]!; // (i+1, j+1)
      const v01 = T[(j + 1) * nx + i]!; // (i, j+1)
      let code = 0;
      if (v00 > level) code |= 1;
      if (v10 > level) code |= 2;
      if (v11 > level) code |= 4;
      if (v01 > level) code |= 8;
      if (code === 0 || code === 15) continue;
      const topX = i + lerp(v00, v10); // edge (i,j)-(i+1,j)
      const botX = i + lerp(v01, v11); // edge (i,j+1)-(i+1,j+1)
      const leftY = j + lerp(v00, v01); // edge (i,j)-(i,j+1)
      const rightY = j + lerp(v10, v11); // edge (i+1,j)-(i+1,j+1)
      const center = 0.25 * (v00 + v10 + v11 + v01) > level;
      const push = (x1: number, y1: number, x2: number, y2: number): void => { segs.push([x1, y1, x2, y2]); };
      switch (code) {
        // 1 = corner (i,j) inside; contour crosses top and left edges.
        case 1: case 14: push(topX, j, i, leftY); break;
        case 2: case 13: push(topX, j, i + 1, rightY); break;
        case 3: case 12: push(i, leftY, i + 1, rightY); break;
        case 4: case 11: push(i + 1, rightY, botX, j + 1); break;
        case 6: case 9: push(topX, j, botX, j + 1); break;
        case 7: case 8: push(i, leftY, botX, j + 1); break;
        case 5: // saddle: v00,v11 above
          if (center) { push(topX, j, i + 1, rightY); push(botX, j + 1, i, leftY); }
          else { push(topX, j, i, leftY); push(i + 1, rightY, botX, j + 1); }
          break;
        case 10: // saddle: v10,v01 above
          if (center) { push(topX, j, i, leftY); push(i + 1, rightY, botX, j + 1); }
          else { push(topX, j, i + 1, rightY); push(botX, j + 1, i, leftY); }
          break;
        default: break;
      }
    }
  }
  return segs;
}

/** Lumped-capacitance reference: T/T0 = exp(-Bi * Fo). */
export function lumpedCooling(bi: number, fo: number): number {
  return Math.exp(-bi * fo);
}

// ---- mode 2: convection ------------------------------------------------------

export type ConvGeometry = 'plate' | 'tube' | 'vplate';

/** Constant-property fluid preset evaluated near 300 K (documented scope). */
export interface FluidProps {
  name: string;
  /** Kinematic viscosity nu (m2/s). */
  nu: number;
  /** Thermal conductivity k (W/(m K)). */
  k: number;
  /** Prandtl number. */
  pr: number;
  /** Thermal expansion coefficient beta (1/K) — ideal gas ~ 1/T. */
  beta: number;
}

export const FLUID_PRESETS: Record<'air' | 'water' | 'oil', FluidProps> = {
  air: { name: 'air ~300 K', nu: 15.89e-6, k: 0.0263, pr: 0.707, beta: 1 / 300 },
  water: { name: 'water ~300 K', nu: 0.858e-6, k: 0.613, pr: 5.83, beta: 2.565e-4 },
  oil: { name: 'engine oil ~300 K', nu: 5.52e-4, k: 0.145, pr: 6400, beta: 0.7e-3 },
};

export interface ConvectionParams {
  geom: ConvGeometry;
  fluid: FluidProps;
  /** Approach velocity (m/s). */
  u: number;
  /** Characteristic length: plate length / tube diameter (m). */
  L: number;
  /** Surface temperature (K). */
  tSurf: number;
  /** Fluid free-stream temperature (K). */
  tInf: number;
}

export interface ConvectionResult {
  re: number;
  pr: number;
  ra: number;
  nu: number;
  /** Convective coefficient h = Nu * k / L (W/(m2 K)). */
  h: number;
  length: number;
  regime: string;
  correlation: string;
}

/** Churchill-Chu vertical-plate Nusselt number (valid 1e-1 < Ra < 1e12). */
export function churchillChuNu(ra: number, pr: number): number {
  const denom = Math.pow(1 + Math.pow(0.492 / pr, 9 / 16), 8 / 27);
  const inner = 0.825 + (0.387 * Math.pow(ra, 1 / 6)) / denom;
  return inner * inner;
}

/** Simplified laminar natural-convection reference Nu = 0.59 Ra^0.25. */
export function naturalNuSimplified(ra: number): number {
  return 0.59 * Math.pow(ra, 0.25);
}

/** Dittus-Boelter turbulent tube Nusselt number (n = 0.4 heating / 0.3 cooling). */
export function dittusBoelterNu(re: number, pr: number, heating: boolean): number {
  return 0.023 * Math.pow(re, 0.8) * Math.pow(pr, heating ? 0.4 : 0.3);
}

export function solveConvection(p: ConvectionParams): ConvectionResult {
  if (!(p.u > 0)) throw new HeatError('velocity u must be > 0 m/s');
  if (!(p.L > 0)) throw new HeatError('characteristic length must be > 0 m');
  const f = p.fluid;
  if (!(f.nu > 0) || !(f.k > 0) || !(f.pr > 0)) throw new HeatError('fluid properties must be positive');

  if (p.geom === 'vplate') {
    const alphaDiff = f.nu / f.pr;
    const ra = (G_ACC * f.beta * Math.abs(p.tSurf - p.tInf) * p.L ** 3) / (f.nu * alphaDiff);
    if (ra < 1e-3) {
      return { re: 0, pr: f.pr, ra, nu: 0, h: 0, length: p.L, regime: 'negligible buoyancy', correlation: 'Ra < 1e-3' };
    }
    const nu = churchillChuNu(ra, f.pr);
    const regime = ra < 1e9 ? 'laminar' : 'turbulent';
    return { re: 0, pr: f.pr, ra, nu, h: (nu * f.k) / p.L, length: p.L, regime, correlation: 'Churchill-Chu (vertical plate)' };
  }

  const re = (p.u * p.L) / f.nu;
  if (p.geom === 'plate') {
    if (re < 5e5) {
      const nu = 0.664 * Math.sqrt(re) * Math.cbrt(f.pr);
      return { re, pr: f.pr, ra: 0, nu, h: (nu * f.k) / p.L, length: p.L, regime: 'laminar', correlation: 'Nu = 0.664 Re^0.5 Pr^(1/3)' };
    }
    const nu = (0.037 * Math.pow(re, 0.8) - 871) * Math.cbrt(f.pr);
    return { re, pr: f.pr, ra: 0, nu, h: (nu * f.k) / p.L, length: p.L, regime: 'mixed / turbulent', correlation: 'Nu = (0.037 Re^0.8 - 871) Pr^(1/3)' };
  }
  // Internal tube flow.
  if (re < 2300) {
    return { re, pr: f.pr, ra: 0, nu: 3.66, h: (3.66 * f.k) / p.L, length: p.L, regime: 'laminar (fully developed)', correlation: 'Nu = 3.66 (constant Ts)' };
  }
  const heating = p.tSurf > p.tInf;
  const nu = dittusBoelterNu(re, f.pr, heating);
  const regime = re >= 1e4 ? 'turbulent' : 'transitional (Dittus-Boelter extrapolated)';
  return { re, pr: f.pr, ra: 0, nu, h: (nu * f.k) / p.L, length: p.L, regime, correlation: 'Nu = 0.023 Re^0.8 Pr^n' };
}

// ---- mode 3: radiation --------------------------------------------------------

export interface RadiationParams {
  /** Surface 1 temperature (K). */
  t1: number;
  /** Surface 2 temperature (K). */
  t2: number;
  eps1: number;
  eps2: number;
  /** View-factor geometry: coaxial disks / aligned rectangles / none (F12 = 1). */
  geom: 'disks' | 'rects' | 'none';
  /** Disks: radii (m) and separation L (m). */
  r1: number;
  r2: number;
  gap: number;
  /** Rectangles: plate dimensions a x b and separation c (m). */
  rectA: number;
  rectB: number;
  rectC: number;
}

export interface RadiationResult {
  eb1: number;
  eb2: number;
  f12: number;
  a1: number;
  a2: number;
  /** Net radiation exchange through the gray two-surface network (W). */
  qRad: number;
  lambdaMax: number;
}

/** Blackbody total emissive power E_b = sigma T^4 (W/m2). */
export function blackbodyEmission(t: number): number {
  if (!(t >= 0)) throw new HeatError('temperature must be >= 0 K');
  return STEFAN_BOLTZMANN * t ** 4;
}

/** Wien peak wavelength lambda_max = b / T (m). */
export function wienPeakWavelength(t: number): number {
  if (!(t > 0)) throw new HeatError('temperature must be > 0 K');
  return WIEN_CONSTANT / t;
}

/** Planck spectral emissive power E_b_lambda (W / m3) at wavelength lambda (m). */
export function planckSpectral(t: number, lambda: number): number {
  if (!(t > 0) || !(lambda > 0)) throw new HeatError('T and lambda must be > 0');
  return PLANCK_C1 / (Math.pow(lambda, 5) * (Math.exp(PLANCK_C2 / (lambda * t)) - 1));
}

export interface SpectralPoint { lambda: number; e: number }

/** Log-spaced Planck sweep over [lambdaMin, lambdaMax] (m). */
export function planckSweep(t: number, lambdaMin: number, lambdaMax: number, n = 400): SpectralPoint[] {
  if (!(lambdaMin > 0) || !(lambdaMax > lambdaMin)) throw new HeatError('need 0 < lambdaMin < lambdaMax');
  const pts: SpectralPoint[] = [];
  const lo = Math.log(lambdaMin);
  const hi = Math.log(lambdaMax);
  for (let i = 0; i < n; i += 1) {
    const lambda = Math.exp(lo + ((hi - lo) * i) / (n - 1));
    pts.push({ lambda, e: planckSpectral(t, lambda) });
  }
  return pts;
}

/**
 * View factor between two aligned parallel rectangles (Incropera Table 13.1):
 * a x b plates separated by c. Closed form, 0 < F12 <= 1.
 */
export function viewFactorRects(a: number, b: number, c: number): number {
  if (!(a > 0) || !(b > 0) || !(c > 0)) throw new HeatError('rectangle view factor needs a, b, c > 0 m');
  const X = a / c;
  const Y = b / c;
  const f = (2 / (Math.PI * X * Y)) *
    (0.5 * Math.log(((1 + X * X) * (1 + Y * Y)) / (1 + X * X + Y * Y)) +
      X * Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y)) +
      Y * Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X)) -
      X * Math.atan(X) - Y * Math.atan(Y));
  return Math.min(1, Math.max(0, f));
}

/**
 * View factor between two coaxial parallel disks (Incropera Table 13.1):
 * radii r1, r2 separated by L. R_i = r1/L, R_j = r2/L.
 */
export function viewFactorDisks(r1: number, r2: number, L: number): number {
  if (!(r1 > 0) || !(r2 > 0) || !(L > 0)) throw new HeatError('disk view factor needs r1, r2, L > 0 m');
  const ri = r1 / L;
  const rj = r2 / L;
  const S = 1 + (1 + rj * rj) / (ri * ri);
  const disc = S * S - 4 * (rj / ri) ** 2;
  const f = 0.5 * (S - Math.sqrt(Math.max(disc, 0)));
  return Math.min(1, Math.max(0, f));
}

export function solveRadiation(p: RadiationParams): RadiationResult {
  if (!(p.t1 > 0) || !(p.t2 > 0)) throw new HeatError('surface temperatures must be > 0 K');
  for (const [nm, v] of [['eps1', p.eps1], ['eps2', p.eps2]] as const) {
    if (!(v > 0) || v > 1) throw new HeatError(`${nm} must be in (0, 1]`);
  }
  let f12: number;
  let a1: number;
  let a2: number;
  if (p.geom === 'disks') {
    if (!(p.r1 > 0) || !(p.r2 > 0) || !(p.gap > 0)) throw new HeatError('disks need r1, r2, gap > 0 m');
    f12 = viewFactorDisks(p.r1, p.r2, p.gap);
    a1 = Math.PI * p.r1 * p.r1;
    a2 = Math.PI * p.r2 * p.r2;
  } else if (p.geom === 'rects') {
    if (!(p.rectA > 0) || !(p.rectB > 0) || !(p.rectC > 0)) throw new HeatError('rectangles need a, b, c > 0 m');
    f12 = viewFactorRects(p.rectA, p.rectB, p.rectC);
    a1 = p.rectA * p.rectB;
    a2 = p.rectA * p.rectB;
  } else {
    f12 = 1;
    a1 = 1;
    a2 = 1;
  }
  const eb1 = blackbodyEmission(p.t1);
  const eb2 = blackbodyEmission(p.t2);
  const denom = (1 - p.eps1) / (p.eps1 * a1) + 1 / (a1 * f12) + (1 - p.eps2) / (p.eps2 * a2);
  const qRad = (eb1 - eb2) / denom;
  return { eb1, eb2, f12, a1, a2, qRad, lambdaMax: wienPeakWavelength(p.t1) };
}

// ---- mode 4: heat exchanger ----------------------------------------------------

export type ExArrangement = 'counter' | 'parallel' | 'cross';

export interface ExchangerInput {
  thIn: number;
  tcIn: number;
  /** Heat-capacity rates C = m_dot * cp (W/K). */
  ch: number;
  cc: number;
  /** Overall conductance U*A (W/K). */
  ua: number;
  arrangement: ExArrangement;
}

export interface ExchangerResult {
  eps: number;
  ntu: number;
  cr: number;
  cMin: number;
  cMax: number;
  q: number;
  thIn: number;
  tcIn: number;
  thOut: number;
  tcOut: number;
  ch: number;
  cc: number;
  ua: number;
  lmtd: number;
  /** Q from the LMTD method using the eps-NTU outlets (cross-check). */
  qLmtd: number;
  /** |Q - UA*LMTD| / Q (NaN for cross flow). */
  lmtdDeviation: number;
  arrangement: ExArrangement;
}

/** Effectiveness closed forms (counter / parallel / cross both-unmixed). */
export function effectivenessNtu(ntu: number, cr: number, arrangement: ExArrangement): number {
  if (!(ntu >= 0)) throw new HeatError('NTU must be >= 0');
  if (!(cr >= 0)) throw new HeatError('Cr must be >= 0');
  if (cr === 0) return 1 - Math.exp(-ntu);
  if (arrangement === 'parallel') {
    return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
  }
  if (arrangement === 'counter') {
    if (Math.abs(cr - 1) < 1e-12) return ntu / (1 + ntu);
    const e = Math.exp(-ntu * (1 - cr));
    return (1 - e) / (1 - cr * e);
  }
  // Cross flow, both fluids unmixed (Incropera Table 11.4).
  const n = Math.pow(ntu, -0.22);
  return 1 - Math.exp((Math.exp(-ntu * cr * n) - 1) / (cr * n));
}

/**
 * LMTD from consistent outlet temperatures. Throws when a temperature cross
 * makes the LMTD undefined (non-positive endpoint difference).
 */
export function lmtdFromOutlets(thIn: number, thOut: number, tcIn: number, tcOut: number, arrangement: ExArrangement): number {
  let d1: number;
  let d2: number;
  if (arrangement === 'counter') {
    d1 = thIn - tcOut;
    d2 = thOut - tcIn;
  } else {
    d1 = thIn - tcIn;
    d2 = thOut - tcOut;
  }
  const eps = 1e-12 * Math.max(Math.abs(d1), Math.abs(d2), 1);
  if (d1 <= eps || d2 <= eps) {
    throw new HeatError(`LMTD undefined: endpoint differences ${d1.toPrecision(4)} / ${d2.toPrecision(4)} K (temperature cross or touch)`);
  }
  if (Math.abs(d1 - d2) < eps) return d1; // log mean limit
  return (d1 - d2) / Math.log(d1 / d2);
}

/**
 * Solve the exchanger with the eps-NTU method and cross-validate against the
 * LMTD method evaluated at the solved outlets (counter / parallel only).
 */
export function solveExchanger(p: ExchangerInput): ExchangerResult {
  if (!(p.thIn > p.tcIn)) throw new HeatError('need thIn > tcIn for a heat exchanger');
  if (!(p.ch > 0) || !(p.cc > 0)) throw new HeatError('capacity rates ch, cc must be > 0 W/K');
  if (!(p.ua > 0)) throw new HeatError('UA must be > 0 W/K');
  const cMin = Math.min(p.ch, p.cc);
  const cMax = Math.max(p.ch, p.cc);
  const cr = cMin / cMax;
  const ntu = p.ua / cMin;
  const dTmax = p.thIn - p.tcIn;
  const eps = effectivenessNtu(ntu, cr, p.arrangement);
  const q = eps * cMin * dTmax;
  const thOut = p.thIn - q / p.ch;
  const tcOut = p.tcIn + q / p.cc;
  let lmtd = Number.NaN;
  let qLmtd = Number.NaN;
  let dev = Number.NaN;
  if (p.arrangement !== 'cross') {
    lmtd = lmtdFromOutlets(p.thIn, thOut, p.tcIn, tcOut, p.arrangement);
    qLmtd = p.ua * lmtd;
    dev = Math.abs(q - qLmtd) / q;
  }
  return {
    eps, ntu, cr, cMin, cMax, q,
    thIn: p.thIn, tcIn: p.tcIn, thOut, tcOut,
    ch: p.ch, cc: p.cc, ua: p.ua,
    lmtd, qLmtd, lmtdDeviation: dev, arrangement: p.arrangement,
  };
}

export interface ProfilePoint { x: number; th: number; tc: number }

/**
 * Closed-form axial temperature profiles (x in 0..1 of the flow length,
 * integrated from the LMTD definition Q(x) = UA * mean(dT over [0, x])).
 * Counter-flow: x measured from the hot inlet; parallel: both inlets at x = 0.
 */
export function exchangerProfiles(r: ExchangerResult, n = 64): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  if (r.arrangement === 'cross') return pts;
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    let qx: number;
    let th: number;
    let tc: number;
    if (r.arrangement === 'parallel') {
      const dTin = r.thIn - r.tcIn;
      const kPar = r.ua * (1 / r.ch + 1 / r.cc);
      const dT = dTin * Math.exp(-kPar * s);
      qx = (dTin - dT) / (1 / r.ch + 1 / r.cc);
      th = r.thIn - qx / r.ch;
      tc = r.tcIn + qx / r.cc;
    } else {
      // Counter-flow: dT(s) = dT0 * exp(-b s) with dT0 = thIn - tcOut,
      // b = UA (1/ch - 1/cc); Q(s) = UA dT0 (1 - exp(-b s)) / b.
      const dT0 = r.thIn - r.tcOut;
      const b = r.ua * (1 / r.ch - 1 / r.cc);
      qx = Math.abs(b) < 1e-12 ? r.ua * dT0 * s : (r.ua * dT0 * (1 - Math.exp(-b * s))) / b;
      th = r.thIn - qx / r.ch;
      tc = r.tcIn + (r.q - qx) / r.cc;
    }
    pts.push({ x: s, th, tc });
  }
  return pts;
}

// ---- mode 5: thermal resistance network ----------------------------------------

export interface LayerSpec { thick: number; k: number }

/** Parse "0.02:1.5,0.1:0.04" (thickness:k pairs, hot side first). */
export function parseLayerSpec(text: string): LayerSpec[] {
  const layers: LayerSpec[] = [];
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const cells = part.split(':');
    if (cells.length !== 2) throw new HeatError(`layer spec "${part}" must be thickness:k`);
    const t = Number(cells[0]);
    const k = Number(cells[1]);
    if (!Number.isFinite(t) || !(t > 0) || !Number.isFinite(k) || !(k > 0)) {
      throw new HeatError(`layer "${part}" needs positive thickness and conductivity`);
    }
    layers.push({ thick: t, k });
  }
  if (layers.length === 0) throw new HeatError('layer spec is empty');
  return layers;
}

export interface ResistanceInput {
  /** Heat-transfer area (m2). */
  area: number;
  /** Overall hot-minus-cold driving temperature (K). */
  dT: number;
  /** Outer / inner film coefficients (0 disables the film). */
  hOut: number;
  hIn: number;
  layers: LayerSpec[];
  /** Parallel-path stud conductivity (0 = off). */
  parallelK: number;
  /** Fraction of area occupied by the parallel path (0..1). */
  parallelFrac: number;
}

export interface ResistanceResult {
  /** Film resistances (0 when disabled). */
  rOut: number;
  rIn: number;
  /** Series layer resistances on the main path (K/W). */
  rLayers: number[];
  /** Parallel-branch resistance (NaN when off). */
  rParallel: number;
  /** Equivalent core resistance (parallel combined when active). */
  rCore: number;
  rTotal: number;
  /** Heat flow (W). */
  q: number;
  /** Heat flux on the main path (W/m2). */
  qFlux: number;
  /** Interface node temperatures from hot to cold (K), length = nodes. */
  nodeTs: number[];
}

export function solveResistance(p: ResistanceInput): ResistanceResult {
  if (!(p.area > 0)) throw new HeatError('area must be > 0 m2');
  if (!(p.dT > 0)) throw new HeatError('dT must be > 0 K');
  if (p.layers.length === 0) throw new HeatError('at least one layer is required');
  for (const l of p.layers) {
    if (!(l.thick > 0) || !(l.k > 0)) throw new HeatError('layer thickness and k must be > 0');
  }
  if (p.hOut < 0 || p.hIn < 0) throw new HeatError('film coefficients must be >= 0');
  if (p.parallelK < 0) throw new HeatError('parallelK must be >= 0');
  if (p.parallelFrac < 0 || p.parallelFrac >= 1) throw new HeatError('parallelFrac must be in [0, 1)');

  const rOut = p.hOut > 0 ? 1 / (p.hOut * p.area) : 0;
  const rIn = p.hIn > 0 ? 1 / (p.hIn * p.area) : 0;

  let rCore: number;
  let rLayers: number[];
  let rParallel = Number.NaN;
  const usePar = p.parallelK > 0 && p.parallelFrac > 0;
  if (usePar) {
    // Parallel-path framed wall: main path area A(1-f) with k, stud path A*f with parallelK.
    rLayers = p.layers.map((l) => l.thick / (l.k * p.area * (1 - p.parallelFrac)));
    rParallel = p.layers.reduce((s, l) => s + l.thick / (p.parallelK * p.area * p.parallelFrac), 0);
    const rMain = rLayers.reduce((s, r) => s + r, 0);
    rCore = 1 / (1 / rMain + 1 / rParallel);
  } else {
    rLayers = p.layers.map((l) => l.thick / (l.k * p.area));
    rCore = rLayers.reduce((s, r) => s + r, 0);
  }
  const rTotal = rOut + rCore + rIn;
  const q = p.dT / rTotal;
  const qFlux = usePar ? q * (1 - p.parallelFrac) / p.area : q / p.area;

  // Node temperatures across [rOut, rLayers..., rIn] using the main-path split.
  const chain = [rOut, ...rLayers, rIn];
  const nodeTs: number[] = [];
  let t = p.dT; // hot-side absolute reference: hot node = dT, cold node = 0
  nodeTs.push(t);
  for (const r of chain) {
    t -= q * r;
    nodeTs.push(t);
  }
  if (usePar) {
    // Replace the layer-node temperatures with the equivalent-core ladder.
    nodeTs.splice(1, rLayers.length, rOut > 0 || rIn > 0 ? nodeTs[1]! - q * (rCore - rLayers.reduce((s, r) => s + r, 0)) : 0);
  }
  return { rOut, rIn, rLayers, rParallel, rCore, rTotal, q, qFlux, nodeTs };
}

// ---- Block / Flow row interface --------------------------------------------------

export type HeatRowMode = 'convection' | 'radiation' | 'exchanger' | 'resistance';

const num = (o: Record<string, unknown>, key: string, fallback = Number.NaN): number => {
  const v = o[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // Missing keys fall through with `undefined` -> NaN -> the caller's fallback.
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
};

/** Analyze one input row for the given mode (pure, deterministic). */
export function analyzeHeatRow(mode: HeatRowMode, row: Record<string, unknown>): Record<string, number | string> {
  if (mode === 'convection') {
    const preset = String(row.fluid ?? 'air').toLowerCase();
    const fluid = FLUID_PRESETS[(preset as keyof typeof FLUID_PRESETS) in FLUID_PRESETS ? (preset as keyof typeof FLUID_PRESETS) : 'air'];
    const r = solveConvection({
      geom: (row.geom as ConvGeometry) ?? 'plate',
      fluid,
      u: num(row, 'u'),
      L: num(row, 'len'),
      tSurf: num(row, 'ts', 320),
      tInf: num(row, 'tinf', 300),
    });
    const out: Record<string, number | string> = {
      re: r.re, pr: r.pr, nu: r.nu, h: r.h, len: r.length, regime: r.regime,
    };
    if (r.ra > 0) out.ra = r.ra;
    return out;
  }
  if (mode === 'radiation') {
    const r = solveRadiation({
      t1: num(row, 't1'), t2: num(row, 't2'),
      eps1: num(row, 'eps1', 1), eps2: num(row, 'eps2', 1),
      geom: (row.geom as RadiationParams['geom']) ?? 'none',
      r1: num(row, 'r1', 0.1), r2: num(row, 'r2', 0.1), gap: num(row, 'gap', 0.1),
      rectA: num(row, 'a', 0.5), rectB: num(row, 'b', 0.5), rectC: num(row, 'c', 0.2),
    });
    return { q: r.qRad, f12: r.f12, a1: r.a1, a2: r.a2, lambdaMaxUm: r.lambdaMax * 1e6 };
  }
  if (mode === 'exchanger') {
    const r = solveExchanger({
      thIn: num(row, 'thin'), tcIn: num(row, 'tcin'),
      ch: num(row, 'ch'), cc: num(row, 'cc'),
      ua: num(row, 'ua'),
      arrangement: (row.arrangement as ExArrangement) ?? 'counter',
    });
    const out: Record<string, number | string> = {
      q: r.q, eps: r.eps, ntu: r.ntu, cr: r.cr, thOut: r.thOut, tcOut: r.tcOut,
    };
    if (Number.isFinite(r.lmtd)) { out.lmtd = r.lmtd; out.qLmtd = r.qLmtd; out.lmtdDeviation = r.lmtdDeviation; }
    return out;
  }
  // resistance
  const r = solveResistance({
    area: num(row, 'area', 1),
    dT: num(row, 'dt'),
    hOut: num(row, 'hout', 0),
    hIn: num(row, 'hin', 0),
    layers: parseLayerSpec(String(row.layers ?? '')),
    parallelK: num(row, 'park', 0),
    parallelFrac: num(row, 'parf', 0),
  });
  return { rTotal: r.rTotal, q: r.q, qFlux: r.qFlux, rCore: r.rCore };
}

/**
 * Parse CSV or JSON Block/Flow input into analyzed rows. Accepted shapes:
 *  - CSV with a header naming the mode's fields (e.g. u,len,ts,tinf,fluid);
 *  - JSON { rows: [ { ...fields } ] } or a single { ...fields } object;
 *  - a JSON string of either.
 */
export function parseHeatInput(mode: HeatRowMode, input: unknown): Array<Record<string, number | string>> {
  const analyzeObj = (o: unknown): Record<string, number | string> => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HeatError('each row must be an object with named fields');
    return analyzeHeatRow(mode, o as Record<string, unknown>);
  };
  if (typeof input === 'string') {
    const text = input.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      const parsed = JSON.parse(text) as unknown;
      return parseHeatInput(mode, parsed);
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) throw new HeatError('empty input');
    const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
    const rows: Array<Record<string, number | string>> = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((c) => c.trim());
      const o: Record<string, unknown> = {};
      header.forEach((h, i) => { o[h] = cells[i]; });
      rows.push(analyzeObj(o));
    }
    return rows;
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return (obj.rows as unknown[]).map(analyzeObj);
    return [analyzeObj(obj)];
  }
  throw new HeatError('unsupported input type (expected CSV text or JSON)');
}
