// ==========================================================================
// Ergalics Studio — numerics: ODE shared machinery
//
// Input validation, the Hairer-style initial-step heuristic, cubic Hermite
// dense output (matches y and y' at both step endpoints, per-point local
// error O(h^4)) and the shared event scanner that locates zero crossings of
// user event functions with the Brent root finder.
// ==========================================================================

import { NumericsError, assertFinite, requireInput } from '../errors';
import { brent } from '../root/brent';
import { toleranceScale, wrmsNorm } from '../linalg';

/** Right-hand side of the ODE system y' = f(t, y). */
export type ODERHS = (t: number, y: number[]) => number[];

/** Jacobian of the right-hand side: J[i][j] = df_i/dy_j. */
export type ODEJacobian = (t: number, y: number[]) => number[][];

/** Zero-crossing event definition: roots of g(t, y(t)) are reported. */
export interface ODEEvent {
  /** Event function; a sign change of g along the solution is an event. */
  g: (t: number, y: number[]) => number;
  /** Stop the integration at the event. Default false. */
  terminal?: boolean;
  /** 0 = any crossing (default), +1 = increasing, -1 = decreasing. */
  direction?: 0 | 1 | -1;
}

export interface ODEOptions {
  /** Relative local error tolerance. Default 1e-6. */
  rtol?: number;
  /** Absolute local error tolerance. Default 1e-9. */
  atol?: number | number[];
  /** Hard cap on |h|. */
  maxStep?: number;
  /** Maximum number of accepted steps. Default 100_000. */
  maxSteps?: number;
  /** Initial step hint; a heuristic is used when omitted. */
  h0?: number;
  /** Analytic Jacobian (used by the BDF and Radau solvers). */
  jac?: ODEJacobian;
  /** Zero-crossing event detectors. */
  events?: ODEEvent[];
  /** Provide a dense-output evaluator on the result (cubic Hermite). Default false. */
  denseOutput?: boolean;
}

export interface ODEEventOccurrence {
  t: number;
  y: number[];
  /** Index into the `events` option array. */
  index: number;
}

export interface ODEStats {
  /** Accepted steps. */
  steps: number;
  /** Rejected steps (error control or Newton failures). */
  rejected: number;
  /** Right-hand-side evaluations. */
  rhsEvals: number;
  /** Jacobian evaluations (BDF / Radau; 0 for explicit RK). */
  jacEvals: number;
  /** Matrix factorisations (BDF / Radau; 0 for explicit RK). */
  luDecomps: number;
}

