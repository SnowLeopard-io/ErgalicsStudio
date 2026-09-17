// ==========================================================================
// Retry with exponential backoff, jitter and abort support
//
// Transient failures (WASM/worker warm-up races, IndexedDB reopening, network
// fetches for remote assets) should retry with capped exponential backoff,
// while validation errors and aborts must fail immediately. The helper keeps
// the policy in one place instead of ad-hoc `setTimeout` chains at call sites.
// ==========================================================================

import { AppError, OperationAbortedError, TimeoutError } from './AppError';
import { isAbortError, normalizeError } from './normalize';

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** First backoff delay in ms (default 100). */
  baseDelayMs?: number;
  /** Backoff cap in ms (default 5_000). */
  maxDelayMs?: number;
  /** Multiplicative jitter factor, 0..1 (default 0.2). */
  jitter?: number;
  /** External cancellation; rejects with OperationAbortedError. */
  signal?: AbortSignal;
  /** Decide per-error whether another attempt is worthwhile. */
  shouldRetry?: (error: AppError, attempt: number) => boolean;
  /** Observation hook for logging/tests. */
  onRetry?: (info: { error: AppError; attempt: number; nextDelayMs: number }) => void;
  /** Injected sleep (tests avoid real timers). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OperationAbortedError(undefined, { cause: signal.reason }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OperationAbortedError(undefined, { cause: signal?.reason }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Execute `fn` up to `attempts` times. Retries only when:
 *  - the signal is not aborted,
 *  - the error is not itself an abort,
 *  - `shouldRetry` (when provided) returns true,
 *  - attempts remain.
 *
 * The attempt number (1-based) and the signal are passed to `fn`.
 */
export async function retryAsync<T>(
  fn: (attempt: number, signal: AbortSignal | undefined) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5_000);
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0.2));
  const sleep = options.sleep ?? defaultSleep;
  const { signal, shouldRetry, onRetry } = options;

  if (signal?.aborted) {
    throw new OperationAbortedError(undefined, { cause: signal.reason });
  }

  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt, signal);
    } catch (caught) {
      const error = normalizeError(caught);
      lastError = error;

      if (isAbortError(error) || signal?.aborted) {
        throw error instanceof OperationAbortedError
          ? error
          : new OperationAbortedError(undefined, { cause: error });
      }
      const isLast = attempt === attempts;
      const allowed = shouldRetry ? shouldRetry(error, attempt) : error.retriable;
      if (isLast || !allowed) throw error;

      const spread = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
      const nextDelayMs = Math.min(maxDelayMs, Math.round(baseDelayMs * 2 ** (attempt - 1) * spread));
      onRetry?.({ error, attempt, nextDelayMs });
      await sleep(Math.max(0, nextDelayMs), signal);
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw lastError ?? new TimeoutError('retry exhausted without a result');
}
