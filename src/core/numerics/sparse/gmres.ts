// ==========================================================================
// Ergalics Studio — numerics: restarted GMRES(m)
//
// Right-preconditioned GMRES with modified Gram-Schmidt (plus one round of
// reorthogonalisation), Givens rotations and an upper-triangular least
// squares solve. Right preconditioning keeps the minimised residual equal
// to the TRUE residual ||b - A x||: the Arnoldi process runs on A M^{-1}
// with the true residual as starting vector, and the correction is
// recovered as x += M^{-1} (V y).
// ==========================================================================

import { NumericsError, requireInput } from '../errors';
import { csrMatVec, requireCompatible, type CSRMatrix } from './csr';
import type { IterativeSolveOptions, LinearSolveResult } from './cg';

export interface GMRESSolveOptions extends IterativeSolveOptions {
  /** Krylov subspace dimension per restart cycle (default min(30, n)). */
  restart?: number;
}

function norm2(v: number[]): number {
  let s = 0;
  for (const c of v) s += c * c;
  return Math.sqrt(s);
}

/**
 * Back substitution for R y = g[0..m-1], where R is the rotated Hessenberg
 * matrix (upper triangular m x m). R[i][k] for k >= i lives in column k of H:
 * H[k] has entries 0..k+1 with the sub-diagonal annihilated by the rotations.
 */
function triangularSolve(H: number[][], g: number[], m: number): number[] {
  const y = new Array<number>(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let s = g[i]!;
    for (let k = i + 1; k < m; k++) s -= H[k]![i]! * y[k]!;
    const d = H[i]![i]!;
    y[i] = d !== 0 ? s / d : 0;
  }
  return y;
}

/** Restarted GMRES(m) for general square systems. */
export function gmresSolve(A: CSRMatrix, b: number[], opts: GMRESSolveOptions = {}): LinearSolveResult {
  requireCompatible(A, b);
  const n = A.n;
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 10 * n;
  const m = Math.max(1, Math.min(opts.restart ?? Math.min(30, n), n));
  const M = opts.precond;
  const method = M ? `gmres(${M.name})` : 'gmres';
  requireInput(Number.isFinite(tol) && tol > 0, 'gmres: tol must be a positive finite number', { tol });
  requireInput(Number.isInteger(maxIter) && maxIter > 0, 'gmres: maxIter must be a positive integer', { maxIter });

  const bNorm = norm2(b);
  if (bNorm === 0) {
    return { x: new Array<number>(n).fill(0), iterations: 0, converged: true, relResidual: 0, method };
  }

  const x = new Array<number>(n).fill(0);
  let iterations = 0;
  let relResidual = 1;
  let converged = false;

  while (!converged && iterations < maxIter) {
    // True residual of the current iterate (equals b for the first cycle).
    const r = b.slice();
    const Ax = csrMatVec(A, x);
    for (let i = 0; i < n; i++) r[i] = r[i]! - Ax[i]!;
    const beta = norm2(r);
    relResidual = beta / bNorm;
    if (!Number.isFinite(relResidual)) {
      throw new NumericsError('numerics/non-finite', 'gmres: residual became non-finite');
    }
    if (relResidual <= tol) {
      converged = true;
      break;
    }

    // One restart cycle: Arnoldi on A M^{-1} starting from r / beta.
    const V: number[][] = [r.map((v) => v / beta)];
    const H: number[][] = [];
    const cs: number[] = [];
    const sn: number[] = [];
    const g: number[] = [beta];
    let j = 0; // Arnoldi vectors built so far
    let estimateConverged = false;
    while (j < m && iterations < maxIter) {
      const vj = V[j]!;
      const t = M ? M.apply(vj) : vj;
      const w = csrMatVec(A, t);
      const hCol = new Array<number>(j + 2).fill(0);
      // Modified Gram-Schmidt with one reorthogonalisation pass.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i <= j; i++) {
          const vi = V[i]!;
          let hi = 0;
          for (let k = 0; k < n; k++) hi += w[k]! * vi[k]!;
          hCol[i] = hCol[i]! + hi;
          for (let k = 0; k < n; k++) w[k] = w[k]! - hi * vi[k]!;
        }
      }
      let hNext = 0;
      for (const c of w) hNext += c * c;
      hNext = Math.sqrt(hNext);
      hCol[j + 1] = hNext;
      // New Arnoldi basis vector (normalised residual direction).
      V.push(hNext > 0 ? w.map((c) => c / hNext) : new Array<number>(n).fill(0));
      // Fold in the previous Givens rotations (rows 0..j-1).
      for (let i = 0; i < j; i++) {
        const c = cs[i]!;
        const s = sn[i]!;
        const tmp = c * hCol[i]! + s * hCol[i + 1]!;
        hCol[i + 1] = -s * hCol[i]! + c * hCol[i + 1]!;
        hCol[i] = tmp;
      }
      // New rotation annihilating hCol[j+1].
      const denom = Math.hypot(hCol[j]!, hCol[j + 1]!);
      const cj = denom > 0 ? hCol[j]! / denom : 1;
      const sj = denom > 0 ? hCol[j + 1]! / denom : 0;
      cs.push(cj);
      sn.push(sj);
      const gPrev = g[j]!;
      const gNext = g[j + 1] ?? 0;
      g[j] = cj * gPrev + sj * gNext;
      g[j + 1] = -sj * gPrev + cj * gNext;
      hCol[j] = denom;
      hCol[j + 1] = 0;
      H.push(hCol);
      j++;
      iterations++;
      if (Math.abs(g[j]!) <= tol * bNorm || hNext === 0) {
        estimateConverged = true;
        break;
      }
    }

    // Least squares solution: R y = g[0..j-1], then x += M^{-1} (V y).
    const y = triangularSolve(H, g, j);
    const u = new Array<number>(n).fill(0);
    for (let i = 0; i < j; i++) {
      const yi = y[i]!;
      if (yi !== 0) {
        const vi = V[i]!;
        for (let k = 0; k < n; k++) u[k] = u[k]! + yi * vi[k]!;
      }
    }
    const corr = M ? M.apply(u) : u;
    for (let k = 0; k < n; k++) x[k] = x[k]! + corr[k]!;

    if (estimateConverged) {
      // Verify with the true residual; the estimate can drift by rounding.
      const rr = b.slice();
      const Ax2 = csrMatVec(A, x);
      for (let i = 0; i < n; i++) rr[i] = rr[i]! - Ax2[i]!;
      relResidual = norm2(rr) / bNorm;
      converged = relResidual <= tol;
    }
  }
  return { x, iterations, converged, relResidual, method };
}
