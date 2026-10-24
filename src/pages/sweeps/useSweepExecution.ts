// ==========================================================================
// Sweep Studio — execution orchestration hook
//
// Owns run/resume/cancel lifecycle state (running flag, progress, live
// partial result, abort controller) so page components stay declarative.
// Every cell becomes a child experiment run; cancellation is an expected
// outcome that persists a resumable partial result, never a crash toast.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { runSweep } from '@/core/sweep/runner';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import { useExperimentStore } from '@/stores/experimentStore';
import { isAbortError, normalizeError, toErrorMessage } from '@/core/errors';
import { reportError } from '@/core/errors';

export type NotifyKind = 'success' | 'error' | 'info' | 'warning';
export type NotifyFn = (kind: NotifyKind, message: string) => void;
export type TFn = (key: string, params?: Record<string, string | number>) => string;

export interface SweepExecutionOptions {
  saveResult: (result: SweepResult) => void;
  notify: NotifyFn;
  t: TFn;
}

export interface RunRequest {
  plan: SweepPlan;
  resume: boolean;
  existing: SweepResult | null;
}

export function useSweepExecution({ saveResult, notify, t }: SweepExecutionOptions) {
  const recordRun = useExperimentStore((state) => state.recordRun);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [liveResult, setLiveResult] = useState<SweepResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight sweep when the host unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => setLiveResult(null), []);
  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const run = useCallback(
    async ({ plan, resume, existing }: RunRequest): Promise<void> => {
      let evaluator: (params: Record<string, unknown>) => number;
      try {
        const expr = plan.expression?.trim() || 'p.a';
         
        const fn = new Function('p', `"use strict"; return (${expr});`) as (
          params: Record<string, unknown>,
        ) => unknown;
        evaluator = (params) => Number(fn(params));
      } catch (caught) {
        notify('error', t('sweep.plan_invalid', { reason: toErrorMessage(caught) }));
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setProgress({ done: 0, total: 0 });
      try {
        const result = await runSweep(plan, {
          existing: resume ? existing : null,
          signal: controller.signal,
          onProgress: (done, total, partial) => {
            // Ignore progress from a run of a different plan (plan switched
            // before the last async callback flushed).
            if (partial.planId !== plan.id) return;
            setProgress({ done, total });
            setLiveResult(partial);
          },
          executor: async (cell) => {
            const started = performance.now();
            if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
            const value = evaluator(cell.flatParams);
            const durationMs = Math.max(0, Math.round(performance.now() - started));
            const runRecord = await recordRun({
              source: 'sweep',
              label: `${plan.name} ${cell.key}`,
              params: cell.params,
              metrics: { value },
              durationMs,
              seed: cell.seed,
              parentSweepId: plan.id,
            });
            return { runId: runRecord?.id ?? cell.key, metrics: { value }, durationMs };
          },
        });
        // A newer run may have superseded this controller on fast re-entry;
        // do not overwrite the live view with stale output.
        if (abortRef.current !== controller) return;
        setLiveResult(result);
        saveResult(result);
        if (result.status === 'done') notify('success', t('sweep.status_done'));
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) {
          // Expected: partial result was already streamed via onProgress and
          // persisted there for cancelled runs (runner returns a result);
          // a throw here means cancellation before the first cell finished.
          if (abortRef.current === controller) {
            reportError(normalizeError(caught), { context: { scope: 'sweep', planId: plan.id }, silent: true });
          }
          return;
        }
        if (abortRef.current === controller) {
          reportError(caught, { context: { scope: 'sweep', planId: plan.id } });
          notify('error', t('sweep.plan_invalid', { reason: toErrorMessage(caught) }));
        }
      } finally {
        if (abortRef.current === controller) {
          setRunning(false);
          abortRef.current = null;
        }
      }
    },
    [recordRun, saveResult, notify, t],
  );

  return { running, progress, liveResult, reset, cancel, run };
}
