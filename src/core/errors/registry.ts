// ==========================================================================
// Error observability registry
//
// One process-wide sink for *unexpected* failures: global window errors,
// unhandled promise rejections, React boundaries and explicit
// `reportError()` calls from catch blocks. Responsibilities:
//   - normalise every throw to an AppError,
//   - dedupe repeated identical crashes (a failing render loop used to flood
//     both console and UI), counting occurrences instead,
//   - keep a bounded ring for the diagnostics export,
//   - notify subscribers (UI surfaces) and the existing logger,
//   - install/teardown global handlers (used once from main.tsx).
// ==========================================================================

import { logger } from '@/core/logger';
import { AppError, OperationAbortedError } from './AppError';
import { normalizeError } from './normalize';

export interface ErrorEntry {
  id: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  error: AppError;
  context?: Record<string, unknown>;
}

export type ErrorListener = (entry: ErrorEntry) => void;

export interface ErrorReportOptions {
  /** Extra breadcrumb context (route, plugin, operation, …). */
  context?: Record<string, unknown>;
  /** Dedup key; defaults to `code:message`. Same key merges occurrences. */
  signature?: string;
  /** Skip console output (e.g. expected low-severity cancellations). */
  silent?: boolean;
}

const DEFAULT_RING_SIZE = 100;

class ErrorRegistryImpl {
  private entries = new Map<string, ErrorEntry>();
  private order: string[] = [];
  private listeners = new Set<ErrorListener>();
  private nextId = 1;
  private ringSize = DEFAULT_RING_SIZE;

  /** Report an arbitrary thrown value. Returns the normalised error. */
  report(caught: unknown, options: ErrorReportOptions = {}): AppError {
    const error = normalizeError(caught);
    const signature = options.signature ?? `${error.code}|${error.message}`.slice(0, 300);
    const now = new Date().toISOString();

    let entry = this.entries.get(signature);
    if (entry) {
      entry = { ...entry, lastSeen: now, occurrences: entry.occurrences + 1, error, context: options.context };
      this.entries.set(signature, entry);
    } else {
      entry = {
        id: this.nextId++,
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
        error,
        context: options.context,
      };
      this.entries.set(signature, entry);
      this.order.push(signature);
      if (this.order.length > this.ringSize) {
        const oldest = this.order.shift();
        if (oldest) this.entries.delete(oldest);
      }
    }

    if (!options.silent) this.emitLog(error, options.context);
    for (const listener of [...this.listeners]) {
      try {
        listener(entry);
      } catch (listenerError) {
        // A broken subscriber must never break error reporting.
        logger.error('error-registry', 'listener failed', listenerError);
      }
    }
    return error;
  }

  subscribe(listener: ErrorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Snapshot of recent entries, oldest first. */
  recent(): ErrorEntry[] {
    return this.order.map((signature) => this.entries.get(signature)!).filter(Boolean);
  }

  /** Aggregated severity counts (badges/status surfaces). */
  counts(): { low: number; medium: number; high: number; critical: number } {
    const counts = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const entry of this.entries.values()) counts[entry.error.severity] += 1;
    return counts;
  }

  clear(): void {
    this.entries.clear();
    this.order = [];
  }

  /** Test/teardown helper. */
  setRingSize(size: number): void {
    this.ringSize = Math.max(1, Math.floor(size));
    while (this.order.length > this.ringSize) {
      const oldest = this.order.shift();
      if (oldest) this.entries.delete(oldest);
    }
  }

  private emitLog(error: AppError, context?: Record<string, unknown>): void {
    const scope = `app-error:${error.code}`;
    const suffix = context ? { context } : undefined;
    if (error.severity === 'low') logger.debug(scope, error.message, suffix);
    else if (error.severity === 'medium') logger.warn(scope, error.message, suffix);
    else logger.error(scope, error, suffix);
  }
}

export const errorRegistry = new ErrorRegistryImpl();

/** Functional shortcut for call sites. */
export function reportError(caught: unknown, options?: ErrorReportOptions): AppError {
  return errorRegistry.report(caught, options);
}

// ---- global handlers -------------------------------------------------------

interface GlobalErrorShape {
  message?: string;
  error?: unknown;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface GlobalRejectionShape {
  reason?: unknown;
  promise?: Promise<unknown>;
}

export interface GlobalHandlerTeardown {
  (): void;
}

interface EventLikeTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

/**
 * Install `error` / `unhandledrejection` capture on the given target
 * (defaults to `globalThis`, which carries `window` in the browser). Returns
 * a teardown function. Idempotent per target: calling twice replaces the
 * previous installation.
 */
export function installGlobalErrorHandlers(target: EventLikeTarget = globalThis as EventLikeTarget): GlobalHandlerTeardown {
  const onError = (event: Event): void => {
    const detail = (typeof event === 'object' && event !== null ? event : {}) as GlobalErrorShape;
    const caught =
      detail.error ?? new AppError(detail.message || 'Uncaught error', { code: 'unknown' });
    reportError(caught, {
      context: {
        kind: 'global.error',
        filename: detail.filename,
        line: detail.lineno,
        column: detail.colno,
      },
    });
  };

  const onRejection = (event: Event): void => {
    const detail = (typeof event === 'object' && event !== null ? event : {}) as GlobalRejectionShape;
    const reason = detail.reason ?? new AppError('Unhandled promise rejection', { code: 'unknown' });
    const abort =
      reason instanceof OperationAbortedError ||
      (reason instanceof DOMException && reason.name === 'AbortError') ||
      (reason instanceof Error && reason.name === 'AbortError');
    // Benign cancellations are recorded quietly so the diagnostics ring still
    // shows them but they never masquerade as crashes in the console.
    reportError(reason, { context: { kind: 'global.unhandledrejection' }, silent: abort });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
