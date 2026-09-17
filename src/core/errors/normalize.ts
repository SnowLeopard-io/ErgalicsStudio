// ==========================================================================
// Error normalisation — turn `unknown` catches into typed AppErrors
//
// `catch (err)` receives anything: strings, plain objects, DOMExceptions from
// abort/IndexedDB, WASM panic envelopes. Every logging/reporting/UI call site
// used to reinvent its own `String(err)` coercion. Normalise once at the
// boundary and keep the original as `cause`.
// ==========================================================================

import { AppError, OperationAbortedError } from './AppError';

/** True for user-cancellation errors in any of their common shapes. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof OperationAbortedError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ABORT_ERR' || code === 'abort') return true;
  }
  return false;
}

/** Best-effort human-readable message for arbitrary thrown values. */
export function toErrorMessage(error: unknown): string {
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === 'string' && maybe.message.length > 0) return maybe.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Coerce any thrown value into an {@link AppError}. AppErrors pass through
 * unchanged (preserving their class/code), aborts become the low-severity
 * {@link OperationAbortedError}, everything else is wrapped.
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isAbortError(error)) {
    return new OperationAbortedError(toErrorMessage(error) || 'The operation was aborted', {
      cause: error,
    });
  }
  if (error instanceof Error) {
    const wrapped = new AppError(error.message || error.name, { cause: error });
    wrapped.stack = error.stack;
    wrapped.name = error.name || 'Error';
    return wrapped;
  }
  if (typeof error === 'string') return new AppError(error, { severity: 'medium' });
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === 'string' && record.message.length > 0
        ? record.message
        : 'Unknown structured error';
    const details: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'message' && key !== 'stack') details[key] = safeDetail(value);
    }
    return new AppError(message, { details, severity: 'medium' });
  }
  return new AppError(String(error), { severity: 'medium' });
}

function safeDetail(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
