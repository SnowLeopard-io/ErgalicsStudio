// ==========================================================================
// Ergalics Studio — numerics: variable-order, variable-step BDF1..BDF5
//
// Gear-style backward differentiation formulas in the variable-coefficient
// form: the method approximates y'(t_{n+1}) by the derivative at t_{n+1} of
// the interpolant through (t_{n+1}, y_{n+1}) and the `order` newest accepted
// back-points, and solves y'(t_{n+1}) = f(t_{n+1}, y_{n+1}) with a modified
// Newton iteration. Because the stencil coefficients are recomputed from the
// ACTUAL node spacing every step, step-size changes need no history
// resampling (resampling by extrapolation is what destabilises discrete-
// history BDF codes on stiff decaying modes).
//
//   - numerical (or user-supplied) Jacobian, LU refactorised when the leading
//     coefficient c0 = sum_m 1/(t_{n+1} - t_{n+1-m}) or the order changes,
//   - local error estimate from the predictor-corrector difference
//     (y_{n+1} - predictor) scaled by the EXACT LTE/predictor ratio of the
//     actual stencil (the classical 1/2, 2/9, 3/22, 12/125, 10/137 on a
//     uniform mesh; see `errorRatio`),
//   - order and step-size selection from the same differences evaluated at
//     degrees order-1 / order / order+1 (best candidate wins), with a short
//     wait after order changes so the degree-k estimates settle,
//   - step growth is capped (variable-step BDF zero-stability needs bounded
//     spacing ratios), and the Newton iteration converges well below the
//     error-test threshold: leftover Newton error rides the stiff modes into
//     the history, where the extrapolation estimator amplifies it.
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

const MAX_ORDER = 5;
/** Newton iteration budget by order (DIFSUB-style). */
const MAX_NEWTON = [0, 8, 8, 9, 10, 11];
/** Upper bound for one-step growth; keeps the variable-step stencil stable. */
const MAX_GROWTH = 2;

export type BDFOptions = ODEOptions;

/**
 * Variable-order/variable-step BDF integration of y' = f(t, y) from `t0` to
 * `t1`. Interface identical to `solveODE` (RK45); `opts.jac` supplies an
 * analytic Jacobian, otherwise a finite-difference approximation is used.
 *
 * Throws `NumericsError` on non-finite input/solutions or step-size
 * underflow; a depleting step budget is reported via `status: 'maxSteps'`.
 */
