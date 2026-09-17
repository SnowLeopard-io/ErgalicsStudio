// ==========================================================================
// Result type — explicit error-as-value channel
//
// For boundary/parsing code, throwing is the wrong default: an invalid CSV
// row or a missing file is an *expected* outcome the caller must branch on.
// `Result<T, E>` (Rust/Effect-style) makes that branch exhaustive under
// `noImplicitReturns` and keeps stack-trace costs off hot validation paths.
// ==========================================================================

import { AppError } from './AppError';
import { normalizeError } from './normalize';

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Run a throwing function, capturing any failure as a normalised AppError. */
export function wrapSync<T>(fn: () => T): Result<T, AppError> {
  try {
    return ok(fn());
  } catch (error) {
    return err(normalizeError(error));
  }
}

/** Await a promise (or a promise factory), capturing any failure. */
export async function wrapAsync<T>(
  input: Promise<T> | (() => Promise<T>),
): Promise<Result<T, AppError>> {
  try {
    const promise = typeof input === 'function' ? input() : input;
    return ok(await promise);
  } catch (error) {
    return err(normalizeError(error));
  }
}

export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Unwrap or fall back (fallback may be derived lazily from the error). */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T | ((error: E) => T)): T {
  if (result.ok) return result.value;
  return typeof fallback === 'function' ? (fallback as (error: E) => T)(result.error) : fallback;
}

/** Split a list of results into values and errors (batch validation). */
export function partitionResults<T, E>(
  results: ReadonlyArray<Result<T, E>>,
): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return { values, errors };
}
