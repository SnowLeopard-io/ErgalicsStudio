// ==========================================================================
// Ergalics Studio — build provenance attestations (pure TS)
//
// A build run already knows, per step, *what* was computed (`key`), *why* it
// ran (`status` / `reason`) and *what came out* (`output` hash). This module
// freezes that into a portable, tamper-evident attestation:
//
//   digest = H(schema, plan id + hash, environment, step decisions, outputs)
//
// Runtime measures (createdAt, durations) are deliberately excluded from the
// digest, so two machines that run the same plan on the same inputs produce
// byte-identical attestations — the executable counterpart of `repro.lock`.
// Attestations are plain JSON, never signed here; callers may archive them,
// attach them to a publication, or diff them across devices.
// ==========================================================================

import { hashValue } from './hash';
import type { BuildEnvironment } from './key';
import type { BuildPlan, BuildStep } from './plan';
import type { BuildStats, StepDecisionStatus } from './engine';

/** Bump when the attestation layout changes (the digest covers the schema). */
export const BUILD_ATTESTATION_SCHEMA = 'ergalics.build-attestation/v1';

export interface AttestedStep {
  id: string;
  kind: string;
  /** Content address of the step's result (empty when blocked). */
  key: string;
  status: StepDecisionStatus;
  reason: string;
  cacheable: boolean;
  /** Hash of the executor source ("code" key component). */
  implementation?: string;
  /** Hash of the params component of the cache key. */
  paramsHash?: string;
  /** Hash of the port → upstream-key component. */
  inputsHash?: string;
  /** Port → upstream content key actually consumed. */
  inputKeys?: Record<string, string>;
  /** Full-content hash of the produced value (absent for blocked steps). */
  outputHash?: string;
  /** Cache hits that came from IndexedDB rather than this session. */
  fromPersistence?: boolean;
  /** Wall-clock cost; excluded from the digest (machine-dependent). */
  durationMs: number;
}

export interface BuildAttestationTotals {
  total: number;
  computed: number;
  cached: number;
  blocked: number;
  failed: number;
  concurrency: number;
  /** Cached / (cached + computed), 0 when nothing ran. */
  cacheHitRate: number;
}

export interface BuildAttestation {
  schema: string;
  /** Wall-clock creation time; excluded from the digest. */
  createdAt: number;
  planId: string;
  planHash: string;
  environment: BuildEnvironment;
  environmentFingerprint: string;
  totals: BuildAttestationTotals;
  /** Topological order, matching the engine's deterministic report. */
  steps: AttestedStep[];
  /** Step id → output content hash, in topological order. */
  outputs: Record<string, string>;
  /** Tamper-evident digest over everything except runtime measures. */
  digest: string;
}

export interface CreateAttestationArgs {
  plan: BuildPlan;
  stats: BuildStats;
  environment: BuildEnvironment;
  /** Overridable for deterministic tests; defaults to `Date.now()`. */
  createdAt?: number;
}

function stepById(plan: BuildPlan): Map<string, BuildStep> {
  const byId = new Map<string, BuildStep>();
  for (const step of plan.steps) byId.set(step.id, step);
  return byId;
}

/** Hash of the deterministic portion of an attestation. */
export function attestationDigest(
  attestation: Omit<BuildAttestation, 'digest'>,
): string {
  const steps = attestation.steps.map((step) => {
    // Runtime measures never change what was computed.
    const { durationMs: _durationMs, ...rest } = step;
    return rest;
  });
  return hashValue({
    schema: attestation.schema,
    planId: attestation.planId,
    planHash: attestation.planHash,
    environment: attestation.environment,
    environmentFingerprint: attestation.environmentFingerprint,
    totals: {
      total: attestation.totals.total,
      computed: attestation.totals.computed,
      cached: attestation.totals.cached,
      blocked: attestation.totals.blocked,
      failed: attestation.totals.failed,
      concurrency: attestation.totals.concurrency,
    },
    steps,
    outputs: attestation.outputs,
  });
}

