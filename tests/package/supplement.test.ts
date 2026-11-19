// ==========================================================================
// Ergalics Studio — supplement packaging tests (core)
//
// Zip round-trip (fflate unzipSync). The data source is the FILE EXPLORER'S
// workspace tree (injected MemoryVfs): the archive must mirror the real
// project structure (data/, code/, figures/, manuscript/, runs/, …) and
// never include git/app internals.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import {
  buildSupplement,
  countWorkspaceDataFiles,
  verifySupplementBundle,
} from '@/core/package/supplement';
import type { SupplementManifest } from '@/core/package/supplement';
import { MemoryVfs } from '@/core/vfs';
import { seedStandardSkeleton } from '@/core/vfs/skeleton';
import { createEmptyProject } from '@/types/project';
import type { Project } from '@/types/project';
import { createRunRecord } from '@/core/experiment/record';
import { MemoryBuildCache } from '@/core/build/cache';
import { encodeDataValue } from '@/core/build/codec';
import { cacheBundleToJson, exportCacheBundle } from '@/core/build/bundle';
import { createBuildAttestation } from '@/core/build/provenance';
import type { BuildPlan } from '@/core/build/plan';
import type { BuildStats } from '@/core/build/engine';
import type { BuildEnvironment } from '@/core/build/key';

const ROOT = '/workspaces/test-project';

function makeProject(): Project {
  const project = createEmptyProject('Lineage Study');
  project.metadata.description = 'A study';
  project.metadata.tags = ['biology'];
  return project;
}

/** Workspace tree mirroring what the file explorer shows. */
function makeVfs(): MemoryVfs {
  return new MemoryVfs(
    {
      'project.clproj': '{"name":"Lineage Study"}',
      'data/samples.csv': 'group,score\nalpha,10\n',
      'data/sub/deep.csv': 'x\n1\n',
      'code/analysis.py': 'print("hi")',
      'figures/fig1.svg': '<svg/>',
      'manuscript/paper.md': '# Paper',
      'runs/run-1.json': '{"id":"run-1"}',
      '.gitignore': '# ignore',
      '.git/HEAD': 'ref: refs/heads/main',
      '.ergalics/workspace.json': '{"openTabs":[]}',
      'data/.gitkeep': '',
    },
    ROOT,
  );
}

async function unzip(bytes: Uint8Array): Promise<Record<string, string>> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = strFromU8(data);
  }
  return out;
}

async function build(project: Project, opts: Parameters<typeof buildSupplement>[1] = {}) {
  return unzip(await buildSupplement(project, { root: ROOT, vfs: makeVfs(), ...opts }));
}

describe('buildSupplement — manifest', () => {
  it('produces a parseable manifest with project + meta + lineage', async () => {
    const project = makeProject();
    const zip = await build(project, {
      meta: { author: 'J. Doe', license: 'CC-BY-4.0', description: 'Replication pack' },
    });

    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    expect(manifest.generator).toBe('Ergalics Studio');
    expect(manifest.project.name).toBe('Lineage Study');
    expect(manifest.project.description).toBe('A study');
    expect(manifest.project.tags).toEqual(['biology']);
    expect(manifest.meta).toEqual({ author: 'J. Doe', license: 'CC-BY-4.0', description: 'Replication pack' });
    // No runs without IndexedDB, but the graph shape is always present.
    expect(Array.isArray(manifest.runs)).toBe(true);
    expect(manifest.lineage).toBeDefined();
    expect(Array.isArray(manifest.lineage.nodes)).toBe(true);
  });

  it('embeds a repro.lock when requested', async () => {
    const project = makeProject();
    const zip = await build(project, { reproLock: true });
    expect(zip['repro.lock']).toBeDefined();
    const lock = JSON.parse(zip['repro.lock']!) as { lockVersion: number; projectId: string; runs: unknown[] };
    expect(lock.lockVersion).toBe(3);
    expect(lock.projectId).toBe(project.id);
    expect(Array.isArray(lock.runs)).toBe(true);
    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    expect(manifest.contents.reproLock).toBe('repro.lock');
  });
});

