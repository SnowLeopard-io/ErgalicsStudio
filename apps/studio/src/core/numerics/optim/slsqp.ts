// ==========================================================================
// Ergalics Studio — numerics: SLSQP (sequential least-squares programming)
//
// Lightweight SQP for min f(x) s.t. c_eq(x) = 0, c_in(x) >= 0:
//   - QP subproblem with linearised constraints, solved by a naive
//     dual active-set strategy (most-violated constraint in, full dense KKT
//     re-solve each time, multiplier sign test to drop wrong inequalities).
//   - L1 merit function with Powell's multiplier update and backtracking
//     Armijo search.
//   - BFGS approximation of the Lagrangian Hessian with Powell's damping
//     correction to preserve positive definiteness.
//   - Objective and constraint gradients via central finite differences
//     (an analytic objective gradient may be supplied).
//
// Documented simplifications vs the full Kraft implementation:
//   * the QP uses "add most violated + full KKT re-solve" instead of an
//     incremental Cholesky dual method (same convex QP solution, worse
//     complexity per iteration);
//   * numerically infeasible linearisations fall back to a penalised
//     gradient step instead of the L1-inconsistency-aware LSQ subproblem;
//   * no second-order correction. For smooth, well-posed problems the
//     iteration matches textbook SLSQP behaviour.
// ==========================================================================

import { NumericsError, assertFinite, requireInput } from '../errors';
import { dot, solveLinear, normInf } from '../linalg';
import type { OptimizeResult } from './types';

export interface SLSQPConstraints {
  /** Equality constraints c(x) = 0 (scalar or vector return). */
  eq?: (x: number[]) => number | number[];
  /** Inequality constraints c(x) >= 0 (scalar or vector return). */
  ineq?: (x: number[]) => number | number[];
}

export interface SLSQPOptions {
  /** Maximum SQP iterations. Default 200. */
  maxIter?: number;
  /** Relative tolerance on objective decrease. Default 1e-9. */
  ftol?: number;
  /** Convergence tolerance on the QP step inf-norm. Default 1e-8. */
  stepTol?: number;
}

export interface SLSQPResult extends OptimizeResult {
  /** L1 constraint violation at the returned point. */
  constraintViolation: number;
}

/**
 * Minimise `f` subject to the constraints in `opts.constraints`.
 * Non-finite objective values throw `NumericsError`; exhausting `maxIter`
 * yields `converged: false`.
 */
