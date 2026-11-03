// ==========================================================================
// Ergalics Studio — chunk-load retry wrapper for React.lazy
//
// Dynamic imports fail transiently in the wild: the dev server re-optimizes
// dependencies mid-session, a deploy swaps hashed chunk names, or the network
// hiccups. A bare `lazy(() => import(...))` surfaces that as a dead screen.
//
// `lazyRetry` silently retries the import a few times (short backoff) — most
// failures recover without the user ever noticing. If every attempt fails it
// throws a {@link ChunkLoadError}, which ErrorBoundary recognises and turns
// into a recovery card that leaves the decision to the user (retry remount vs
// full reload) — never an automatic page reload, which would interrupt
// running simulations and discard unsaved work.
// ==========================================================================

import { lazy, type ComponentType } from 'react';

/** Number of import attempts (1 initial + retries). */
const MAX_ATTEMPTS = 3;
/** Backoff between attempts; keeps retries off the hot path. */
const RETRY_DELAY_MS = 400;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Marker error so the ErrorBoundary can offer chunk-specific recovery. */
export class ChunkLoadError extends Error {
  constructor(public cause: unknown) {
    super('Failed to load a lazily imported module after retries');
    this.name = 'ChunkLoadError';
  }
}

/** True when the error came from a failed lazy-chunk import. */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof ChunkLoadError;
}

/**
 * Run a dynamic import with retries. Returns the module on success; throws
 * {@link ChunkLoadError} once every attempt has failed.
 */
export function retryImport<T>(loader: () => Promise<T>): Promise<T> {
  const attempt = async (n: number): Promise<T> => {
    try {
      return await loader();
    } catch (err) {
      if (n <= 0) throw new ChunkLoadError(err);
      await wait(RETRY_DELAY_MS * (MAX_ATTEMPTS - n));
      return attempt(n - 1);
    }
  };
  return attempt(MAX_ATTEMPTS - 1);
}

/**
 * React.lazy wrapper around {@link retryImport}. Accepts the same loader
 * shapes as `lazy`, including `import(...).then((m) => ({ default: m.Named }))`.
 */
export function lazyRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() => retryImport(loader));
}