describe('buildSupplement — mirrors the workspace tree', () => {
  it('packs the real project structure, skipping git/app internals', async () => {
    const zip = await build(makeProject());
    const names = Object.keys(zip).filter((n) => n !== 'manifest.json');

    // Everything the explorer shows is in the archive…
    expect(names).toContain('project.clproj');
    expect(names).toContain('data/samples.csv');
    expect(names).toContain('data/sub/deep.csv');
    expect(names).toContain('code/analysis.py');
    expect(names).toContain('figures/fig1.svg');
    expect(names).toContain('manuscript/paper.md');
    expect(names).toContain('runs/run-1.json');
    expect(names).toContain('.gitignore');
    // …and nothing internal leaks in.
    expect(names.some((n) => n.startsWith('.git/'))).toBe(false);
    expect(names.some((n) => n.startsWith('.ergalics/'))).toBe(false);
    expect(names.some((n) => n.endsWith('.gitkeep'))).toBe(false);

    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    expect(manifest.contents.data.sort()).toEqual(['data/samples.csv', 'data/sub/deep.csv']);
    expect(manifest.contents.code).toEqual(['code/analysis.py']);
    expect(manifest.contents.files).toContain('figures/fig1.svg');
    expect(manifest.contents.files).toContain('project.clproj');
  });

  it('buckets and toggles: data / code / rest of the workspace', async () => {
    const zip = await build(makeProject(), { includeData: false });
    expect(Object.keys(zip).some((n) => n.startsWith('data/'))).toBe(false);
    expect(zip['code/analysis.py']).toBe('print("hi")');

    const noCode = await build(makeProject(), { includeCode: false });
    expect(Object.keys(noCode).some((n) => n.startsWith('code/'))).toBe(false);
    expect(noCode['data/samples.csv']).toBeDefined();

    const minimal = await build(makeProject(), {
      includeData: false,
      includeCode: false,
      includeWorkspace: false,
    });
    expect(Object.keys(minimal).sort()).toEqual(['manifest.json']);
  });

  it('reads file payloads from the workspace, not the legacy registry', async () => {
    // A data file registered in project.data.files but absent from the tree
    // must NOT appear; a tree file with different content must win.
    const project = makeProject();
    project.data.files = [
      {
        id: 'legacy',
        name: 'legacy.csv',
        size: 0,
        mimeType: 'text/csv',
        format: 'csv',
        content: 'legacy,only\n',
      },
    ];
    const zip = await build(project);
    expect(zip['legacy.csv']).toBeUndefined();
    expect(zip['data/samples.csv']).toBe('group,score\nalpha,10\n');
  });

  it('still yields a valid zip when the workspace is empty', async () => {
    const zip = unzipSync(
      await buildSupplement(makeProject(), { root: ROOT, vfs: new MemoryVfs(), reproLock: true }),
    );
    expect(zip['manifest.json']).toBeDefined();
    expect(zip['repro.lock']).toBeDefined();
  });
});