export interface ODEResult {
  /** Output times (includes t0 and the final time or terminal event time). */
  t: number[];
  /** Solution snapshot per output time; y[k][i] is component i at t[k]. */
  y: number[][];
  stats: ODEStats;
  /** `ok` = reached t1 or a terminal event; `maxSteps` = budget exhausted (partial result). */
  status: 'ok' | 'maxSteps';
  /** Located event occurrences in chronological order. */
  events: ODEEventOccurrence[];
  /** Dense-output evaluator (present when `denseOutput: true`). */
  dense?: (tQuery: number) => number[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface NormalisedOptions {
  rtol: number;
  atol: number[];
  maxStep: number | undefined;
  maxSteps: number;
  h0: number | undefined;
  denseOutput: boolean;
  events: ODEEvent[];
}

/** Validate common options and y0; returns normalised option values. */
export function normaliseOptions(y0: number[], t0: number, t1: number, opts: ODEOptions): NormalisedOptions {
  requireInput(y0.length > 0, 'ODE: y0 must be non-empty');
  assertFinite(y0, 'ODE y0');
  requireInput(Number.isFinite(t0) && Number.isFinite(t1), 'ODE: t0 and t1 must be finite');
  requireInput(t0 !== t1, 'ODE: degenerate integration interval (t0 === t1)');

  const rtol = opts.rtol ?? 1e-6;
  requireInput(rtol > 0 && Number.isFinite(rtol), 'ODE: rtol must be a positive finite number', { rtol });
  const atolIn = opts.atol ?? 1e-9;
  const atol = Array.isArray(atolIn) ? atolIn.slice() : new Array<number>(y0.length).fill(atolIn);
  requireInput(atol.length === y0.length, 'ODE: atol array length must match y0');
  for (const a of atol) requireInput(a >= 0 && Number.isFinite(a), 'ODE: atol entries must be non-negative finite');

  if (opts.maxStep !== undefined) {
    requireInput(opts.maxStep > 0 && Number.isFinite(opts.maxStep), 'ODE: maxStep must be positive');
  }
  const maxSteps = opts.maxSteps ?? 100_000;
  requireInput(Number.isInteger(maxSteps) && maxSteps > 0, 'ODE: maxSteps must be a positive integer');
  if (opts.h0 !== undefined) {
    requireInput(opts.h0 !== 0 && Number.isFinite(opts.h0), 'ODE: h0 must be finite and non-zero');
  }

  return {
    rtol,
    atol,
    maxStep: opts.maxStep,
    maxSteps,
    h0: opts.h0,
    denseOutput: opts.denseOutput ?? false,
    events: opts.events ?? [],
  };
}

// ---------------------------------------------------------------------------
// Initial step heuristic (Hairer, Norsett & Wanner, `hstart`)
// ---------------------------------------------------------------------------

/**
 * Pick a starting step from the local behaviour of f: an Euler probe step is
 * taken and the ratio of second-derivative to first-derivative estimates
 * determines a step whose embedded error is around tolerance.
 * (Hairer, Norsett & Wanner, "Solving Ordinary Differential Equations I".)
 */
export function initialStep(
  f: ODERHS,
  t0: number,
  y0: number[],
  t1: number,
  f0: number[],
  rtol: number,
  atol: number[],
  order: number,
  maxStep: number | undefined,
  counter?: { rhs: number },
): number {
  const scale = toleranceScale(y0, y0, rtol, atol);
  const span = Math.abs(t1 - t0);
  const d0 = 0.001 * wrmsNorm(y0, scale);
  const d1 = 0.001 * wrmsNorm(f0, scale);
  let h0: number;
  if (d0 < 1e-5 || d1 < 1e-5) {
    h0 = 1e-6;
  } else {
    h0 = 0.01 * (d0 / d1);
  }
  h0 = Math.min(h0, span, maxStep ?? Infinity);

  const direction = Math.sign(t1 - t0);
  const y1 = y0.map((v, i) => v + h0 * direction * f0[i]!);
  const f1 = f(t0 + direction * h0, y1);
  if (counter) counter.rhs++;
  assertFinite(f1, 'ODE f(t, y)');
  const d2 = (0.001 / h0) * wrmsNorm(f1.map((v, i) => v - f0[i]!), scale);

  let h1: number;
  if (Math.max(d1, d2) <= 1e-15) {
    h1 = Math.max(1e-6, h0 * 1e-3);
  } else {
    h1 = Math.pow(0.01 / Math.max(d1, d2), 1 / (order + 1));
  }
  let h = Math.min(100 * h0, h1, span, maxStep ?? Infinity);
  if (!Number.isFinite(h) || h <= 0) h = span > 0 ? Math.min(span, 1e-3) : 1e-6;
  return direction * h;
}

// ---------------------------------------------------------------------------
// Cubic Hermite dense output
// ---------------------------------------------------------------------------

export interface HermiteData {
  t0: number;
  y0: number[];
  f0: number[];
  t1: number;
  y1: number[];
  f1: number[];
}

/** Build the cubic Hermite interpolant U(t) of one solver step. */
export function makeHermite(d: HermiteData): (t: number) => number[] {
  const h = d.t1 - d.t0;
  const n = d.y0.length;
  return (t: number): number[] => {
    const theta = h !== 0 ? (t - d.t0) / h : 0;
    const th = Math.min(1, Math.max(0, theta));
    // Basis: h00 = 2t^3-3t^2+1, h10 = t^3-2t^2+t, h01 = -2t^3+3t^2, h11 = t^3-t^2.
    const t2 = th * th;
    const t3 = t2 * th;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + th;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      out[i] =
        h00 * d.y0[i]! +
        h10 * h * d.f0[i]! +
        h01 * d.y1[i]! +
        h11 * h * d.f1[i]!;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Step recorder with event scanning and dense-output bookkeeping
// ---------------------------------------------------------------------------

type DenseRecord = HermiteData;

/**
 * Accumulates output points, scans for event crossings on every accepted step
 * and (optionally) keeps the per-step Hermite data needed for dense output.
 */
export class StepRecorder {
  readonly t: number[] = [];
  readonly y: number[][] = [];
  readonly events: ODEEventOccurrence[] = [];
  stats: ODEStats;

  private readonly eventsDef: ODEEvent[];
  private readonly denseOutput: boolean;
  private readonly denseData: DenseRecord[] = [];
  private gPrev: number[] = [];
  private lastT = 0;
  private lastY: number[] = [];
  private lastF: number[] = [];

  constructor(
    t0: number,
    y0: number[],
    f0: number[],
    events: ODEEvent[],
    denseOutput: boolean,
    stats: ODEStats,
  ) {
    this.eventsDef = events;
    this.denseOutput = denseOutput;
    this.stats = stats;
    this.lastT = t0;
    this.lastY = y0.slice();
    this.lastF = f0.slice();
    this.t.push(t0);
    this.y.push(y0.slice());
    if (denseOutput) {
      this.denseData.push({ t0, y0: y0.slice(), f0: f0.slice(), t1: t0, y1: y0.slice(), f1: f0.slice() });
    }
    // Zero crossings exactly at t0 are reported once.
    this.gPrev = events.map((ev) => ev.g(t0, y0));
    for (let i = 0; i < events.length; i++) {
      if (this.gPrev[i] === 0) {
        this.events.push({ t: t0, y: y0.slice(), index: i });
      }
    }
  }

  /**
   * Register one accepted step ending at `tNew`. Scans events on the step,
   * records terminal-event truncation, and returns `stop` = true when the
   * integration must halt.
   */
  recordStep(tNew: number, yNew: number[], fNew: number[]): { stop: boolean } {
    const nEv = this.eventsDef.length;
    const gNew: number[] = new Array<number>(nEv);
    for (let i = 0; i < nEv; i++) gNew[i] = this.eventsDef[i]!.g(tNew, yNew);

    const interpolant = nEv > 0
      ? makeHermite({ t0: this.lastT, y0: this.lastY, f0: this.lastF, t1: tNew, y1: yNew, f1: fNew })
      : null;

    // Locate crossings (interior or exactly at the new endpoint).
    const hits: { te: number; ye: number[]; index: number; terminal: boolean }[] = [];
    for (let i = 0; i < nEv; i++) {
      const gOld = this.gPrev[i]!;
      const gEnd = gNew[i]!;
      if (gOld === 0) continue; // handled at the previous endpoint or at t0
      if (!(gEnd === 0 || gOld * gEnd < 0)) continue;
      const direction = gEnd >= gOld ? 1 : -1;
      const dirFilter = this.eventsDef[i]!.direction ?? 0;
      if (dirFilter !== 0 && dirFilter !== direction) continue;

      let te: number;
      if (gEnd === 0) {
        te = tNew;
      } else {
        const phi = (theta: number): number => {
          const p = interpolant ? interpolant(this.lastT + theta * (tNew - this.lastT)) : yNew;
          const val = this.eventsDef[i]!.g(this.lastT + theta * (tNew - this.lastT), p);
          if (!Number.isFinite(val)) {
            throw new NumericsError('numerics/non-finite', `ODE event function ${i} is non-finite`, { index: i });
          }
          return val;
        };
        const res = brent(phi, 0, 1, { xtol: 1e-13, maxIter: 80 });
        te = this.lastT + res.x * (tNew - this.lastT);
      }
      const ye = interpolant ? interpolant(te) : yNew.slice();
      hits.push({ te, ye, index: i, terminal: this.eventsDef[i]!.terminal === true });
    }

    // Terminal events strictly inside the step truncate it.
    const terminalHit = hits.find((h) => h.terminal && h.te < tNew);
    if (terminalHit) {
      for (const h of hits) {
        if (!h.terminal || h.te <= terminalHit.te) this.events.push({ t: h.te, y: h.ye, index: h.index });
      }
      this.appendPoint(terminalHit.te, terminalHit.ye, fNew);
      return { stop: true };
    }

    this.appendPoint(tNew, yNew, fNew);
    for (const h of hits) this.events.push({ t: h.te, y: h.ye, index: h.index });
    return { stop: hits.some((h) => h.terminal) };
  }

  private appendPoint(t: number, y: number[], f: number[]): void {
    if (this.denseOutput) {
      this.denseData.push({ t0: this.lastT, y0: this.lastY, f0: this.lastF, t1: t, y1: y.slice(), f1: f.slice() });
    }
    this.lastT = t;
    this.lastY = y.slice();
    this.lastF = f.slice();
    this.t.push(t);
    this.y.push(y.slice());
    this.gPrev = this.eventsDef.map((ev) => ev.g(t, y));
  }

  /** Build a piecewise-Hermite evaluator over the integrated interval. */
  buildDenseEvaluator(): (tQuery: number) => number[] {
    if (this.denseData.length < 2) {
      const only = this.denseData[0]!;
      const interp = makeHermite(only);
      return (tq: number) => interp(tq);
    }
    const knots = this.denseData.map((d) => d.t1);
    const interps = this.denseData.map((d) => makeHermite(d));
    return (tq: number): number[] => {
      // Locate the interval by binary search over the step endpoints.
      let lo = 0;
      let hi = knots.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (knots[mid]! <= tq) lo = mid;
        else hi = mid;
      }
      // denseData[i] covers [knots[i-1], knots[i]] (knots[i] = denseData[i].t1,
      // with a degenerate leading record), so the interval
      // [knots[lo], knots[lo+1]] is interpolated by record lo+1.
      return interps[lo + 1]!(tq);
    };
  }
}

// ---------------------------------------------------------------------------
// Finite-difference Jacobian for the implicit solvers
// ---------------------------------------------------------------------------

/** Forward-difference Jacobian with sqrt(eps)-scaled perturbations. */
export function numericJacobian(f: ODERHS): ODEJacobian {
  return (t, y): number[][] => {
    const n = y.length;
    const f0 = f(t, y);
    // Perturbing y_i yields df_j/dy_i for every j — a COLUMN of J. Collect
    // the columns first, then transpose so the returned J[i][j] = df_i/dy_j
    // matches the ODEJacobian contract (Robertson-style non-symmetric
    // Jacobians otherwise silently hand the solvers J^T, which wrecks the
    // modified-Newton convergence rate without changing the fixed point).
    const cols: number[][] = [];
    for (let i = 0; i < n; i++) {
      const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(y[i]!), 1);
      const yp = y.slice();
      yp[i] = y[i]! + h;
      const fp = f(t, yp);
      const col = new Array<number>(n);
      for (let j = 0; j < n; j++) col[j] = (fp[j]! - f0[j]!) / h;
      cols.push(col);
    }
    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) row[j] = cols[j]![i]!;
      J.push(row);
    }
    assertFinite(J.flat(), 'ODE numerical Jacobian');
    return J;
  };
}
