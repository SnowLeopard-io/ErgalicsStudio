// ==========================================================================
// FEM core — transient solve driver (θ-scheme time integration).
//
// For the semi-discrete system M·du/dt = −K·u + F(t) the θ-scheme reads
//   (M + θΔt·K) u^{n+1} = (M − (1−θ)Δt·K) u^n + Δt·(θ F^{n+1} + (1−θ) F^n).
// θ = 1 → implicit Euler (unconditionally stable, 1st order);
// θ = ½ → Crank–Nicolson (unconditionally stable, 2nd order).
//
// Dirichlet data are imposed by elimination on the LHS ONCE (the matrix does
// not change between steps) while the RHS coupling L·g is subtracted per
// step from a pristine copy of the eliminated entries — correct for any
// (also time-varying) prescribed values.
// ==========================================================================

import { CsrMatrix, csrMulVec } from '../assemble/stiffness';
import { CgOptions, conjugateGradient } from './cg';
import { DofValue, eliminateDirichletMatrix } from '../bc/dirichlet';

export interface ThetaSchemeOptions {
  /** Time step (must be > 0). */
  dt: number;
  /** 1 = implicit Euler, 0.5 = Crank–Nicolson; any value in [0, 1] allowed. */
  theta: number;
  /** Number of steps to take. */
  steps: number;
  /** Source vector at time t (return null for no source). */
  sourceAt?: (t: number) => Float64Array | null;
  /** Dirichlet values; may vary with time when a function is given. */
  dirichlet?: DofValue[] | ((t: number) => DofValue[]);
  /** Called after every completed step with the current field and time. */
  onStep?: (u: Float64Array, t: number) => void;
  /** CG options for the per-step solve. */
  cg?: CgOptions;
}

export interface ThetaStepResult {
  values: Float64Array;
  /** Total CG iterations spent across all steps. */
  iterations: number;
  /** Residual of the last linear solve. */
  residual: number;
  /** Time after the last step (steps·dt). */
  time: number;
}

/**
 * Build the θ-scheme operators for M·u' = −K·u:
 * LHS = M + θΔt·K and RHS operator = M − (1−θ)Δt·K.
 * The two matrices are expected to share the assembly pattern (both are
 * assembled from the same mesh into one builder each); any LHS pattern
 * entries missing from the RHS operator are treated as zero on the RHS side.
 */
export function thetaOperators(M: CsrMatrix, K: CsrMatrix, dt: number, theta: number): { lhs: CsrMatrix; rhsOp: CsrMatrix } {
  if (M.rows !== K.rows) throw new Error('fem: M and K must have the same size');
  return {
    lhs: combineSkew(M, K, dt * theta),
    rhsOp: combineSkew(M, K, -dt * (1 - theta)),
  };
}

/** A + s·K sharing A's pattern; throws when K has entries A lacks. */
function combineSkew(M: CsrMatrix, K: CsrMatrix, s: number): CsrMatrix {
  const values = Float64Array.from(M.values);
  if (s !== 0) {
    const index = new Map<string, number>();
    for (let row = 0; row < M.rows; row += 1) {
      for (let k = M.rowPtr[row]!; k < M.rowPtr[row + 1]!; k += 1) {
        index.set(`${row}_${M.colIdx[k]}`, k);
      }
    }
    for (let row = 0; row < K.rows; row += 1) {
      for (let k = K.rowPtr[row]!; k < K.rowPtr[row + 1]!; k += 1) {
        const col = K.colIdx[k]!;
        const hit = index.get(`${row}_${col}`);
        if (hit === undefined) {
          throw new Error('fem: M/K pattern mismatch in theta scheme — assemble M and K with a shared builder');
        }
        values[hit] = values[hit]! + s * K.values[k]!;
      }
    }
  }
  return { rows: M.rows, cols: M.cols, rowPtr: M.rowPtr, colIdx: M.colIdx, values };
}

