// ==========================================================================
// Ergalics Studio — numerics: multivariate root finding
//
// Newton's method for systems F(x) = 0 with a damped (Armijo) line search on
// the residual norm. The Jacobian may be supplied analytically; otherwise a
// forward finite-difference approximation is used.
// ==========================================================================

import { assertFinite, requireInput } from '../errors';
import { solveLinear, normInf } from '../linalg';

export type VectorField = (x: number[]) => number[];
export type JacobianFn = (x: number[]) => number[][];

export interface NewtonOptions {
  /** Analytic Jacobian; a finite-difference approximation is used when omitted. */
  jac?: JacobianFn;
  /** Convergence tolerance on ||F||_inf. Default 1e-8. */
  tol?: number;
  /** Convergence tolerance on the step length ||dx||_inf. Default 1e-11. */
  stepTol?: number;
  /** Maximum Newton iterations. Default 100. */
  maxIter?: number;
  /** Damping line-search toggle. Default true. */
  damping?: boolean;
}

export interface NewtonResult {
  /** Approximate root. */
  x: number[];
  /** F(x) at the returned point. */
  fx: number[];
  /** Infinity norm of the residual at the returned point. */
  residual: number;
  iterations: number;
  converged: boolean;
  /** How the Jacobian was obtained. */
  jacobian: 'analytic' | 'finite-difference';
}

/**
 * Solve F(x) = 0 starting from `x0`.
 *
 * Each Newton step is accepted with the largest damping factor in
 * {1, 1/2, 1/4, ...} that gives sufficient decrease of ||F|| (Armijo
 * condition), which makes the method robust from poor starting points.
 * Throws on non-finite residuals/Jacobians and (un)structurally singular
 * linearised systems; exhaustion of `maxIter` is reported through the
 * `converged: false` flag, not silently.
 */
export function newtonSolve(F: VectorField, x0: number[], opts: NewtonOptions = {}): NewtonResult {
  requireInput(x0.length > 0, 'newtonSolve: x0 must be non-empty');
  assertFinite(x0, 'newtonSolve x0');
  const tol = opts.tol ?? 1e-8;
  const stepTol = opts.stepTol ?? 1e-11;
  const maxIter = opts.maxIter ?? 100;
  const damping = opts.damping ?? true;

  const numericJac = opts.jac ?? defaultJacobian(F);
  const jacobianKind: 'analytic' | 'finite-difference' = opts.jac ? 'analytic' : 'finite-difference';

  let x = x0.slice();
  let fx = evalF(F, x);
  let iterations = 0;

  for (iterations = 0; iterations < maxIter; iterations++) {
    const res = normInf(fx);
    if (res <= tol) {
      return { x, fx, residual: res, iterations, converged: true, jacobian: jacobianKind };
    }
    const J = evalJ(numericJac, x, fx.length);
    const dx = solveLinear(J, fx.map((v) => -v));
    assertFinite(dx, 'newtonSolve step');

    if (normInf(dx) <= stepTol * Math.max(1, normInf(x))) {
      // Step below rounding level: as good as this method will get.
      return { x, fx, residual: res, iterations: iterations + 1, converged: true, jacobian: jacobianKind };
    }

    // Damped update: backtrack until ||F(x + lambda*dx)|| < (1 - 1e-4*lambda)||F(x)||.
    let lambda = 1;
    let xNew = x;
    let fNew = fx;
    if (damping) {
      for (let ls = 0; ls < 40; ls++) {
        const trial = x.map((v, i) => v + lambda * dx[i]!);
        const fTrial = evalF(F, trial);
        if (normInf(fTrial) < (1 - 1e-4 * lambda) * res) {
          xNew = trial;
          fNew = fTrial;
          break;
        }
        lambda *= 0.5;
        if (lambda < 1e-13) {
          xNew = trial;
          fNew = fTrial;
          break;
        }
      }
    } else {
      xNew = x.map((v, i) => v + dx[i]!);
      fNew = evalF(F, xNew);
    }
    x = xNew;
    fx = fNew;
  }

  return { x, fx, residual: normInf(fx), iterations: maxIter, converged: false, jacobian: jacobianKind };
}

function evalF(F: VectorField, x: number[]): number[] {
  const fx = F(x);
  assertFinite(fx, 'newtonSolve F(x)');
  return fx;
}

function evalJ(jac: JacobianFn, x: number[], n: number): number[][] {
  const J = jac(x);
  requireInput(J.length === n, `newtonSolve: Jacobian has ${J.length} rows, expected ${n}`);
  for (const row of J) {
    assertFinite(row, 'newtonSolve Jacobian');
    requireInput(row.length === n, `newtonSolve: Jacobian row has ${row.length} columns, expected ${n}`);
  }
  return J;
}

/** Forward-difference Jacobian: column j approximates dF/dx_j (perturbation ~ sqrt(eps) * max(|x_j|, 1)). */
export function defaultJacobian(F: VectorField): JacobianFn {
  return (x: number[]): number[][] => {
    const n = x.length;
    const f0 = F(x);
    const J: number[][] = [];
    for (let i = 0; i < n; i++) J.push(new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(x[j]!), 1);
      const xp = x.slice();
      xp[j] = x[j]! + h;
      const fp = F(xp);
      for (let i = 0; i < n; i++) J[i]![j] = (fp[i]! - f0[i]!) / h;
    }
    return J;
  };
}

/** Convenience: scalar equation f(x) = 0 solved with the damped multivariate kernel. */
export function newtonScalar(f: (x: number) => number, x0: number, opts: Omit<NewtonOptions, 'jac'> = {}): NewtonResult {
  return newtonSolve((x) => [f(x[0]!)], [x0], opts);
}
