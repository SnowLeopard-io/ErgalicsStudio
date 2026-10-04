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
}

type Listener = (snapshot: Record<string, ScienceOutputEntry>) => void;

const outputs = new Map<string, ScienceOutputEntry>();
const listeners = new Set<Listener>();

function snapshot(): Record<string, ScienceOutputEntry> {
  const out: Record<string, ScienceOutputEntry> = {};
  for (const [id, entry] of outputs) out[id] = entry;
  return out;
}

function emit(): void {
  const snap = snapshot();
  for (const l of listeners) {
    try {
      l(snap);
    } catch {
      // A broken subscriber must never take down the publishing plugin.
    }
  }
}

/**
 * Publish (or replace) the scientific output set of one plugin. Pass an
 * empty array or call `clearScienceOutputs` when the plugin has no valid
 * results (e.g. no data loaded) so stale conclusions never linger.
 */
export function setScienceOutputs(pluginId: string, metrics: ScienceMetric[]): void {
  if (metrics.length === 0) {
    outputs.delete(pluginId);
  } else {
    outputs.set(pluginId, { pluginId, metrics, updatedAt: Date.now() });
  }
  emit();
}

/** Drop a plugin's published outputs (on unload / data reset). */
export function clearScienceOutputs(pluginId: string): void {
  if (outputs.delete(pluginId)) emit();
}

export function getScienceOutputs(): Record<string, ScienceOutputEntry> {
  return snapshot();
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
