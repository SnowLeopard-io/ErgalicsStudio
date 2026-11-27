// ==========================================================================
// Ergalics Studio — numerics: Dormand-Prince RK45 adaptive integrator
//
// The DOPRI5(4) embedded explicit Runge-Kutta pair (Dormand & Prince 1980)
// with FSAL reuse of the last stage, an I-controller on the local error and
// cubic Hermite dense output for event location.
// ==========================================================================

import { NumericsError, assertFinite } from '../errors';
import { toleranceScale, wrmsNorm } from '../linalg';
import {
  initialStep,
  normaliseOptions,
  StepRecorder,
  type ODEOptions,
  type ODEResult,
  type ODERHS,
  type ODEStats,
} from './common';

// Butcher tableau (c, A) and the two weight rows.
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
/** 5th-order weights (= last tableau row; stage 7 is FSAL). */
const B = A[6]!;
/** Difference of the 5th- and 4th-order weight rows, for the error estimate. */
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

export type RK45Options = ODEOptions;

/**
 * Adaptive Dormand-Prince RK45 integration of y' = f(t, y) from `t0` to `t1`.
 *
 * - `opts.rtol` / `opts.atol` control the mixed local error tolerance.
 * - `opts.maxStep` caps |h|, `opts.maxSteps` caps the accepted step count.
 * - `opts.events` reports zero crossings of event functions (located with
 *   Brent root finding on the cubic Hermite dense output).
 * - `opts.denseOutput` attaches a `dense(t)` evaluator to the result.
 *
 * Throws `NumericsError` for non-finite input/solutions; a depleting step
 * budget is reported through `status: 'maxSteps'` with the partial result.
 */
export function solveODE(
  f: ODERHS,
  t0: number,
  y0: number[],
  t1: number,
  opts: RK45Options = {},
): ODEResult {
  const o = normaliseOptions(y0, t0, t1, opts);
  const direction = Math.sign(t1 - t0);
  const stats: ODEStats = { steps: 0, rejected: 0, rhsEvals: 0, jacEvals: 0, luDecomps: 0 };
  const evalF: ODERHS = (t, y) => {
    const out = f(t, y);
    stats.rhsEvals++;
    assertFinite(out, 'ODE f(t, y)');
    return out;
  };

  const f0 = evalF(t0, y0);
  let h = o.h0 ?? initialStep(evalF, t0, y0, t1, f0, o.rtol, o.atol, 5, o.maxStep);
  if (o.maxStep !== undefined) h = Math.min(Math.abs(h), o.maxStep) * direction;
  if (Math.abs(h) > Math.abs(t1 - t0)) h = t1 - t0;

  const recorder = new StepRecorder(t0, y0, f0, o.events, o.denseOutput, stats);
  let tn = t0;
  let yn = y0.slice();
  let fn = f0;
  let status: ODEResult['status'] = 'ok';

  while (tn !== t1) {
    if (stats.steps >= o.maxSteps) {
      status = 'maxSteps';
      break;
    }
    // Do not step past t1.
    if (Math.abs(h) > Math.abs(t1 - tn)) h = t1 - tn;

    // Six explicit stages (stage 7 = FSAL evaluated at the endpoint).
    const k: number[][] = new Array(7);
    k[0] = fn;
    for (let s = 1; s <= 5; s++) {
      const row = A[s]!;
      const ys = yn.slice();
      for (let j = 0; j < s; j++) {
        const a = row[j]!;
        if (a !== 0) {
          const kj = k[j]!;
          for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! + h * a * kj[i]!;
        }
      }
      assertFinite(ys, 'RK45 stage value');
      k[s] = evalF(tn + C[s]! * h, ys);
    }
    const yNew = yn.slice();
    for (let j = 0; j < 6; j++) {
      const b = B[j]!;
      if (b !== 0) {
        const kj = k[j]!;
        for (let i = 0; i < yNew.length; i++) yNew[i] = yNew[i]! + h * b * kj[i]!;
      }
    }
    k[6] = evalF(tn + h, yNew); // FSAL: reused as next step's k1

    // Local error estimate from the embedded 4th-order solution.
    const err = new Array<number>(yNew.length).fill(0);
    for (let j = 0; j < 7; j++) {
      const e = E[j]!;
      if (e !== 0) {
        const kj = k[j]!;
        for (let i = 0; i < err.length; i++) err[i] = err[i]! + h * e * kj[i]!;
      }
    }
    const errNorm = wrmsNorm(err, toleranceScale(yn, yNew, o.rtol, o.atol));

    if (errNorm <= 1) {
      stats.steps++;
      const { stop } = recorder.recordStep(tn + h, yNew, k[6]!);
      if (stop) return finish(recorder, stats, 'ok', o.denseOutput);
      tn = tn + h;
      // Snap to t1 when rounding leaves only a sub-ulp gap; otherwise h can
      // oscillate around t1 by +-1 ulp and trip the underflow guard.
      if (Math.abs(t1 - tn) <= 8 * Number.EPSILON * Math.max(1, Math.abs(t1))) tn = t1;
      yn = yNew;
      fn = k[6]!;
      // I-controller with standard clamps.
      const fac = errNorm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2)));
      h *= fac;
    } else {
      stats.rejected++;
      const fac = Math.max(0.125, 0.9 * Math.pow(errNorm, -0.2));
      h *= Math.min(fac, 0.9);
    }
    // Keep the documented |h| <= maxStep contract across controller growth.
    if (o.maxStep !== undefined) h = Math.min(Math.abs(h), o.maxStep) * direction;

    // Guard against step collapse (e.g. singular right-hand side).
    if (Math.abs(h) < 16 * Number.EPSILON * Math.max(Math.abs(tn), 1e-10)) {
      throw new NumericsError('numerics/step-underflow', `RK45: step size underflow at t = ${tn}`, {
        t: tn,
        steps: stats.steps,
        rejected: stats.rejected,
      });
    }
  }

  return finish(recorder, stats, status, o.denseOutput);
}

function finish(
  recorder: StepRecorder,
  stats: ODEStats,
  status: ODEResult['status'],
  denseOutput: boolean,
): ODEResult {
  const result: ODEResult = {
    t: recorder.t,
    y: recorder.y,
    stats,
    status,
    events: recorder.events,
  };
  if (denseOutput) result.dense = recorder.buildDenseEvaluator();
  return result;
}
