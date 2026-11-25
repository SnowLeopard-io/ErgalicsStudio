// ==========================================================================
// Ergalics Studio — unified scientific output bus (pure TS)
//
// Plugins "compute then draw" but historically never spoke the numbers.
// This bus lets any plugin publish structured scientific metrics (fit
// quality, residuals, confidence intervals, convergence / conservation
// diagnostics) that the host renders in a dedicated strip beside the
// viewport — so every plot can be paired with its numerical conclusions.
//
// Host-context built-ins import this module directly; the strip subscribes
// per active plugin. Metrics are kept per plugin id, so switching plugins
// swaps the displayed conclusions automatically.
// ==========================================================================

/** Severity of a single scientific metric line. */
export type ScienceSeverity = 'ok' | 'warn' | 'error' | 'info';

/** One structured scientific conclusion (e.g. R², RMSE, energy drift). */
export interface ScienceMetric {
  /** Stable key within the plugin's metric set (dedupe id). */
  key: string;
  /** Human label, e.g. `R²`, `LOOCV RMSE`, `能量漂移`. */
  label: string;
  /** Formatted value, e.g. `0.987` or `1.2e-9`. Pre-formatted on purpose. */
  value: string;
  /** Unit suffix (`m/s²`, `%`, …) omitted for dimensionless quantities. */
  unit?: string;
  /** Colour semantics; defaults to `info`. */
  severity?: ScienceSeverity;
  /** One-line methodology note (tooltip). */
  hint?: string;
}

export interface ScienceOutputEntry {
  pluginId: string;
  metrics: ScienceMetric[];
  updatedAt: number;
  /** Id of the immutable ResultRecord that produced these metrics (FR-2). */
  resultId?: string;
  /** Publish counter — bumps on every setScienceOutputs so the UI can replay
   *  its entrance animation when genuinely fresh numbers arrive. */
  seq: number;
}

type Listener = (snapshot: Record<string, ScienceOutputEntry>) => void;

const outputs = new Map<string, ScienceOutputEntry>();
const listeners = new Set<Listener>();
// Cached snapshot: useSyncExternalStore requires getSnapshot to return the
// SAME object until the store changes, otherwise React re-renders forever.
let currentSnapshot: Record<string, ScienceOutputEntry> = {};

function refreshSnapshot(): void {
  const out: Record<string, ScienceOutputEntry> = {};
  for (const [id, entry] of outputs) out[id] = entry;
  currentSnapshot = out;
}

function emit(): void {
  refreshSnapshot();
  for (const l of listeners) {
    try {
      l(currentSnapshot);
    } catch {
      // A broken subscriber must never take down the publishing plugin.
    }
  }
}

// The result store registers a publisher at boot. Keeping the callback here
// (instead of importing the store) avoids a store → core → store cycle while
// still guaranteeing every metrics publish produces a ResultRecord.
export type ResultPublisher = (pluginId: string, metrics: ScienceMetric[]) => { resultId: string };
let resultPublisher: ResultPublisher | null = null;

export function setResultPublisher(publisher: ResultPublisher | null): void {
  resultPublisher = publisher;
}

/**
 * Publish (or replace) the scientific output set of one plugin. Pass an
 * empty array or call `clearScienceOutputs` when the plugin has no valid
 * results (e.g. no data loaded) so stale conclusions never linger.
 */
export function setScienceOutputs(pluginId: string, metrics: ScienceMetric[]): void {
  if (metrics.length === 0) {
    if (outputs.delete(pluginId)) emit();
    return;
  }
  const prev = outputs.get(pluginId);
  // 幂等发布：许多插件在 draw()/渲染路径里带着完全相同的数字反复调用
  // setScienceOutputs。每次都递增 `seq` 会让底部指标条重挂载、重放入场
  // 动画并从零重新 count-up——表现为“反复横跳”。只有指标内容真正变化
  // 才算新鲜数据。
  const next = JSON.stringify(metrics);
  const unchanged = !!prev && JSON.stringify(prev.metrics) === next;
  // Repeated identical numbers from draw() must not mint a new record. If the
  // very first publish happened before the publisher was registered, attach
  // provenance once without replaying the strip animation.
  if (unchanged && (!resultPublisher || prev?.resultId)) return;
  let resultId = prev?.resultId;
  try {
    resultId = resultPublisher?.(pluginId, metrics)?.resultId ?? resultId;
  } catch {
    // Provenance must never take down a computation; the numbers still show.
  }
  outputs.set(pluginId, {
    pluginId,
    metrics,
    updatedAt: unchanged ? (prev?.updatedAt ?? Date.now()) : Date.now(),
    ...(resultId ? { resultId } : {}),
    seq: unchanged ? (prev?.seq ?? 0) : (prev?.seq ?? 0) + 1,
  });
  emit();
}

/** Drop a plugin's published outputs (on unload / data reset). */
export function clearScienceOutputs(pluginId: string): void {
  if (outputs.delete(pluginId)) emit();
}

export function getScienceOutputs(): Record<string, ScienceOutputEntry> {
  return currentSnapshot;
}

export function subscribeScienceOutputs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- Shared formatting helpers -------------------------------------------

/**
 * Format a number with adaptive precision: 4 significant digits, switching
 * to exponential form for very small/large magnitudes. `NaN`/`Infinity`
 * render as `—` so a broken computation is visible, not silent.
 */
export function fmtMetric(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return v.toExponential(Math.max(1, digits - 1));
  return String(Number(v.toPrecision(digits)));
}
