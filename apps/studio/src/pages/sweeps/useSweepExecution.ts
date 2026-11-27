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
import { useResultStore } from '@/stores/resultStore';
import { isAbortError, normalizeError, toErrorMessage } from '@/core/errors';
import { reportError } from '@/core/errors';

export type NotifyKind = 'success' | 'error' | 'info' | 'warning';
type NotifyFn = (kind: NotifyKind, message: string) => void;
export type TFn = (key: string, params?: Record<string, string | number>) => string;

interface SweepExecutionOptions {
  saveResult: (result: SweepResult) => void;
  notify: NotifyFn;
  t: TFn;
}

interface RunRequest {
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
            // The plan names the metric it wants ("Metric path"). The
            // evaluator produces ONE number, so publish it under the
            // configured path's last segment as well — otherwise every cell
            // failed with "metric … missing" as soon as the field was
            // changed from the default `value`.
            const tail = plan.metric.split('.').pop()?.trim() || 'value';
            const metrics: Record<string, number> = { value };
            if (tail !== 'value') metrics[tail] = value;
            const runRecord = await recordRun({
              source: 'sweep',
              label: `${plan.name} ${cell.key}`,
              params: cell.params,
              metrics,
              durationMs,
              seed: cell.seed,
              parentSweepId: plan.id,
            });
            return { runId: runRecord?.id ?? cell.key, metrics, durationMs };
          },
        });
        // A newer run may have superseded this controller on fast re-entry;
        // do not overwrite the live view with stale output.
        if (abortRef.current !== controller) return;
        setLiveResult(result);
        saveResult(result);
        // Every finished sweep is a trusted computation unit in its own
        // right, linked back to the source plugin's result when one exists.
        const values = result.cells.map((c) => c.value).filter(Number.isFinite);
        if (values.length > 0) {
          const parentResultId =
            useResultStore.getState().getLatest(plan.sourceRef)?.resultId;
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          useResultStore.getState().publishResult({
            pluginId: `sweep.${plan.id}`,
            pluginVersion: '1',
            parentResultId,
            params: {
              planId: plan.id,
              source: plan.source,
              sourceRef: plan.sourceRef,
              axes: plan.axes,
              expression: plan.expression,
              repeats: plan.repeats,
            },
            metrics: [
              { key: 'cells', label: 'Sweep cells', value: values.length, display: String(values.length) },
              {
                key: 'mean',
                label: 'Mean of evaluated cells',
                value: mean,
                display: String(Number(mean.toPrecision(6))),
                ...(plan.expression ? { formula: plan.expression } : {}),
              },
              {
                key: 'min',
                label: 'Minimum cell value',
                value: Math.min(...values),
                display: String(Math.min(...values)),
              },
              {
                key: 'max',
                label: 'Maximum cell value',
                value: Math.max(...values),
                display: String(Math.max(...values)),
              },
            ],
          });
        }
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
