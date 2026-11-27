// ==========================================================================
// Ergalics Studio — numerics: Radau IIA 5th-order stiff integrator
//
// The 3-stage (order 5) Radau IIA implicit Runge-Kutta method solved with a
// modified Newton iteration on the full 3n stacked stage system
// (M = I - h (A x J), dense LU). This is simpler than Hairer's transformed
// complex-factorised version at the cost of an O((3n)^3) factorisation, which
// is fine for the moderate system sizes of a desktop workbench.
//
// Local error estimate: est = sum_i DD_i Z_i + h k1 with
//   DD1 = -(13 + 7*sqrt(6))/3, DD2 = (-13 + 7*sqrt(6))/3, DD3 = -1/3,
// where Z_i are the stage increments and k1 = f(t_n, y_n). Since
// sum_i DD_i c_i = -1 this equals sum_i DD_i (Z_i - c_i h k1), which
// annihilates polynomial solutions of degree <= 3 and is O(h^4) in general
// (a conservative, order-3 embedded estimator for the order-5 method).
// ==========================================================================

import { NumericsError, assertFinite } from '../errors';
import { luFactor, luSolve, toleranceScale, wrmsNorm } from '../linalg';
import {
  initialStep,
  normaliseOptions,
  numericJacobian,
  StepRecorder,
  type ODEJacobian,
  type ODEOptions,
  type ODEResult,
  type ODERHS,
  type ODEStats,
} from './common';

const S6 = Math.sqrt(6);
/** Nodes. */
const C = [(4 - S6) / 10, (4 + S6) / 10, 1];
/** Radau IIA 3-stage coefficient matrix. */
const A: number[][] = [
  [(88 - 7 * S6) / 360, (296 - 169 * S6) / 1800, (-2 + 3 * S6) / 225],
  [(296 + 169 * S6) / 1800, (88 + 7 * S6) / 360, (-2 - 3 * S6) / 225],
  [(16 - S6) / 36, (16 + S6) / 36, 1 / 9],
];
/** Error-estimator coefficients (see header comment). */
const DD = [-(13 + 7 * S6) / 3, (-13 + 7 * S6) / 3, -1 / 3];

const MAX_NEWTON = 14;

export type RadauOptions = ODEOptions;

/**
 * Radau IIA (order 5) integration of y' = f(t, y) from `t0` to `t1`.
 * Interface identical to `solveODE` / `solveBDF`; `opts.jac` supplies an
 * analytic Jacobian, otherwise finite differences are used.
 */
