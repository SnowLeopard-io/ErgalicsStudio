// ==========================================================================
// Ergalics Studio — numerics: structured errors
//
// Every module under `core/numerics` reports hard failures (malformed input,
// singular systems, step-size underflow, non-convergence that must not be
// silently swallowed) by throwing a `NumericsError` carrying a stable
// machine-readable `code`. Softer outcomes (e.g. iteration budget exhausted
// while a partial result is still meaningful) are returned as explicit
// status flags instead.
// ==========================================================================

/** Stable error codes used by `NumericsError.code`. */
export type NumericsErrorCode =
  | 'numerics/invalid-input'
  | 'numerics/non-finite'
  | 'numerics/no-bracket'
  | 'numerics/singular'
  | 'numerics/zero-pivot'
  | 'numerics/step-underflow'
  | 'numerics/qp-failed'
  | 'numerics/shape-mismatch';

/** Error thrown by the numerical kernels for structured, non-silent failures. */
export class NumericsError extends Error {
  /** Machine-readable failure code, e.g. `numerics/singular`. */
  readonly code: NumericsErrorCode;
  /** Optional structured payload (failing step index, offending value, ...). */
  readonly details?: Record<string, unknown>;

  constructor(code: NumericsErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NumericsError';
    this.code = code;
    this.details = details;
  }
}

/** Throw `numerics/non-finite` if any entry of `values` is NaN or ±Infinity. */
export function assertFinite(values: ArrayLike<number>, label: string): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      throw new NumericsError(
        'numerics/non-finite',
        `${label}[${i}] is not finite (got ${v})`,
        { label, index: i, value: v },
      );
    }
  }
}

/** Throw `numerics/invalid-input` when `cond` is false. */
export function requireInput(cond: boolean, message: string, details?: Record<string, unknown>): void {
  if (!cond) throw new NumericsError('numerics/invalid-input', message, details);
}