export function minimizeSLSQP(
  f: (x: number[]) => number,
  x0: number[],
  opts: SLSQPOptions & { constraints?: SLSQPConstraints; grad?: (x: number[]) => number[] } = {},
): SLSQPResult {
  const n = x0.length;
  requireInput(n > 0, 'slsqp: x0 must be non-empty');
  assertFinite(x0, 'slsqp x0');
  const maxIter = opts.maxIter ?? 200;
  const ftol = opts.ftol ?? 1e-9;
  const stepTol = opts.stepTol ?? 1e-8;

  const c = opts.constraints ?? {};
  const eqFns = expandConstraints(c.eq, x0);
  const inFns = expandConstraints(c.ineq, x0);
  const nEq = eqFns.length;
  const nIn = inFns.length;

  let funcEvals = 0;
  const evalObj = (x: number[]): number => {
    funcEvals++;
    const v = f(x);
    if (!Number.isFinite(v)) {
      throw new NumericsError('numerics/non-finite', `slsqp: objective is not finite (got ${v})`, { value: v });
    }
    return v;
  };
  const evalEq = (x: number[]): number[] => eqFns.map((fn) => checked(fn(x), 'slsqp equality constraint'));
  const evalIn = (x: number[]): number[] => inFns.map((fn) => checked(fn(x), 'slsqp inequality constraint'));

  const gradF = opts.grad
    ? (x: number[]): number[] => {
        const g = opts.grad!(x);
        assertFinite(g, 'slsqp gradient');
        return g;
      }
    : centralDiff(evalObj);

  let x = x0.slice();
  let fx = evalObj(x);
  let B = identity(n);
  let mu = 1;
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < maxIter; iterations++) {
    const g = gradF(x);
    const ceq = evalEq(x);
    const cin = evalIn(x);

    // Linearised constraints: A_eq d = -c_eq, A_in d >= -c_in.
    const Aeq = eqFns.map((fn) => centralDiff(fn)(x));
    const Ain = inFns.map((fn) => centralDiff(fn)(x));

    // ---- QP subproblem: min 1/2 d'Bd + g'd  s.t. A_eq d = b_eq, A_in d >= b_in ----
    const qp = solveQP(B, g, Aeq, ceq.map((v) => -v), Ain, cin.map((v) => -v), n, nEq, nIn);
    let d = qp.d;
    if (qp.failed) {
      // Fallback: penalised steepest descent (documented simplification).
      d = g.map((v) => -v / Math.max(1, normInf(g)));
    }

    const stepNorm = normInf(d);
    if (stepNorm <= stepTol * Math.max(1, normInf(x))) {
      converged = true;
      break;
    }

    // ---- Merit function line search ----
    const cL1 = ceq.reduce((s, v) => s + Math.abs(v), 0) + cin.reduce((s, v) => s + Math.max(0, -v), 0);
    // Powell multiplier update: mu >= (g'd + 1/2 d'Bd) / ((1 - 0.1) ||c||_1).
    const predicted = -(dot(g, d) + 0.5 * dot(d, B.map((row) => dot(row, d))));
    if (cL1 > 0 && predicted > 0) {
      mu = Math.max(mu, predicted / (0.9 * cL1));
    }
    const merit = (xx: number[]): number => {
      const fv = evalObj(xx);
      const ev = evalEq(xx);
      const iv = evalIn(xx);
      return (
        fv +
        mu * (ev.reduce((s, v) => s + Math.abs(v), 0) + iv.reduce((s, v) => s + Math.max(0, -v), 0))
      );
    };
    const phi0 = merit(x);
    const slope = dot(g, d) - mu * cL1; // linearised merit slope along d
    let alpha = 1;
    let xNew = x;
    let fNew = fx;
    let accepted = false;
    for (let ls = 0; ls < 30; ls++) {
      const trial = x.map((v, i) => v + alpha * d[i]!);
      const phiTrial = merit(trial);
      if (Number.isFinite(phiTrial) && phiTrial <= phi0 + 1e-4 * alpha * Math.min(slope, 0)) {
        xNew = trial;
        fNew = evalObj(trial);
        accepted = true;
        break;
      }
      alpha *= 0.5;
      if (alpha < 1e-14) break;
    }
    if (!accepted) {
      // Merit search failed: restart with a fresh Hessian approximation.
      B = identity(n);
      converged = normInf(d) <= Math.sqrt(stepTol) * Math.max(1, normInf(x));
      if (converged) break;
      continue;
    }

    const fDecrease = Math.abs(fx - fNew) <= ftol * Math.max(1, Math.abs(fx), Math.abs(fNew));

    // ---- BFGS update of the Lagrangian Hessian approximation ----
    const lam = qp.lambda;
    const lagr = (xx: number[]): number[] => {
      const out = gradF(xx).slice();
      for (let i = 0; i < nEq; i++) for (let j = 0; j < n; j++) out[j] = out[j]! + lam[i]! * Aeq[i]![j]!;
      for (let i = 0; i < nIn; i++) {
        const lamI = lam[nEq + i]!;
        if (lamI !== 0) for (let j = 0; j < n; j++) out[j] = out[j]! + lamI * Ain[i]![j]!;
      }
      return out;
    };
    // Only constraints active at the new point contribute (frozen multipliers).
    const s = xNew.map((v, i) => v - x[i]!);
    const yL = lagr(xNew).map((v, i) => v - lagr(x)[i]!);
    const Bs = B.map((row) => dot(row, s));
    const sBs = dot(s, Bs);
    const sy = dot(s, yL);
    if (sBs > 0) {
      let yEff = yL;
      if (sy < 0.2 * sBs) {
        // Powell damping.
        const theta = (0.8 * sBs) / Math.max(sBs - sy, 1e-300);
        yEff = yL.map((v, i) => theta * v + (1 - theta) * Bs[i]!);
      }
      const sY = dot(s, yEff);
      if (sY > 1e-12 * Math.max(dot(s, s), 1e-300)) {
        const Bnew = B.map((row, i) =>
          row.map((v, j) => v - (Bs[i]! * Bs[j]!) / sBs + (yEff[i]! * yEff[j]!) / sY),
        );
        B = Bnew;
      }
    }

    x = xNew;
    fx = fNew;
    if (fDecrease && stepNorm <= 1e-5 * Math.max(1, normInf(x))) {
      converged = true;
      break;
    }
  }

  const ceqF = evalEq(x);
  const cinF = evalIn(x);
  const finalViolation =
    ceqF.reduce((s, v) => s + Math.abs(v), 0) + cinF.reduce((s, v) => s + Math.max(0, -v), 0);
  return { x, f: fx, iterations, converged, funcEvals, constraintViolation: finalViolation };
}

// ---------------------------------------------------------------------------
// QP subproblem: naive dual active-set
// ---------------------------------------------------------------------------

interface QPResult {
  d: number[];
  /** Multipliers: [eq..., ineq...] with the convention L = f + sum lam_i c_i. */
  lambda: number[];
  failed: boolean;
}

/**
 * Convex QP  min 1/2 d'Bd + g'd  s.t.  Aeq d = beq,  Ain d >= bin.
 * Active-set loop: solve the equality-constrained subproblem on the current
 * active set via the dense KKT system, add the most violated constraint,
 * drop active inequalities whose multiplier has the wrong sign.
 */
