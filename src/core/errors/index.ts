// ==========================================================================
// Error taxonomy & resilience — public surface
// ==========================================================================

export {
  AppError,
  OperationAbortedError,
  ValidationError,
  DataError,
  StorageError,
  IoError,
  ComputeError,
  TimeoutError,
  PluginExecutionError,
  ConfigurationError,
} from './AppError';
export type {
  AppErrorOptions,
  ErrorCode,
  ErrorSeverity,
  SerializedError,
} from './AppError';

export { isAbortError, normalizeError, toErrorMessage } from './normalize';

export {
  ok,
  err,
  wrapSync,
  wrapAsync,
  mapResult,
  unwrapOr,
  partitionResults,
} from './result';
export type { Result } from './result';

export { retryAsync } from './retry';
export type { RetryOptions } from './retry';

export {
  invariant,
  assertDefined,
  assertFiniteNumber,
  assertInteger,
  assertRange,
  assertNonEmptyString,
  assertArray,
  assertNever,
} from './guards';

export {
  errorRegistry,
  reportError,
  installGlobalErrorHandlers,
} from './registry';
export type {
  ErrorEntry,
  ErrorListener,
  ErrorReportOptions,
  GlobalHandlerTeardown,
} from './registry';
