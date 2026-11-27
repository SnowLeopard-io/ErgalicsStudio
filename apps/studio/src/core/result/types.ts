// ==========================================================================
// Ergalics Studio — trusted computation unit (FR-1)
//
// A ResultRecord is the immutable, portable snapshot of one computation.
// Every display surface (metric strip, Figure Studio, exports, AI answers)
// reads from it; none of them recompute numbers from plugin internal state.
// ==========================================================================

export type ResultSeverity = 'ok' | 'warn' | 'error' | 'info';

/** One auditable numerical conclusion. */
export interface ResultMetric {
  /** Stable key within one result (dedupe id). */
  key: string;
  /** Human label, already localized at publish time. */
  label: string;
  /** Machine-readable value. `display` is what the UI shows verbatim. */
  value: string | number;
  /** Pre-formatted value; when absent the UI formats `value` without recomputation. */
  display?: string;
  unit?: string;
  severity?: ResultSeverity;
  /** One-line methodology note. */
  hint?: string;
  /** Optional Python expression used by the standalone reproduction script (FR-5). */
  formula?: string;
}

/** An input file fingerprint. Hash is SHA-256 of the original bytes. */
export interface ResultSource {
  name: string;
  hash: string;
  rows?: number;
  columns?: number;
}

/** An exported or stored artifact bound to the result. */
export interface ResultArtifact {
  kind: 'svg' | 'png' | 'pdf' | 'csv' | 'json';
  name: string;
  hash: string;
  dpi?: number;
}

export interface ResultBenchmark {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ResultEnvironment {
  appVersion: string;
  locale: string;
  backend: 'cpu' | 'webgpu' | string;
  userAgentFingerprint?: string;
}

export interface ResultRecord {
  resultId: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  pluginId: string;
  pluginVersion: string;
  kernelVersion?: string;
  input: {
    dataHash: string;
    sources: ResultSource[];
  };
  /** Full parameter snapshot including defaults, keys sorted canonically. */
  params: Record<string, unknown>;
  seed?: number;
  environment: ResultEnvironment;
  metrics: ResultMetric[];
  artifacts: ResultArtifact[];
  /** Sweep / derived computations point at the result they came from. */
  parentResultId?: string;
  benchmarks?: ResultBenchmark[];
  /** Link to the execution-history RunRecord (IndexedDB), when one exists. */
  runId?: string;
}

/** One row of the side-by-side comparison produced by "reproduce this result". */
export interface ResultComparisonRow {
  key: string;
  label: string;
  original: string;
  reproduced: string;
  matched: boolean;
}