/** Freeze a completed build run into a verifiable attestation. */
export function createBuildAttestation(args: CreateAttestationArgs): BuildAttestation {
  const { plan, stats, environment } = args;
  const byId = stepById(plan);
  const steps: AttestedStep[] = stats.steps.map((decision) => {
    const step = byId.get(decision.id);
    const outputHash = stats.outputs[decision.id];
    return {
      id: decision.id,
      kind: decision.kind,
      key: decision.key,
      status: decision.status,
      reason: decision.reason,
      cacheable: decision.cacheable,
      ...(step?.implementation ? { implementation: step.implementation } : {}),
      ...(decision.breakdown
        ? {
            paramsHash: decision.breakdown.params,
            inputsHash: decision.breakdown.inputs,
            inputKeys: { ...decision.breakdown.inputKeys },
          }
        : {}),
      ...(outputHash ? { outputHash } : {}),
      ...(decision.fromPersistence !== undefined
        ? { fromPersistence: decision.fromPersistence }
        : {}),
      durationMs: decision.durationMs,
    };
  });

  const ran = stats.cached + stats.computed;
  const totals: BuildAttestationTotals = {
    total: stats.total,
    computed: stats.computed,
    cached: stats.cached,
    blocked: stats.blocked,
    failed: stats.failed,
    concurrency: stats.concurrency,
    cacheHitRate: ran > 0 ? stats.cached / ran : 0,
  };

  const unsigned: Omit<BuildAttestation, 'digest'> = {
    schema: BUILD_ATTESTATION_SCHEMA,
    createdAt: args.createdAt ?? Date.now(),
    planId: stats.planId,
    planHash: stats.planHash,
    environment,
    environmentFingerprint: stats.environment,
    totals,
    steps,
    outputs: { ...stats.outputs },
  };

  return { ...unsigned, digest: attestationDigest(unsigned) };
}

export interface AttestationVerification {
  ok: boolean;
  issues: string[];
}

/**
 * Structural + digest verification. This proves the JSON was not edited after
 * the build; it does **not** re-run the computation (that is what the cache
 * keys and `repro.lock` are for).
 */
export function verifyBuildAttestation(value: unknown): AttestationVerification {
  const issues: string[] = [];
  if (value === null || typeof value !== 'object') {
    return { ok: false, issues: ['attestation is not an object'] };
  }
  const a = value as Partial<BuildAttestation>;
  if (a.schema !== BUILD_ATTESTATION_SCHEMA) {
    issues.push(`unsupported schema: ${String(a.schema)}`);
  }
  if (typeof a.digest !== 'string' || a.digest.length === 0) {
    issues.push('missing digest');
  }
  if (!Array.isArray(a.steps)) {
    issues.push('missing steps');
  }
  if (!a.totals || typeof a.totals.total !== 'number') {
    issues.push('missing totals');
  }
  if (issues.length > 0) return { ok: false, issues };

  const steps = a.steps as AttestedStep[];
  const totals = a.totals as BuildAttestationTotals;
  const count = (status: StepDecisionStatus): number =>
    steps.filter((s) => s.status === status).length;
  if (totals.total !== steps.length) {
    issues.push(`total ${totals.total} does not match ${steps.length} steps`);
  }
  for (const status of ['computed', 'cached', 'blocked', 'failed'] as const) {
    const declared = totals[status];
    const actual = count(status);
    if (declared !== actual) {
      issues.push(`${status} count ${declared} does not match ${actual}`);
    }
  }
  const { digest, createdAt: _createdAt, ...rest } = a as BuildAttestation;
  const recomputed = attestationDigest({ ...rest, createdAt: 0 });
  if (recomputed !== digest) {
    issues.push('digest mismatch');
  }
  return { ok: issues.length === 0, issues };
}

/** Stable, human-inspectable JSON for archiving. */
export function attestationToJson(attestation: BuildAttestation): string {
  return JSON.stringify(attestation, null, 2);
}
