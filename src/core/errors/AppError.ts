// ==========================================================================
// Structured application error taxonomy
//
// // `throw new Error(string)` made every failure untyped: callers could not
// distinguish a user-validation problem (fix the form, never retry) from a
// transient IO failure (safe to retry) from an abort (expected, low severity).
// This module introduces a small hierarchy with stable machine-readable
// codes, severity, retry hints, structured details and a serialisable cause
// chain — the same shape Sentry/MLflow use for diagnostic envelopes.
//
// Layering: this module only *type-imports* ValidationIssue, so the runtime
// dependency graph stays errors → (nothing), validation → (nothing).
// ==========================================================================

import type { ValidationIssue } from '@/core/validation/types';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Stable, machine-readable error codes. Treat the string as an API. */
export type ErrorCode =
  | 'unknown'
  | 'abort'
  | 'validation.failed'
  | 'data.format'
  | 'data.quality'
  | 'data.not_found'
  | 'data.too_large'
  | 'io.network'
  | 'io.file'
  | 'compute.failed'
  | 'compute.timeout'
  | 'compute.unsupported'
  | 'storage.quota'
  | 'storage.corrupt'
  | 'storage.unavailable'
  | 'plugin.failed'
  | 'plugin.timeout'
  | 'config.invalid';

export interface AppErrorOptions {
  /** Wrapped upstream error (kept for `cause` chain inspection). */
  cause?: unknown;
  /** Structured, machine-readable context (offsets, ids, limits, …). */
  details?: Record<string, unknown>;
  /** Whether re-executing the operation may succeed. Default: false. */
  retriable?: boolean;
  /** Operational severity for telemetry/UI triage. Default: 'high'. */
  severity?: ErrorSeverity;
  /** Override the class-default code. */
  code?: ErrorCode | string;
}

export interface SerializedError {
  name: string;
  code: string;
  message: string;
  severity: ErrorSeverity;
  retriable: boolean;
  details: Record<string, unknown>;
  stack?: string;
  cause?: SerializedError;
}

/**
 * Base class of every operational error in the application. `instanceof
 * AppError` is the single check callers need before accessing `code`, while
 * unknown throws are normalised at the boundary (see `normalize.ts`).
 */
export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly severity: ErrorSeverity;
  readonly retriable: boolean;
  readonly details: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code ?? 'unknown';
    this.severity = options.severity ?? 'high';
    this.retriable = options.retriable ?? false;
    this.details = options.details ?? {};
  }

  /** Walk the cause chain (this error first). */
  *causes(): Generator<AppError> {
    yield this;
    let current: unknown = this.cause;
    const seen = new Set<unknown>([this]);
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current instanceof AppError) {
        yield current;
        current = current.cause;
      } else {
        return;
      }
    }
  }

  /** Plain-object representation safe to persist / ship in diagnostics. */
  toJSON(): SerializedError {
    const serialize = (err: AppError): SerializedError => ({
      name: err.name,
      code: err.code,
      message: err.message,
      severity: err.severity,
      retriable: err.retriable,
      details: err.details,
      ...(err.stack ? { stack: err.stack } : {}),
    });
    const root = serialize(this);
    let node = root;
    let current: unknown = this.cause;
    const seen = new Set<unknown>([this]);
    while (current instanceof AppError && !seen.has(current)) {
      seen.add(current);
      node.cause = serialize(current);
      node = node.cause;
      current = current.cause;
    }
    return root;
  }
}

/** User-cancellable operation. Carries the DOM `AbortError` name on purpose. */
export class OperationAbortedError extends AppError {
  constructor(message = 'The operation was aborted', options: AppErrorOptions = {}) {
    super(message, {
      code: 'abort',
      severity: 'low',
      retriable: false,
      ...options,
    });
    this.name = 'AbortError';
  }
}

/** Input/contract validation failed (form fields, schemas, API boundaries). */
export class ValidationError extends AppError {
  readonly issues: ValidationIssue[];

  constructor(
    message = 'Validation failed',
    issues: ValidationIssue[] = [],
    options: AppErrorOptions = {},
  ) {
    super(message, { code: 'validation.failed', severity: 'medium', ...options });
    this.name = 'ValidationError';
    this.issues = issues.map((issue) => ({ ...issue }));
  }

  static fromIssues(issues: ValidationIssue[], message?: string): ValidationError {
    const first = issues[0];
    return new ValidationError(message ?? first?.message ?? 'Validation failed', issues);
  }

  static fromMessage(path: (string | number)[], code: string, message: string): ValidationError {
    return new ValidationError(message, [{ path, code, message, severity: 'error' }]);
  }
}

/** Malformed or unsupported input data (parse failures, schema drift). */
export class DataError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { severity: 'medium', ...options, code: options.code ?? 'data.format' });
    this.name = 'DataError';
  }
}

/** Storage/quota/persistence failure; quota errors are retriable after cleanup. */
export class StorageError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { severity: 'high', ...options, code: options.code ?? 'storage.corrupt' });
    this.name = 'StorageError';
  }
}

/** Network/file IO failure; defaults to retriable with medium severity. */
export class IoError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      severity: 'medium',
      retriable: true,
      ...options,
      code: options.code ?? 'io.network',
    });
    this.name = 'IoError';
  }
}

/** Compute kernel / numeric pipeline failure (GPU, WASM, MCMC, …). */
export class ComputeError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { severity: 'high', ...options, code: options.code ?? 'compute.failed' });
    this.name = 'ComputeError';
  }
}

/** Deadline exceeded. */
export class TimeoutError extends AppError {
  constructor(message = 'The operation timed out', options: AppErrorOptions = {}) {
    super(message, {
      severity: 'medium',
      retriable: true,
      ...options,
      code: 'compute.timeout',
    });
    this.name = 'TimeoutError';
  }
}

/** A plugin/extension threw or returned an invalid result. */
export class PluginExecutionError extends AppError {
  readonly pluginId?: string;

  constructor(message: string, pluginId?: string, options: AppErrorOptions = {}) {
    super(message, {
      severity: 'high',
      ...options,
      code: 'plugin.failed',
      details: { pluginId, ...options.details },
    });
    this.name = 'PluginExecutionError';
    this.pluginId = pluginId;
  }
}

/** Invalid configuration (settings, persisted project state). */
export class ConfigurationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { severity: 'high', ...options, code: 'config.invalid' });
    this.name = 'ConfigurationError';
  }
}
