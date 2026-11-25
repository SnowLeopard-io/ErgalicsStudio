// ==========================================================================
// ResultRecord construction and comparison (FR-1 / FR-3)
//
// Records are written once and never mutated. Publishing twice always
// mints a new resultId, so an old number can never be silently overwritten
// by a new run.
// ==========================================================================

import { canonicalize, canonicalJSON } from './canonical';
import type {
  ResultArtifact,
  ResultBenchmark,
  ResultComparisonRow,
  ResultEnvironment,
  ResultMetric,
  ResultRecord,
  ResultSource,
} from './types';

let registeredAppVersion = '2.1.0';

/** Set once at boot from the app manifest so records carry the real version. */
export function setAppVersion(version: string): void {
  if (version.trim()) registeredAppVersion = version;
}

export function getAppVersion(): string {
  return registeredAppVersion;
}

function newResultId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  // Exotic runtimes: keep the shape valid; real browsers always use UUID v4.
  return `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export interface CreateResultRecordArgs {
  pluginId: string;
  pluginVersion?: string;
  kernelVersion?: string;
  dataHash?: string;
  sources?: ResultSource[];
  params?: Record<string, unknown>;
  seed?: number;
  environment?: Partial<ResultEnvironment>;
  metrics?: ResultMetric[];
  artifacts?: ResultArtifact[];
  parentResultId?: string;
  benchmarks?: ResultBenchmark[];
  runId?: string;
  resultId?: string;
  createdAt?: string;
}

function defaultEnvironment(overrides: Partial<ResultEnvironment> = {}): ResultEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    appVersion: overrides.appVersion ?? registeredAppVersion,
    locale: overrides.locale ?? (nav?.language ?? 'zh-CN'),
    backend: overrides.backend ?? 'cpu',
    ...(overrides.userAgentFingerprint !== undefined
      ? { userAgentFingerprint: overrides.userAgentFingerprint }
      : {}),
  };
}

/** Build a frozen ResultRecord. Every call produces a distinct resultId. */
export function createResultRecord(args: CreateResultRecordArgs): ResultRecord {
  const record: ResultRecord = {
    resultId: args.resultId ?? newResultId(),
    createdAt: args.createdAt ?? new Date().toISOString(),
    pluginId: args.pluginId,
    pluginVersion: args.pluginVersion ?? 'unknown',
    ...(args.kernelVersion ? { kernelVersion: args.kernelVersion } : {}),
    input: {
      dataHash: args.dataHash ?? '',
      sources: args.sources ?? [],
    },
    params: canonicalize(args.params ?? {}) as Record<string, unknown>,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    environment: defaultEnvironment(args.environment),
    metrics: args.metrics ?? [],
    artifacts: args.artifacts ?? [],
    ...(args.parentResultId ? { parentResultId: args.parentResultId } : {}),
    ...(args.benchmarks ? { benchmarks: args.benchmarks } : {}),
    ...(args.runId ? { runId: args.runId } : {}),
  };
  return deepFreeze(record);
}

/**
 * A compatibility record for projects saved before `results` existed.
 * It carries no fabricated numbers — only the fact that the project predates
 * provenance capture, so the UI can say so instead of showing an empty list.
 */
export function createLegacyResult(projectId: string): ResultRecord {
  return createResultRecord({
    pluginId: 'legacy.project',
    pluginVersion: 'pre-provenance',
    params: { projectId },
    metrics: [{
      key: 'legacy',
      label: 'Legacy project (no provenance captured)',
      value: 'legacy',
      display: 'legacy',
      severity: 'warn',
      hint: 'This project was saved before trusted computation units were introduced.',
    }],
  });
}

function comparable(v: string | number | undefined): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(12))) : 'NaN';
  return v ?? '';
}

/** Side-by-side metric comparison for "reproduce this result" (FR-3). */
export function compareResults(original: ResultRecord, reproduced: ResultRecord): ResultComparisonRow[] {
  const byKey = new Map(reproduced.metrics.map((m) => [m.key, m]));
  return original.metrics.map((m) => {
    const other = byKey.get(m.key);
    const a = comparable(m.display ?? m.value);
    const b = comparable(other ? (other.display ?? other.value) : undefined);
    return {
      key: m.key,
      label: m.label,
      original: a,
      reproduced: b,
      matched: !!other && a === b,
    };
  });
}

/** Stable serialized form used for snapshot equality checks. */
export function recordFingerprint(record: ResultRecord): string {
  return canonicalJSON({
    pluginId: record.pluginId,
    params: record.params,
    input: record.input,
    seed: record.seed,
    metrics: record.metrics.map((m) => ({ key: m.key, value: m.value })),
  });
}
