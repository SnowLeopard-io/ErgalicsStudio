// ==========================================================================
// Ergalics Studio — Python runtime availability (host-level status)
//
// Several surfaces boot a Pyodide interpreter independently: code mode, the
// notebook store and the solver plugins (each in its own worker). They all
// download the same vendored /pyodide/ bundle, which takes tens of seconds on
// a cold cache. Without a shared signal the UI showed nothing while that
// happened and a failed boot only surfaced much later as a generic compute
// error.
//
// This store aggregates the boots that are currently in flight so the
// workbench can show one explicit "Python runtime is loading" notice and a
// failure with a retry path.
// ==========================================================================

import { create } from 'zustand';

export type PythonRuntimeSource = 'code' | 'notebook' | 'solver';

export type PythonRuntimePhase = 'idle' | 'loading' | 'ready' | 'failed';

interface PythonRuntimeState {
  phase: PythonRuntimePhase;
  /** Number of boots currently in flight (aggregated across surfaces). */
  active: number;
  /** Last failure message, cleared as soon as a new boot starts. */
  error: string | null;
  /**
   * True when every in-flight boot is a background warm-up — the notice is
   * only shown for boots the user is actually waiting on (or for failures).
   */
  silent: boolean;
  /**
   * True when the notice was dismissed by the user. A dismissal only hides
   * the banner; the next failure/boot shows it again.
   */
  dismissed: boolean;
}

export const usePythonRuntimeStatus = create<PythonRuntimeState>(() => ({
  phase: 'idle',
  active: 0,
  error: null,
  silent: false,
  dismissed: false,
}));

/** Set when at least one interpreter finished booting in this session. */
let everReady = false;
/** One token per in-flight boot; removed when that boot settles. */
const activeTokens = new Map<string, { silent: boolean }>();
let tokenSeq = 0;
const retryHandlers = new Set<() => void>();

function publish(): void {
  const failed = usePythonRuntimeStatus.getState().error !== null;
  const phase: PythonRuntimePhase = failed
    ? 'failed'
    : activeTokens.size > 0
      ? 'loading'
      : everReady
        ? 'ready'
        : 'idle';
  const silent = activeTokens.size > 0 && [...activeTokens.values()].every((b) => b.silent);
  usePythonRuntimeStatus.setState({ phase, active: activeTokens.size, silent });
}

/**
 * Register a boot. Returns the token to pass to ready/fail — never reuse a
 * token, a worker that respawns is a new boot.
 */
export function pythonRuntimeBegin(
  source: PythonRuntimeSource,
  opts: { silent?: boolean } = {},
): string {
  const token = `${source}:${++tokenSeq}`;
  activeTokens.set(token, { silent: opts.silent === true });
  usePythonRuntimeStatus.setState({ error: null, dismissed: false });
  publish();
  return token;
}

/** A boot finished successfully. */
export function pythonRuntimeReady(token: string): void {
  activeTokens.delete(token);
  everReady = true;
  publish();
}

/** A boot was cancelled (user aborted) — not a runtime failure. */
export function pythonRuntimeCancel(token: string): void {
  activeTokens.delete(token);
  publish();
}

/** A boot failed; the message is surfaced verbatim in the notice. */
export function pythonRuntimeFail(token: string, error: unknown): void {
  activeTokens.delete(token);
  const message = error instanceof Error ? error.message : String(error);
  usePythonRuntimeStatus.setState({ error: message, dismissed: false });
  publish();
}

/** True while any interpreter boot is in flight. */
export function isPythonRuntimeLoading(): boolean {
  return activeTokens.size > 0;
}

/** Hide the failure notice until the next boot/failure. */
export function dismissPythonRuntimeNotice(): void {
  usePythonRuntimeStatus.setState({ dismissed: true });
}

/**
 * Retry hook for the failure notice. Surfaces register how to re-attempt
 * their own boot; the notice's button runs all of them.
 */
export function registerPythonRuntimeRetry(handler: () => void): () => void {
  retryHandlers.add(handler);
  return () => retryHandlers.delete(handler);
}

export function retryPythonRuntime(): void {
  usePythonRuntimeStatus.setState({ error: null, dismissed: false });
  publish();
  for (const handler of retryHandlers) {
    try {
      handler();
    } catch {
      /* a failing retry handler must not block the others */
    }
  }
}