export function solveBDF(
  f: ODERHS,
  t0: number,
  y0: number[],
  t1: number,
  opts: BDFOptions = {},
): ODEResult {
  const o = normaliseOptions(y0, t0, t1, opts);
  const direction = Math.sign(t1 - t0);
  const n = y0.length;
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
  let h = o.h0 ?? initialStep(evalF, t0, y0, t1, f0, o.rtol, o.atol, 1, o.maxStep);
  if (o.maxStep !== undefined) h = Math.min(Math.abs(h), o.maxStep) * direction;
  if (Math.abs(h) > Math.abs(t1 - t0)) h = t1 - t0;

  const recorder = new StepRecorder(t0, y0, f0, o.events, o.denseOutput, stats);

  // Solver state: accepted history with the newest point first.
  const tHist: number[] = [t0];
  const yHist: number[][] = [y0.slice()];
  let order = 1;
  let orderWait = 0;
  let tn = t0;
  let status: ODEResult['status'] = 'ok';

  // Jacobian / LU cache: the Newton matrix (c0 I - J) is refactorised
  // whenever J is refreshed, the order changes or the leading coefficient
  // c0 changes (i.e. whenever the mesh moves).
  let J: number[][] | null = null;
  let lu: ReturnType<typeof luFactor> | null = null;
  let luOrder = 0;
  let luC0 = NaN;
  let stepsSinceJac = 0;
  let consecutiveFailures = 0;

  while (tn !== t1) {
    if (stats.steps >= o.maxSteps) {
      status = 'maxSteps';
      break;
    }
    order = Math.max(1, Math.min(order, MAX_ORDER, tHist.length - 1));
    if (Math.abs(h) > Math.abs(t1 - tn)) h = t1 - tn;

    const tNew = tn + h;

    // ---- Jacobian refresh policy ----
    if (J === null || stepsSinceJac >= 1 || consecutiveFailures >= 3) {
      J = getJac(tn, yHist[0]!);
      lu = null;
      stepsSinceJac = 0;
      consecutiveFailures = 0;
    }

    // ---- Variable-step BDF coefficients ----
    // c_j = d/dt L_j (tNew) for the Lagrange basis on the nodes
    // [tNew, t_n, ..., t_{n+1-order}]; the method reads
    // sum_j c_j y_{n+1-j} = f(tNew, yNew).
    const alpha = stencilCoefficients([tNew, ...tHist.slice(0, order)]);
    const a0 = alpha[0]!;
    if (lu === null || luOrder !== order || luC0 !== a0) {
      const m: number[][] = new Array(n);
      for (let i = 0; i < n; i++) {
        const row = new Array<number>(n).fill(0);
        const Jrow = J[i]!;
        for (let j = 0; j < n; j++) row[j] = -Jrow[j]!;
        row[i] = a0 - Jrow[i]!;
        m[i] = row;
      }
      lu = luFactor(m);
      stats.luDecomps++;
      luOrder = order;
      luC0 = a0;
    }

    // ---- Predictor: Lagrange extrapolation through the history points ----
    // First step: only one history point exists -> constant predictor.
    const yPred = lagrangeEval(tHist, yHist, tHist.length === 1 ? 0 : order, tNew);

    // ---- Modified Newton iteration on F(y) = sum c_j y_{n+1-j} - f(tNew, y) ----
    let yIter = yPred.slice();
    let fIter = evalF(tNew, yIter);
    let deltaNormPrev = Infinity;
    let converged = false;
    const maxNewton = MAX_NEWTON[order]!;
    for (let it = 0; it < maxNewton; it++) {
      const scale = toleranceScale(yIter, yPred, o.rtol, o.atol);
      const residual = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        let s = alpha[0]! * yIter[i]!;
        for (let j = 1; j <= order; j++) s += alpha[j]! * yHist[j - 1]![i]!;
        residual[i] = s - fIter[i]!;
      }
      const delta = luSolve(lu!, residual);
      assertFinite(delta, 'BDF Newton correction');
      yIter = yIter.map((v, i) => v - delta[i]!);
      fIter = evalF(tNew, yIter);
      const deltaNorm = wrmsNorm(delta, scale);
      if (process.env.BDF_DEBUG) {
         
        console.error(`  N it=${it} h=${h.toExponential(2)} dn=${deltaNorm.toExponential(3)} d=[${delta.map((v, i) => (v / scale[i]!).toExponential(2)).join(',')}]`);
      }
      // Tight convergence threshold: whatever Newton error is left in the
      // committed point re-enters the history as a perturbation along the
      // stiff modes, where the extrapolation-based error estimate amplifies
      // the per-node noise of the last k+1 points by sum |Lagrange weights|
      // (up to 2^(k+1)-2). A loose tolerance here freezes the step size on
      // problems with very small absolute-tolerance components (Robertson).
      if (deltaNorm <= 0.003) {
        converged = true;
        break;
      }
      if (deltaNorm > 2 * deltaNormPrev && deltaNorm > 1) break;
      deltaNormPrev = deltaNorm;
    }

    if (!converged) {
      // Slow or diverging Newton: accept only if the iterate is already
      // within a small fraction of the error test of some solution point
      // (otherwise the committed wobble would poison the error estimate);
      // shrink and retry.
      const scale = toleranceScale(yIter, yPred, o.rtol, o.atol);
      const totalCorrection = wrmsNorm(yIter.map((v, i) => v - yPred[i]!), scale);
      if (process.env.BDF_DEBUG) {
         
        console.error(`  N FAIL tn=${tn.toExponential(3)} h=${h.toExponential(3)} k=${order} tc=${totalCorrection.toExponential(3)}`);
      }
      converged = totalCorrection <= 0.02;
      if (!converged) {
        stats.rejected++;
        consecutiveFailures++;
        h *= 0.5;
        guardStepSize(h, tn, stats);
        continue;
      }
    }
    stepsSinceJac++;

    // ---- Local error estimate: corrector minus predictor ----
    const yNew = yIter;
    const scale = toleranceScale(yHist[0]!, yNew, o.rtol, o.atol);
    let errEst: number[];
    if (order === 1 && tHist.length === 1) {
      // First step ever: the constant predictor makes (y1 - y0) the first
      // difference, which is O(h); use (y1 - y0 - h f0)/2 = LTE of BDF1.
      errEst = yNew.map((v, i) => (v - yHist[0]![i]! - h * f0[i]!) / 2);
    } else {
      // Both the corrector's one-step error and the degree-k extrapolation
      // predictor's error are proportional to h^(k+1) y^(k+1); their ratio is
      // an exact rational function of the ACTUAL node spacing (see
      // `errorRatio`), recovering the classical constants 1/2, 2/9, 3/22,
      // 12/125, 10/137 for k = 1..5 on a uniform mesh. Estimating with the
      // true constant matters: a conservative multiplier here shrinks every
      // accuracy-limited step by its 1/(k+1)-th power (up to 35% at k = 5).
      const estK = errorRatio(tNew, tHist, order, order + 1);
      errEst = yNew.map((v, i) => (v - yPred[i]!) * estK);
    }
    const errNorm = wrmsNorm(errEst, scale);
    if (process.env.BDF_DEBUG) {
       
      console.error(
        `BDF tn=${tn.toExponential(3)} h=${h.toExponential(3)} k=${order} acc=${stats.steps} rej=${stats.rejected} err=${errNorm.toExponential(3)} ratio=[${errEst.map((v, i) => (v / scale[i]!).toExponential(2)).join(',')}] dn=[${yNew.map((v, i) => ((v - yPred[i]!) / scale[i]!).toExponential(2)).join(',')}]`,
      );
    }

    if (errNorm > 1) {
      stats.rejected++;
      const fac = Math.max(0.1, Math.min(1, 0.9 * Math.pow(errNorm, -1 / (order + 1))));
      h *= fac;
      guardStepSize(h, tn, stats);
      continue;
    }

    // ---- Order / step-size selection ----
    // The same predictor-corrector difference evaluated against lower- and
    // higher-degree extrapolations estimates the LTE of order-1 / order+1
    // stencils; the best candidate wins and its factor is applied for real.
    // After an order change the estimates need a few steps of history at the
    // new degree before they are meaningful again (CVODE waits k+1 steps).
    let newOrder = order;
    const facSame = Math.min(MAX_GROWTH, Math.max(0.2, 0.9 * Math.pow(Math.max(errNorm, 1e-10), -1 / (order + 1))));
    let hFactor = facSame;

    if (orderWait === 0) {
      if (order >= 2) {
        // yNew - predictor(order-1) ~ LTE(BDF-(order-1)); ratio exact per stencil.
        const predDown = lagrangeEval(tHist, yHist, order - 1, tNew);
        const facDownK = errorRatio(tNew, tHist, order - 1, order);
        const errDown = wrmsNorm(yNew.map((v, i) => (v - predDown[i]!) * facDownK), scale);
        const facDown = Math.min(MAX_GROWTH, 0.9 * Math.pow(Math.max(errDown, 1e-10), -1 / order));
        if (facDown > hFactor) {
          newOrder = order - 1;
          hFactor = facDown;
        }
      }
      if (order < MAX_ORDER && tHist.length >= order + 2) {
        // yNew - predictor(order+1) ~ LTE(BDF-(order+1)); ratio exact per stencil.
        const predUp = lagrangeEval(tHist, yHist, order + 1, tNew);
        const facUpK = errorRatio(tNew, tHist, order + 1, order + 2);
        const errUp = wrmsNorm(yNew.map((v, i) => (v - predUp[i]!) * facUpK), scale);
        const facUp = Math.min(MAX_GROWTH, 0.9 * Math.pow(Math.max(errUp, 1e-10), -1 / (order + 2)));
        if (facUp > hFactor && facUp > 1.1) {
          newOrder = order + 1;
          hFactor = facUp;
        }
      }
    }

    // ---- Commit the step ----
    const fNew = evalF(tNew, yNew);
    stats.steps++;
    const { stop } = recorder.recordStep(tNew, yNew, fNew);

    tHist.unshift(tNew);
    yHist.unshift(yNew.slice());
    if (tHist.length > 6) {
      tHist.pop();
      yHist.pop();
    }

    if (stop) return finishBDF(recorder, stats, 'ok', o.denseOutput);
    tn = tNew;
    // Snap to t1 when rounding leaves only a sub-ulp gap (see rk45).
    if (Math.abs(t1 - tn) <= 8 * Number.EPSILON * Math.max(1, Math.abs(t1))) tn = t1;

    // Apply the step-size factor (the variable-step stencil absorbs the
    // new spacing; no history resampling is needed).
    if (hFactor !== 1) {
      let hNew = h * hFactor;
      if (o.maxStep !== undefined) hNew = Math.min(Math.abs(hNew), o.maxStep) * direction;
      hNew = Math.min(Math.abs(hNew), Math.abs(t1 - tn)) * direction;
      h = hNew;
    }
    if (newOrder !== order) {
      orderWait = Math.min(newOrder, 5);
    } else if (orderWait > 0) {
      orderWait--;
    }
    order = newOrder;
  }

  return finishBDF(recorder, stats, status, o.denseOutput);
}

