// ==========================================================================
// In-app reproduction check (FR-3 / FR-5)
//
// Re-runs a computation from the recorded inputs and compares every metric.
// A metric with a published, machine-checkable `formula` is recomputed; one
// without a formula is explicitly marked unverifiable — never silently
// copied from the original record and called a match.
// ==========================================================================

import { compareResults } from './record';
import type {
  CreateResultRecordArgs,
} from './record';
import type { ResultComparisonRow, ResultMetric, ResultRecord } from './types';

/** Narrow allow-list: expressions come from the app's own records, but a
 *  `.clproj` is untrusted input, so never hand it arbitrary JS. */
const SAFE_EXPR = /^[\w\s+\-*/%().,'"[\]]{1,500}$/;
const BANNED_TOKENS = /(__|constructor|prototype|globalThis|window|document|process|eval|Function|import)/;

export function evaluateFormula(
  expression: string,
  params: Record<string, unknown>,
  metrics: Record<string, string | number>,
): number | null {
  if (!SAFE_EXPR.test(expression) || BANNED_TOKENS.test(expression)) return null;
  try {
    const fn = new Function(
      'p',
      'm',
      `"use strict"; return (${expression});`,
    ) as (p: Record<string, unknown>, m: Record<string, string | number>) => unknown;
    const value = Number(fn(params, metrics));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export interface ReproductionOutcome {
  record: ResultRecord;
  comparison: ResultComparisonRow[];
  /** Metrics that could not be independently recomputed, with the reason. */
  unverifiable: string[];
}

export function reproduceResult(
  original: ResultRecord,
  publish: (args: CreateResultRecordArgs) => ResultRecord,
): ReproductionOutcome {
  const originalValues: Record<string, string | number> = {};
  for (const m of original.metrics) originalValues[m.key] = m.value;

  const unverifiable: string[] = [];
  const reproduced: ResultMetric[] = original.metrics.map((m) => {
    if (!m.formula) {
      unverifiable.push(
        `${m.key}: no machine-checkable formula was recorded for this metric; ` +
          `use the downloaded reproduce.py script or re-run the plugin manually.`,
      );
      return {
        key: m.key,
        label: m.label,
        value: 'unverified',
        display: 'unverified',
        severity: 'warn',
        ...(m.unit ? { unit: m.unit } : {}),
      };
    }
    const value = evaluateFormula(m.formula, original.params, originalValues);
    if (value === null) {
      unverifiable.push(`${m.key}: formula "${m.formula}" could not be evaluated.`);
      return {
        key: m.key,
        label: m.label,
        value: 'unverified',
        display: 'unverified',
        severity: 'warn',
      };
    }
    return {
      key: m.key,
      label: m.label,
      value,
      display: String(Number(value.toPrecision(12))),
      severity: 'ok',
      ...(m.unit ? { unit: m.unit } : {}),
      formula: m.formula,
    };
  });

  const record = publish({
    pluginId: original.pluginId,
    pluginVersion: original.pluginVersion,
    ...(original.kernelVersion ? { kernelVersion: original.kernelVersion } : {}),
    dataHash: original.input.dataHash,
    sources: original.input.sources,
    params: original.params,
    ...(original.seed !== undefined ? { seed: original.seed } : {}),
    environment: original.environment,
    parentResultId: original.resultId,
    metrics: reproduced,
  });

  return { record, comparison: compareResults(original, record), unverifiable };
}