function solveQP(
  B: number[][],
  g: number[],
  Aeq: number[][],
  beq: number[],
  Ain: number[][],
  bin: number[],
  n: number,
  nEq: number,
  nIn: number,
): QPResult {
  const nCon = nEq + nIn;
  const gradOf = (i: number): number[] => (i < nEq ? Aeq[i]! : Ain[i - nEq]!);
  const rhsOf = (i: number): number => (i < nEq ? beq[i]! : bin[i - nEq]!);
  const isIneq = (i: number): boolean => i >= nEq;

  let active: number[] = [];
  let d = new Array<number>(n).fill(0);
  let lambda = new Array<number>(nCon).fill(0);

  for (let iter = 0; iter <= nCon + n + 5; iter++) {
    // Solve the KKT system for the current active set.
    const k = active.length;
    if (k === 0) {
      // Unconstrained minimiser of the QP.
      d = solveLinear(B, g.map((v) => -v));
      lambda = new Array<number>(nCon).fill(0);
    } else {
      const K: number[][] = [];
      const rhs: number[] = [];
      for (let i = 0; i < n; i++) {
        const row = new Array<number>(n + k).fill(0);
        for (let j = 0; j < n; j++) row[j] = B[i]![j]!;
        for (let a = 0; a < k; a++) {
          const ai = gradOf(active[a]!);
          row[n + a] = ai[i]!;
        }
        K.push(row);
        rhs.push(-g[i]!);
      }
      for (let a = 0; a < k; a++) {
        const row = new Array<number>(n + k).fill(0);
        const ai = gradOf(active[a]!);
        for (let j = 0; j < n; j++) row[j] = ai[j]!;
        K.push(row);
        rhs.push(rhsOf(active[a]!));
      }
      let sol: number[];
      try {
        sol = solveLinear(K, rhs);
      } catch {
        return { d, lambda, failed: true };
      }
      d = sol.slice(0, n);
      lambda = new Array<number>(nCon).fill(0);
      for (let a = 0; a < k; a++) lambda[active[a]!] = sol[n + a]!;
    }

    // Drop active inequalities with wrong-signed multipliers.
    let dropped = false;
    for (const i of active) {
      if (isIneq(i) && lambda[i]! > 1e-10) {
        active = active.filter((j) => j !== i);
        dropped = true;
        break;
      }
    }
    if (dropped) continue;

    // Find the most violated constraint.
    let worst = -1;
    let worstVal = 1e-11;
    for (let i = 0; i < nEq; i++) {
      const lhs = dot(Aeq[i]!, d);
      const viol = Math.abs(lhs - beq[i]!);
      if (viol > worstVal) {
        worstVal = viol;
        worst = i;
      }
    }
    for (let i = 0; i < nIn; i++) {
      const lhs = dot(Ain[i]!, d);
      const viol = bin[i]! - lhs;
      if (viol > worstVal) {
        worstVal = viol;
        worst = nEq + i;
      }
    }
    if (worst < 0) {
      return { d, lambda, failed: false };
    }
    if (active.includes(worst)) {
      // Cannot add (already active but still violated): infeasible QP.
      return { d, lambda, failed: true };
    }
    active = [...active, worst];
  }

  // Iteration budget exhausted without a KKT-consistent point.
  return { d, lambda, failed: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise one constraint callable into a list of scalar constraint
 * functions. A vector (array) return is expanded into one constraint per
 * component; the component count is fixed from the first evaluation at x0.
 */
function expandConstraints(
  fn: ((x: number[]) => number | number[]) | undefined,
  x0: number[],
): ((x: number[]) => number)[] {
  if (!fn) return [];
  const first = fn(x0);
  if (Array.isArray(first)) {
    return first.map((_, i) => (x: number[]): number => {
      const v = fn(x);
      if (!Array.isArray(v)) {
        throw new NumericsError('numerics/invalid-input', 'slsqp constraint: vector/scalar return type changed');
      }
      if (v.length !== first.length) {
        throw new NumericsError('numerics/invalid-input', 'slsqp constraint: vector length changed between calls');
      }
      return v[i]!;
    });
  }
  return [(x: number[]): number => {
    const v = fn(x);
    if (Array.isArray(v)) throwScalarRequired();
    return checked(v, 'slsqp constraint');
  }];
}

function throwScalarRequired(): never {
  throw new NumericsError('numerics/invalid-input', 'slsqp constraint: scalar/scalar return type changed');
}

function checked(v: number | number[], label: string): number {
  if (Array.isArray(v)) {
    throw new NumericsError('numerics/invalid-input', `${label}: vector constraints are not supported in scalar form`);
  }
  if (!Number.isFinite(v)) {
    throw new NumericsError('numerics/non-finite', `${label} returned a non-finite value (${v})`, { value: v });
  }
  return v;
}

/** Central finite-difference gradient of a scalar function. */
function centralDiff(fn: (x: number[]) => number): (x: number[]) => number[] {
  return (x: number[]): number[] => {
    const n = x.length;
    const g = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      const h = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(x[j]!));
      const xp = x.slice();
      const xm = x.slice();
      xp[j] = x[j]! + h;
      xm[j] = x[j]! - h;
      g[j] = (fn(xp) - fn(xm)) / (2 * h);
    }
    return g;
  };
}

function identity(n: number): number[][] {
  const I: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    I.push(row);
  }
  return I;
}

// Re-exported for convenience of downstream users of this module.
export type { OptimizeResult };
