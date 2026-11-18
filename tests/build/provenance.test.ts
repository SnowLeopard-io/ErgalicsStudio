import { describe, expect, it } from 'vitest';
import {
  BUILD_ATTESTATION_SCHEMA,
  attestationDigest,
  createBuildAttestation,
  verifyBuildAttestation,
  type BuildAttestation,
} from '@/core/build/provenance';
import type { BuildPlan } from '@/core/build/plan';
import type { BuildStats, StepDecision } from '@/core/build/engine';
import type { BuildEnvironment } from '@/core/build/key';

const environment: BuildEnvironment = {
  appVersion: '1.2.3',
  schemaVersion: 'ergalics.build-key/v1',
  capabilities: { gpu: 'webgpu' },
};

const plan: BuildPlan = {
  id: 'plan-1',
  steps: [
    { id: 'a', kind: 'source', params: { path: 'x.csv' }, inputs: {}, implementation: 'impl-a' },
    { id: 'b', kind: 'transform', params: { k: 2 }, inputs: { in: 'a' }, implementation: 'impl-b' },
  ],
};

const decision = (
  id: string,
  status: StepDecision['status'],
  key: string,
  overrides: Partial<StepDecision> = {},
): StepDecision => ({
  id,
  kind: id === 'a' ? 'source' : 'transform',
  status,
  key,
  reason: status === 'cached' ? 'cache-hit' : 'computed',
  cacheable: status !== 'blocked' && status !== 'failed',
  durationMs: 1,
  ...overrides,
});

const stats: BuildStats = {
  planId: 'plan-1',
  planHash: 'planhash-1234',
  environment: 'envhash-5678',
  total: 2,
  computed: 1,
  cached: 1,
  blocked: 0,
  failed: 0,
  durationMs: 9,
  concurrency: 4,
  outputs: { a: 'outhash-a', b: 'outhash-b' },
  steps: [
    decision('a', 'cached', 'key-a', {
      breakdown: {
        key: 'key-a',
        kind: 'source',
        params: 'p-a',
        inputs: 'i-a',
        environment: 'envhash-5678',
        inputKeys: {},
      },
      fromPersistence: true,
    }),
    decision('b', 'computed', 'key-b', {
      breakdown: {
        key: 'key-b',
        kind: 'transform',
        params: 'p-b',
        inputs: 'i-b',
        environment: 'envhash-5678',
        inputKeys: { in: 'key-a' },
      },
    }),
  ],
};

describe('build provenance attestation', () => {
  it('is created with a schema and a digest', () => {
    const attestation = createBuildAttestation({ plan, stats, environment, createdAt: 100 });
    expect(attestation.schema).toBe(BUILD_ATTESTATION_SCHEMA);
    expect(attestation.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(attestation.totals.cacheHitRate).toBe(0.5);
    expect(attestation.steps[0]?.fromPersistence).toBe(true);
    expect(attestation.steps[1]?.outputHash).toBe('outhash-b');
  });

  it('is byte-identical across machines and runs (no timings in the digest)', () => {
    const first = createBuildAttestation({ plan, stats, environment, createdAt: 1 });
    const second = createBuildAttestation({
      plan,
      stats: {
        ...stats,
        durationMs: 99_999,
        steps: stats.steps.map((s) => ({ ...s, durationMs: 42 })),
      },
      environment,
      createdAt: 2,
    });
    expect(second.digest).toBe(first.digest);
    const { digest: _d, ...rest } = first;
    expect(attestationDigest(rest)).toBe(first.digest);
  });

  it('verifies an unmodified attestation', () => {
    const attestation = createBuildAttestation({ plan, stats, environment });
    const result = verifyBuildAttestation(attestation);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('detects a tampered output hash or step status', () => {
    const attestation = createBuildAttestation({ plan, stats, environment });
    const tampered = JSON.parse(JSON.stringify(attestation)) as BuildAttestation;
    tampered.outputs.b = 'evil-hash';
    expect(verifyBuildAttestation(tampered).ok).toBe(false);
    expect(verifyBuildAttestation(tampered).issues).toContain('digest mismatch');

    const statusSwap = JSON.parse(JSON.stringify(attestation)) as BuildAttestation;
    statusSwap.steps[1]!.status = 'cached';
    statusSwap.totals.cached = 2;
    statusSwap.totals.computed = 0;
    const result = verifyBuildAttestation(statusSwap);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('digest mismatch');
  });

  it('rejects a document with inconsistent counters', () => {
    const attestation = createBuildAttestation({ plan, stats, environment });
    const broken = { ...attestation, totals: { ...attestation.totals, total: 5 } };
    const result = verifyBuildAttestation(broken);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('total 5'))).toBe(true);
  });

  it('rejects non-objects and unknown schemas', () => {
    expect(verifyBuildAttestation(null).ok).toBe(false);
    expect(verifyBuildAttestation({ schema: 'other' }).ok).toBe(false);
  });
});
