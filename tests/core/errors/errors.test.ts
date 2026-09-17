// ==========================================================================
// Structured error taxonomy — hierarchy, normalisation, Result, retry,
// guards, observability registry and global handler installation.
// ==========================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AppError,
  OperationAbortedError,
  ValidationError,
  ComputeError,
  IoError,
  isAbortError,
  normalizeError,
  ok,
  err,
  wrapSync,
  wrapAsync,
  unwrapOr,
  partitionResults,
  retryAsync,
  invariant,
  assertRange,
  assertFiniteNumber,
  assertNonEmptyString,
  errorRegistry,
  installGlobalErrorHandlers,
} from '@/core/errors';

describe('AppError taxonomy', () => {
  it('applies class defaults and preserves options', () => {
    const generic = new AppError('boom');
    expect(generic.code).toBe('unknown');
    expect(generic.severity).toBe('high');
    expect(generic.retriable).toBe(false);

    const io = new IoError('network down');
    expect(io.code).toBe('io.network');
    expect(io.retriable).toBe(true);
    expect(io.severity).toBe('medium');

    const compute = new ComputeError('kernel panic', { retriable: false });
    expect(compute.code).toBe('compute.failed');
    expect(compute.retriable).toBe(false);
  });

  it('serialises the full cause chain', () => {
    const root = new AppError('root', { details: { a: 1 } });
    const middle = new ComputeError('middle', { cause: root });
    const top = new AppError('top', { cause: middle });
    const json = top.toJSON();
    expect(json.message).toBe('top');
    expect(json.cause?.message).toBe('middle');
    expect(json.cause?.cause?.message).toBe('root');
    expect(json.cause?.cause?.details).toEqual({ a: 1 });

    const messages = [...top.causes()].map((e) => e.message);
    expect(messages).toEqual(['top', 'middle', 'root']);
  });

  it('builds ValidationError from issues', () => {
    const error = ValidationError.fromIssues([
      { path: ['axes', 0], code: 'required', message: 'missing' },
    ]);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('validation.failed');
    expect(error.issues).toHaveLength(1);
  });
});

describe('normalizeError', () => {
  it('passes AppError through unchanged', () => {
    const error = new ComputeError('x');
    expect(normalizeError(error)).toBe(error);
  });

  it('maps abort shapes to OperationAbortedError', () => {
    expect(normalizeError(new DOMException('aborted', 'AbortError'))).toBeInstanceOf(
      OperationAbortedError,
    );
    expect(isAbortError(new OperationAbortedError())).toBe(true);
    expect(isAbortError(new DOMException('a', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('ordinary'))).toBe(false);
  });

  it('wraps strings, Errors and null', () => {
    const fromString = normalizeError('boom');
    expect(fromString).toBeInstanceOf(AppError);
    expect(fromString.message).toBe('boom');

    const fromError = normalizeError(new TypeError('bad type'));
    expect(fromError.message).toBe('bad type');
    expect(fromError).not.toBeInstanceOf(TypeError);
    expect(fromError.cause).toBeInstanceOf(TypeError);

    expect(normalizeError(null).message).toBe('null');
    expect(normalizeError({ code: 42 }).message).toBe('Unknown structured error');
  });
});

describe('Result', () => {
  it('wraps synchronous success/failure', () => {
    expect(wrapSync(() => 1 + 1)).toEqual(ok(2));
    const failed = wrapSync(() => {
      throw new Error('x');
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBeInstanceOf(AppError);
  });

  it('wraps async success/failure', async () => {
    await expect(wrapAsync(Promise.resolve(7))).resolves.toEqual(ok(7));
    const failed = await wrapAsync(Promise.reject(new Error('async boom')));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toBe('async boom');

    const factory = await wrapAsync(async () => 42);
    expect(factory).toEqual(ok(42));
  });

  it('unwraps with fallback and partitions batches', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err(new AppError('x')), 9)).toBe(9);
    expect(
      unwrapOr(err(new AppError('x')), (error) => error.message.length),
    ).toBe(1);

    const { values, errors } = partitionResults([ok(1), err('bad'), ok(3)]);
    expect(values).toEqual([1, 3]);
    expect(errors).toEqual(['bad']);
  });
});

