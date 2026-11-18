import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  REPRO_BUNDLE_SCHEMA,
  buildReproBundle,
  verifyReproBundle,
  type ReproBundleManifest,
} from '@/core/repro/bundle';
import { createRunRecord } from '@/core/experiment/record';
import { createEmptyProject } from '@/types/project';
import { MemoryBuildCache } from '@/core/build/cache';
import { encodeDataValue } from '@/core/build/codec';
import { cacheBundleToJson, exportCacheBundle } from '@/core/build/bundle';
import { createBuildAttestation } from '@/core/build/provenance';
import type { BuildPlan } from '@/core/build/plan';
import type { BuildStats } from '@/core/build/engine';
import type { BuildEnvironment } from '@/core/build/key';

function project() {
  const p = createEmptyProject('Bundle Test');
  p.data.files = [
    { id: 'f1', name: 'a.csv', size: 6, mimeType: 'text/csv', format: 'csv', content: 'x\n1\n' },
  ];
  return p;
}

function runs(projectId: string) {
  return [
    createRunRecord({
      projectId,
      source: 'flow',
      params: { k: 2 },
      metrics: { r2: 0.9 },
      seed: 7,
    }),
  ];
}

async function evidence() {
  const cache = new MemoryBuildCache();
  await cache.put({ key: 'k1', value: encodeDataValue({ kind: 'scalar', value: 1 })! });
  const buildCacheJson = cacheBundleToJson(
    await exportCacheBundle(cache, { environment: 'env-1', createdAt: 1 }),
  );
  const plan: BuildPlan = { id: 'p', steps: [] };
  const stats: BuildStats = {
    planId: 'p',
    planHash: 'plan-hash',
    environment: 'env-1',
    total: 0,
    computed: 0,
    cached: 0,
    blocked: 0,
    failed: 0,
    durationMs: 0,
    concurrency: 1,
    outputs: {},
    steps: [],
  };
  const environment: BuildEnvironment = { appVersion: '1', schemaVersion: 'v1' };
  return {
    buildCacheJson,
    attestationJson: JSON.stringify(
      createBuildAttestation({ plan, stats, environment, createdAt: 1 }),
    ),
  };
}

describe('reproducibility bundle', () => {
  it('packages lock, project, runs and evidence into a verifiable zip', async () => {
    const p = project();
    const bytes = await buildReproBundle({
      project: p,
      runs: runs(p.id),
      ...(await evidence()),
    });
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(
      [
        'README.txt',
        'build-attestation.json',
        'build-cache.json',
        'manifest.json',
        'project.clproj',
        'repro.lock.json',
        'runs.json',
      ].sort(),
    );
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as ReproBundleManifest;
    expect(manifest.schema).toBe(REPRO_BUNDLE_SCHEMA);
    expect(manifest.project.id).toBe(p.id);
    expect(manifest.counts.runs).toBe(1);
    expect(manifest.counts.hasAttestation).toBe(true);
    expect(manifest.counts.hasBuildCache).toBe(true);

    const result = verifyReproBundle(bytes);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verified).toContain('build-attestation.json');
  });

  it('detects a swapped member and a tampered manifest', async () => {
    const p = project();
    const bytes = await buildReproBundle({ project: p, runs: runs(p.id) });
    const entries = unzipSync(bytes);
    entries['runs.json'] = strToU8('[]');
    const swapped = verifyReproBundle(zipSync(entries, { level: 6 }));
    expect(swapped.ok).toBe(false);
    expect(swapped.issues.some((i) => i.includes('runs.json'))).toBe(true);

    const clean = JSON.parse(strFromU8(entries['manifest.json']!)) as ReproBundleManifest;
    clean.digest = 'deadbeef';
    entries['manifest.json'] = strToU8(JSON.stringify(clean));
    const tampered = verifyReproBundle(zipSync(entries, { level: 6 }));
    expect(tampered.ok).toBe(false);
    expect(tampered.issues).toContain('manifest digest mismatch');
  });

  it('omits optional evidence cleanly and filters foreign runs', async () => {
    const p = project();
    const foreign = runs('other-project');
    const bytes = await buildReproBundle({ project: p, runs: [...runs(p.id), ...foreign] });
    const entries = unzipSync(bytes);
    expect(entries['build-cache.json']).toBeUndefined();
    expect(entries['build-attestation.json']).toBeUndefined();
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as ReproBundleManifest;
    expect(manifest.counts.runs).toBe(1);
    expect(verifyReproBundle(bytes).ok).toBe(true);
  });
});