/**
 * Advance u in time with the θ scheme. `lhs`/`rhsOp` come from
 * `thetaOperators`; `lhs` is eliminated in place for the Dirichlet DOFs.
 */
export function thetaTimeStep(
  lhs: CsrMatrix,
  rhsOp: CsrMatrix,
  u0: Float64Array,
  options: ThetaSchemeOptions,
): ThetaStepResult {
  const { dt, theta, steps } = options;
  const n = lhs.rows;
  const u = Float64Array.from(u0);
  const rhs = new Float64Array(n);
  const opU = new Float64Array(n);
  const dirichletAt = (t: number): DofValue[] =>
    typeof options.dirichlet === 'function' ? options.dirichlet(t) : (options.dirichlet ?? []);

  // One-time LHS elimination; keep a pristine copy of the eliminated entries
  // so the RHS coupling L·g can be subtracted at every step.
  const initialDofs = dirichletAt(0);
  const pristine = Float64Array.from(lhs.values);
  const correctionMap = new Map<number, number>(); // dof index → pristine value
  if (initialDofs.length > 0) {
    eliminateDirichletMatrix(lhs, initialDofs);
    const touched = new Set<number>();
    for (const { dof } of initialDofs) touched.add(dof);
    for (let row = 0; row < lhs.rows; row += 1) {
      for (let k = lhs.rowPtr[row]!; k < lhs.rowPtr[row + 1]!; k += 1) {
        if (touched.has(lhs.colIdx[k]!) || touched.has(row)) correctionMap.set(k, pristine[k]!);
      }
    }
  }

  let iterations = 0;
  let residual = 0;
  for (let step = 0; step < steps; step += 1) {
    const tPrev = step * dt;
    const tNext = (step + 1) * dt;
    const dofs = dirichletAt(tNext);
    // rhs = rhsOp·u^n + dt(θ F^{n+1} + (1−θ) F^n)
    csrMulVec(rhsOp, u, opU);
    rhs.set(opU);
    const fNext = options.sourceAt?.(tNext) ?? null;
    const fPrev = theta < 1 ? (options.sourceAt?.(tPrev) ?? null) : null;
    if (fNext) for (let i = 0; i < n; i += 1) rhs[i] = rhs[i]! + dt * theta * fNext[i]!;
    if (fPrev) for (let i = 0; i < n; i += 1) rhs[i] = rhs[i]! + dt * (1 - theta) * fPrev[i]!;
    // Subtract the constrained coupling: rhs_i −= L_{i,d}·g_d (pristine L).
    if (dofs.length > 0) {
      const corr = dirichletCorrectionFromPristine(lhs, correctionMap, dofs);
      for (let i = 0; i < n; i += 1) rhs[i] = rhs[i]! - corr[i]!;
      for (const { dof, value } of dofs) rhs[dof] = value;
    }
    const solved = conjugateGradient(lhs, rhs, options.cg);
    u.set(solved.solution);
    iterations += solved.iterations;
    residual = solved.residual;
    options.onStep?.(u, tNext);
  }
  return { values: u, iterations, residual, time: steps * dt };
}

/** corr_i = Σ_d L^{pristine}_{i,d}·g_d using the stored pristine entries. */
function dirichletCorrectionFromPristine(
  lhs: CsrMatrix,
  correctionMap: Map<number, number>,
  dofValues: DofValue[],
): Float64Array {
  const constrained = new Map<number, number>();
  for (const { dof, value } of dofValues) constrained.set(dof, value);
  const corr = new Float64Array(lhs.rows);
  for (const [k, value] of correctionMap) {
    // Recover the row of entry k via binary search on rowPtr.
    let lo = 0;
    let hi = lhs.rows;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (lhs.rowPtr[mid]! <= k) lo = mid;
      else hi = mid;
    }
    const col = lhs.colIdx[k]!;
    const g = constrained.get(col);
    if (g !== undefined) corr[lo] = corr[lo]! + value * g;
  }
  return corr;
}