describe('retryAsync', () => {
  const immediateSleep = () => Promise.resolve();

  it('returns the first successful attempt', async () => {
    const fn = vi.fn(async () => 'done');
    await expect(retryAsync(fn, { sleep: immediateSleep })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retriable errors then succeeds', async () => {
    const onRetry = vi.fn();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new IoError('flaky');
      return 'ok';
    });
    await expect(
      retryAsync(fn, { attempts: 4, baseDelayMs: 0, onRetry, sleep: immediateSleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retriable errors', async () => {
    const fn = vi.fn(async () => {
      throw new ComputeError('fatal');
    });
    await expect(retryAsync(fn, { attempts: 5, sleep: immediateSleep })).rejects.toBeInstanceOf(
      ComputeError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours shouldRetry and pre-aborted signals', async () => {
    const fn = vi.fn(async () => {
      throw new IoError('nope');
    });
    await expect(
      retryAsync(fn, {
        attempts: 4,
        shouldRetry: () => false,
        sleep: immediateSleep,
      }),
    ).rejects.toBeInstanceOf(IoError);
    expect(fn).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    await expect(
      retryAsync(async () => 'never', { signal: controller.signal, sleep: immediateSleep }),
    ).rejects.toBeInstanceOf(OperationAbortedError);
  });
});

describe('guards', () => {
  it('invariant and range guards throw typed errors', () => {
    expect(() => invariant(false, 'no')).toThrow(ValidationError);
    expect(() => assertRange(5, 0, 3)).toThrow(/within/);
    expect(() => assertRange(2, 0, 3)).not.toThrow();
    expect(() => assertFiniteNumber(Number.NaN)).toThrow(/finite/);
    expect(assertNonEmptyString('  x ')).toBe('x');
    expect(() => assertNonEmptyString('   ')).toThrow(ValidationError);
  });
});

describe('errorRegistry + global handlers', () => {
  beforeEach(() => {
    errorRegistry.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dedupes identical reports by counting occurrences', () => {
    errorRegistry.report(new ComputeError('same'));
    errorRegistry.report(new ComputeError('same'));
    errorRegistry.report(new ComputeError('other'));
    const entries = errorRegistry.recent();
    expect(entries).toHaveLength(2);
    const first = entries.find((e) => e.error.message === 'same')!;
    expect(first.occurrences).toBe(2);
    // counts() reflects distinct signatures…
    expect(errorRegistry.counts().high).toBe(2);
    // …while occurrence totals preserve the raw event volume.
    expect(entries.reduce((sum, entry) => sum + entry.occurrences, 0)).toBe(3);
  });

  it('notifies subscribers and allows unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = errorRegistry.subscribe(listener);
    errorRegistry.report(new AppError('ping'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    errorRegistry.report(new AppError('pong'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('captures error/unhandledrejection events on the target', () => {
    const handlers = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) => handlers.set(type, listener),
      removeEventListener: (type: string) => handlers.delete(type),
    };

    const teardown = installGlobalErrorHandlers(target as unknown as EventTarget);
    expect(handlers.has('error')).toBe(true);
    expect(handlers.has('unhandledrejection')).toBe(true);

    handlers.get('error')!({ message: 'crash', error: new Error('crash') } as unknown as Event);
    handlers.get('unhandledrejection')!({
      reason: new DOMException('aborted', 'AbortError'),
    } as unknown as Event);

    const entries = errorRegistry.recent();
    expect(entries.some((e) => e.error.message === 'crash')).toBe(true);
    expect(entries.some((e) => e.error instanceof OperationAbortedError)).toBe(true);

    teardown();
    expect(handlers.has('error')).toBe(false);
    expect(handlers.has('unhandledrejection')).toBe(false);
  });
});