describe('buildSupplement — reproducibility bundle (one packager)', () => {
  const makeRun = (projectId: string) =>
    createRunRecord({ projectId, source: 'flow', params: { k: 2 }, metrics: { r2: 0.9 } });

  async function evidence() {
    const cache = new MemoryBuildCache();
    await cache.put({ key: 'k1', value: encodeDataValue({ kind: 'scalar', value: 1 })! });
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
      buildCacheJson: cacheBundleToJson(
        await exportCacheBundle(cache, { environment: 'env-1', createdAt: 1 }),
      ),
      attestationJson: JSON.stringify(
        createBuildAttestation({ plan, stats, environment, createdAt: 1 }),
      ),
    };
  }

  it('packages build evidence into the SAME archive as the lock and project', async () => {
    const project = makeProject();
    const run = makeRun(project.id);
    const bytes = await buildSupplement(project, {
      root: ROOT,
      vfs: new MemoryVfs(),
      runs: [run, makeRun('other-project')],
      runIds: [run.id],
      reproLock: true,
      includeProject: true,
      includeData: false,
      includeCode: false,
      includeWorkspace: false,
      integrity: true,
      ...(await evidence()),
    });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(
      ['build-attestation.json', 'build-cache.json', 'manifest.json', 'project.clproj', 'repro.lock']
        .sort(),
    );
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as SupplementManifest;
    expect(manifest.runs.map((r) => r.id)).toEqual([run.id]);
    expect(manifest.contents.buildCache).toBe('build-cache.json');
    expect(manifest.contents.attestation).toBe('build-attestation.json');
    // All members except manifest.json itself (lock, cache, attestation, project).
    expect(manifest.integrity?.files).toHaveLength(4);

    const result = verifySupplementBundle(bytes);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verified).toContain('build-attestation.json');
  });

  it('detects a swapped member and a tampered manifest digest', async () => {
    const project = makeProject();
    const bytes = await buildSupplement(project, {
      root: ROOT,
      vfs: new MemoryVfs(),
      runs: [makeRun(project.id)],
      reproLock: true,
      integrity: true,
    });
    const entries = unzipSync(bytes);
    entries['repro.lock'] = strToU8('{}');
    const swapped = verifySupplementBundle(zipSync(entries, { level: 6 }));
    expect(swapped.ok).toBe(false);
    expect(swapped.issues.some((issue) => issue.includes('repro.lock'))).toBe(true);

    const clean = JSON.parse(strFromU8(entries['manifest.json']!)) as SupplementManifest;
    clean.integrity!.digest = 'deadbeef';
    entries['manifest.json'] = strToU8(JSON.stringify(clean));
    const tampered = verifySupplementBundle(zipSync(entries, { level: 6 }));
    expect(tampered.issues).toContain('manifest digest mismatch');
  });
});

describe('workspace helpers', () => {
  it('countWorkspaceDataFiles counts data/ files (recursively, no placeholders)', async () => {
    const project = makeProject();
    expect(await countWorkspaceDataFiles(project, makeVfs(), ROOT)).toBe(2);
    expect(await countWorkspaceDataFiles(project, new MemoryVfs(), ROOT)).toBe(0);
  });

  it('seedStandardSkeleton writes the §3.1 tree without git internals', async () => {
    const vfs = new MemoryVfs();
    await seedStandardSkeleton(vfs, ROOT);
    const root = await vfs.readDir(ROOT, '');
    const names = root.map((e) => e.name);
    expect(names).toContain('data');
    expect(names).toContain('code');
    expect(names).toContain('figures');
    expect(names).toContain('manuscript');
    expect(names).toContain('runs');
    expect(names).toContain('project.clproj');
    expect(names).not.toContain('.git');
    expect(names).not.toContain('.github');
    expect(await vfs.readFile(ROOT, 'data/.gitkeep')).toBe('');
  });

  it('seedStandardSkeleton({ overwrite: false }) keeps existing user files', async () => {
    const vfs = new MemoryVfs();
    await vfs.writeFile(ROOT, 'manuscript/main.tex', '\\documentclass{article}');
    const written = await seedStandardSkeleton(vfs, ROOT, { overwrite: false });
    expect(written).not.toContain('manuscript/main.tex');
    expect(await vfs.readFile(ROOT, 'manuscript/main.tex')).toBe('\\documentclass{article}');
    // Missing skeleton entries are still created (including manuscript/).
    expect(written).toContain('manuscript/.gitkeep');
    expect(await vfs.exists(ROOT, 'manuscript/.gitkeep')).toBe(true);
    expect(await vfs.exists(ROOT, 'data/.gitkeep')).toBe(true);
  });

  it('seedStandardSkeleton overwrites by default (fresh-project behaviour)', async () => {
    const vfs = new MemoryVfs();
    await vfs.writeFile(ROOT, 'data/.gitkeep', 'user content');
    await seedStandardSkeleton(vfs, ROOT);
    expect(await vfs.readFile(ROOT, 'data/.gitkeep')).toBe('');
  });
});
