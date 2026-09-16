// ==========================================================================
// Ergalics Studio — regression diagnostic series + streaming OLS accumulator
//
// Diagnostic series power the 2×2 plot quartet (residuals vs fitted, Q-Q,
// scale-location, leverage vs Cook's D). `StreamingNormalEquations` gives the
// big-data path from FR4.7: OLS from XᵀX / Xᵀy aggregates that the chunked
// reader can feed without holding every row.
// ==========================================================================

import type { OlsResult } from './ols';
import { invertMatrix } from './ols';
import { normalInv } from '@/core/stats/special';
import type { Matrix } from './linalg';

export interface DiagnosticSeries {
  fitted: number[];
  residuals: number[];
  stdResiduals: number[];
  /** Theoretical normal quantiles paired with sorted standardised residuals. */
  qqTheoretical: number[];
  qqSample: number[];
  /** √|standardised residual| per fitted value (scale-location plot). */
  scaleLocation: number[];
  leverage: number[];
  cooksD: number[];
  /** Reference line levels for the leverage plot. */
  cookLines: { fourOverN: number; twoPOverN: number };
}

/** Build every series needed by the diagnostic quartet from an OLS result. */
export function diagnosticSeries(fit: OlsResult): DiagnosticSeries {
  const n = fit.n;
  const order = fit.stdResiduals
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const qqSample = order.map((o) => o.v);
  const qqTheoretical = order.map((_entry, k) => {
    // Blom plotting position (k + 3/8)/(n + 1/4).
    const p = (k + 0.375) / (n + 0.25);
    return normalInv(p);
  });
  const scaleLocation = fit.stdResiduals.map((r) => Math.sqrt(Math.abs(r)));
  return {
    fitted: fit.fitted,
    residuals: fit.residuals,
    stdResiduals: fit.stdResiduals,
    qqTheoretical,
    qqSample,
    scaleLocation,
    leverage: fit.leverage,
    cooksD: fit.cooksD,
    cookLines: { fourOverN: 4 / n, twoPOverN: (2 * fit.p) / n },
  };
}

/**
 * Streaming sufficient statistics for least squares on p parameters
 * (intercept included). Feed chunks with `add(y, X)` then call `solve()`.
 * Memory is O(p²) regardless of row count.
 */
export class StreamingNormalEquations {
  private XtX: Matrix;
  private Xty: number[];
  private yty = 0;
  private n = 0;
  readonly p: number;

  constructor(p: number) {
    if (p < 1) throw new Error('StreamingNormalEquations: p ≥ 1');
    this.p = p;
    this.XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    this.Xty = new Array<number>(p).fill(0);
  }

  add(y: number, x: ArrayLike<number>): void {
    if (x.length !== this.p) throw new Error('StreamingNormalEquations: feature width mismatch');
    for (let a = 0; a < this.p; a += 1) {
      this.Xty[a]! += x[a]! * y;
      for (let b = 0; b < this.p; b += 1) this.XtX[a]![b]! += x[a]! * x[b]!;
    }
    this.yty += y * y;
    this.n += 1;
  }

  /**
   * Solve the aggregated system. Returns coefficients plus basic fit
   * statistics (σ, R²) — leverage/Cook's D need the original rows and are
   * unavailable from aggregates, by construction.
   */
  solve(): { beta: number[]; sigma: number; r2: number; n: number } {
    if (this.n <= this.p) throw new Error('StreamingNormalEquations: n ≤ p');
    const inv = invertMatrix(this.XtX);
    const beta = inv.map((row) => row.reduce((s, v, j) => s + v * this.Xty[j]!, 0));
    // SSE = yᵀy − βᵀXᵀy.
    let sse = this.yty;
    for (let i = 0; i < this.p; i += 1) sse -= beta[i]! * this.Xty[i]!;
    const sigma = Math.sqrt(sse / (this.n - this.p));
    const ybar = this.Xty[0]! / this.n; // first column assumed to be the intercept
    const tss = this.yty - this.n * ybar * ybar;
    const r2 = tss > 0 ? 1 - sse / tss : NaN;
    return { beta, sigma, r2, n: this.n };
  }

  get count(): number {
    return this.n;
  }
}
