// ==========================================================================
// Metric display formatting shared by the strip, provenance card, and the
// generated method description, so the "value already contains the unit"
// rule lives in exactly one place.
// ==========================================================================

import type { ResultMetric } from './types';

/**
 * Append `unit` to a formatted metric value unless the value already ends
 * with it (some plugins bake the unit into their display string, e.g.
 * "1135 ms" with unit "ms" — appending would print "1135 ms ms").
 */
export function appendMetricUnit(text: string, unit?: string): string {
  if (!unit) return text;
  return text.trimEnd().endsWith(unit.trim()) ? text : `${text} ${unit}`;
}

/** Display string for one metric: display ?? String(value), unit-aware. */
export function metricDisplayText(metric: Pick<ResultMetric, 'display' | 'value' | 'unit'>): string {
  return appendMetricUnit(metric.display ?? String(metric.value), metric.unit);
}