function finishBDF(
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

function guardStepSize(h: number, tn: number, stats: ODEStats): void {
  if (Math.abs(h) < 16 * Number.EPSILON * Math.max(Math.abs(tn), 1e-10)) {
    throw new NumericsError('numerics/step-underflow', `BDF: step size underflow at t = ${tn}`, {
      t: tn,
      steps: stats.steps,
      rejected: stats.rejected,
    });
  }
}

/**
 * Derivatives at `nodes[0]` (the new time) of the Lagrange basis on
 * `nodes[0..k]`. For equidistant spacing h these equal ALPHA_k[j] / h of the
 * classical fixed-step BDF-k, so the method recovers sum_j a_j y_{n+1-j} =
 * h f(t_{n+1}, y_{n+1}) exactly.
 */
function stencilCoefficients(nodes: number[]): number[] {
  const k = nodes.length - 1;
  const c: number[] = new Array<number>(k + 1);
  let c0 = 0;
  for (let m = 1; m <= k; m++) c0 += 1 / (nodes[0]! - nodes[m]!);
  c[0] = c0;
  for (let j = 1; j <= k; j++) {
    let num = 1;
    let den = 1;
    for (let m = 0; m <= k; m++) {
      if (m !== 0 && m !== j) num *= nodes[0]! - nodes[m]!;
      if (m !== j) den *= nodes[j]! - nodes[m]!;
    }
    c[j] = num / den;
  }
  return c;
}

/**
 * Exact ratio between the one-step solution error of the BDF stencil on
 * `nodes = [tNew, tHist[0..stencilDepth-1]]` and the error of the degree-`
 * stencilDepth` extrapolation predictor through `predictorDepth` history
 * points, both evaluated at `tNew`. Taylor-expanding the exact solution in
 * the defect of the BDF equation and in the interpolation error of the
 * predictor gives, with `D_j = tNew - tHist[j-1]`:
 *
 *   LTE / d = sum_{j=1..stencilDepth} c_j (-D_j)^(stencilDepth+1)
 *             / (c_0 * prod_{j=1..predictorDepth} D_j),
 *
 * where c_j are the `stencilCoefficients` of the stencil. The expression
 * holds for arbitrary (zero-stable) node spacings and reduces to the
 * classical fixed-step constants 1/2, 2/9, 3/22, 12/125, 10/137 for
 * stencilDepth = 1..5. Requires tHist.length >= predictorDepth.
 */
function errorRatio(tNew: number, tHist: number[], stencilDepth: number, predictorDepth: number): number {
  const c = stencilCoefficients([tNew, ...tHist.slice(0, stencilDepth)]);
  let num = 0;
  for (let j = 1; j <= stencilDepth; j++) {
    num += c[j]! * Math.pow(tHist[j - 1]! - tNew, stencilDepth + 1);
  }
  let den = c[0]!;
  for (let j = 1; j <= predictorDepth; j++) den *= tNew - tHist[j - 1]!;
  return num / den;
}

/** Lagrange extrapolation through the first `deg+1` history points, evaluated at `x`. */
function lagrangeEval(tHist: number[], yHist: number[][], deg: number, x: number): number[] {
  const n = yHist[0]!.length;
  const out = new Array<number>(n).fill(0);
  for (let j = 0; j <= deg; j++) {
    let w = 1;
    for (let m = 0; m <= deg; m++) {
      if (m !== j) w *= (x - tHist[m]!) / (tHist[j]! - tHist[m]!);
    }
    const yj = yHist[j]!;
    for (let i = 0; i < n; i++) out[i] = out[i]! + w * yj[i]!;
  }
  return out;
}