export function solveRadau(
  f: ODERHS,
  t0: number,
  y0: number[],
  t1: number,
  opts: RadauOptions = {},
): ODEResult {
  const o = normaliseOptions(y0, t0, t1, opts);
  const direction = Math.sign(t1 - t0);
  const n = y0.length;
  const N = 3 * n;
  const stats: ODEStats = { steps: 0, rejected: 0, rhsEvals: 0, jacEvals: 0, luDecomps: 0 };
  const evalF: ODERHS = (t, y) => {
    const out = f(t, y);
    stats.rhsEvals++;
    assertFinite(out, 'ODE f(t, y)');
    return out;
  };
  const userJac = opts.jac;
  const getJac: ODEJacobian = userJac
    ? (t, y) => {
        stats.jacEvals++;
        const J = userJac(t, y);
        assertFinite(J.flat(), 'ODE jacobian');
        return J;
      }
    : numericJacobian(evalF);

  const f0 = evalF(t0, y0);
  let h = o.h0 ?? initialStep(evalF, t0, y0, t1, f0, o.rtol, o.atol, 5, o.maxStep);
  if (o.maxStep !== undefined) h = Math.min(Math.abs(h), o.maxStep) * direction;
  if (Math.abs(h) > Math.abs(t1 - t0)) h = t1 - t0;

  const recorder = new StepRecorder(t0, y0, f0, o.events, o.denseOutput, stats);

  let tn = t0;
  let yn = y0.slice();
  let k1 = f0; // f(tn, yn); reused from the previous step's endpoint evaluation
  let zPrev: number[][] | null = null; // stage increments of the previous step
  let status: ODEResult['status'] = 'ok';

  let J: number[][] | null = null;
  let lu: ReturnType<typeof luFactor> | null = null;
  let luH = NaN;
  let stepsSinceJac = 0;
  let newtonWasSlow = false;

  while (tn !== t1) {
    if (stats.steps >= o.maxSteps) {
      status = 'maxSteps';
      break;
    }
    if (Math.abs(h) > Math.abs(t1 - tn)) h = t1 - tn;

    // ---- Jacobian / LU management ----
    if (J === null || stepsSinceJac >= 25 || newtonWasSlow) {
      J = getJac(tn, yn);
      lu = null;
      stepsSinceJac = 0;
      newtonWasSlow = false;
    }
    if (lu === null || luH !== h) {
      const M: number[][] = new Array(N);
      for (let bi = 0; bi < 3; bi++) {
        for (let p = 0; p < n; p++) {
          const r = bi * n + p;
          const row = new Array<number>(N).fill(0);
          for (let bj = 0; bj < 3; bj++) {
            const aij = A[bi]![bj]!;
            if (aij === 0) continue;
            const Jrow = J[p]!;
            for (let q = 0; q < n; q++) row[bj * n + q] = -h * aij * Jrow[q]!;
          }
          row[r] = row[r]! + 1;
          M[r] = row;
        }
      }
      lu = luFactor(M);
      stats.luDecomps++;
      luH = h;
    }

    // ---- Initial guess for the stage increments ----
    let Z: number[][];
    if (zPrev !== null) {
      // Predictor by continuity: scale the previous step's increments.
      const tPrev = recorder.t.length >= 2 ? recorder.t[recorder.t.length - 2]! : tn - h;
      const ratio = tn - tPrev !== 0 ? h / (tn - tPrev) : 1;
      Z = zPrev.map((zp) => zp.map((v) => v * ratio));
    } else {
      // First step: explicit Euler along the current derivative.
      Z = [0, 1, 2].map((i) => new Array<number>(n).fill(h * C[i]!).map((v, p) => v * k1[p]!));
    }

    // ---- Modified Newton on the stacked stage system ----
    let deltaNormPrev = Infinity;
    let converged = false;
    for (let it = 0; it < MAX_NEWTON; it++) {
      const fStage = [0, 1, 2].map((i) => evalF(tn + C[i]! * h, Z[i]!.map((v, p) => yn[p]! + v)));
      const yNewEst = Z[2]!.map((v, p) => yn[p]! + v);
      // delta lives on the 3n stacked stage grid: replicate the per-component
      // tolerance scale across the three stage blocks.
      const scale1 = toleranceScale(yn, yNewEst, o.rtol, o.atol);
      const scale = new Array<number>(N);
      for (let bi = 0; bi < 3; bi++) {
        for (let p = 0; p < n; p++) scale[bi * n + p] = scale1[p]!;
      }
      const residual = new Array<number>(N);
      for (let bi = 0; bi < 3; bi++) {
        for (let p = 0; p < n; p++) {
          let s = Z[bi]![p]!;
          for (let bj = 0; bj < 3; bj++) s -= h * A[bi]![bj]! * fStage[bj]![p]!;
          residual[bi * n + p] = s;
        }
      }
      const delta = luSolve(lu!, residual);
      assertFinite(delta, 'Radau Newton correction');
      for (let bi = 0; bi < 3; bi++) {
        const zi = Z[bi]!;
        for (let p = 0; p < n; p++) zi[p] = zi[p]! - delta[bi * n + p]!;
      }
      const deltaNorm = wrmsNorm(delta, scale);
      // Tight convergence threshold: leftover Newton error stays in the
      // stage increments and re-appears in the error estimate
      // est = sum DD_i Z_i + h k1 with sum |DD_i| ~ 11.8, so a loose
      // tolerance makes the estimate report ~1 scaled unit of noise on
      // problems with very small absolute-tolerance components (Robertson)
      // and freezes the step size.
      if (deltaNorm <= 0.002) {
        converged = true;
        break;
      }
      if (deltaNorm > 2 * deltaNormPrev && deltaNorm > 1) break;
      deltaNormPrev = deltaNorm;
    }

    if (!converged) {
      stats.rejected++;
      newtonWasSlow = true;
      h *= 0.5;
      if (Math.abs(h) < 16 * Number.EPSILON * Math.max(Math.abs(tn), 1e-10)) {
        throw new NumericsError('numerics/step-underflow', `Radau: step size underflow at t = ${tn}`, {
          t: tn,
          steps: stats.steps,
          rejected: stats.rejected,
        });
      }
      continue;
    }
    stepsSinceJac++;

    // ---- Local error estimate and step control ----
    const yNew = Z[2]!.map((v, p) => yn[p]! + v);
    const scale = toleranceScale(yn, yNew, o.rtol, o.atol);
    const est = new Array<number>(n).fill(0);
    for (let bi = 0; bi < 3; bi++) {
      const dd = DD[bi]!;
      const zi = Z[bi]!;
      for (let p = 0; p < n; p++) est[p] = est[p]! + dd * zi[p]!;
    }
    for (let p = 0; p < n; p++) est[p] = est[p]! + h * k1[p]!;
    const errNorm = wrmsNorm(est, scale);

    if (errNorm > 1) {
      stats.rejected++;
      const fac = Math.max(0.1, Math.min(0.9, 0.9 * Math.pow(errNorm, -0.25)));
      h *= fac;
      if (Math.abs(h) < 16 * Number.EPSILON * Math.max(Math.abs(tn), 1e-10)) {
        throw new NumericsError('numerics/step-underflow', `Radau: step size underflow at t = ${tn}`, {
          t: tn,
          steps: stats.steps,
          rejected: stats.rejected,
        });
      }
      continue;
    }

    // ---- Commit ----
    const fEnd = evalF(tn + h, yNew); // becomes the next step's k1
    stats.steps++;
    const { stop } = recorder.recordStep(tn + h, yNew, fEnd);
    zPrev = Z.map((zi) => zi.slice());

    if (stop) {
      if (o.denseOutput) {
        return {
          t: recorder.t,
          y: recorder.y,
          stats,
          status: 'ok',
          events: recorder.events,
          dense: recorder.buildDenseEvaluator(),
        };
      }
      return { t: recorder.t, y: recorder.y, stats, status: 'ok', events: recorder.events };
    }
    tn = tn + h;
    // Snap to t1 when rounding leaves only a sub-ulp gap (see rk45).
    if (Math.abs(t1 - tn) <= 8 * Number.EPSILON * Math.max(1, Math.abs(t1))) tn = t1;
    yn = yNew;
    k1 = fEnd;

    const fac = errNorm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.25)));
    h *= fac;
    if (o.maxStep !== undefined) h = Math.min(Math.abs(h), o.maxStep) * direction;
  }

  if (o.denseOutput) {
    return {
      t: recorder.t,
      y: recorder.y,
      stats,
      status,
      events: recorder.events,
      dense: recorder.buildDenseEvaluator(),
    };
  }
  return { t: recorder.t, y: recorder.y, stats, status, events: recorder.events };
}
