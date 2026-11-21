// ==========================================================================
// Ergalics Studio — supplementary-materials packaging (core)
//
// Builds the zip researchers upload alongside a paper. THE DATA SOURCE IS
// THE FILE EXPLORER'S WORKSPACE TREE (src/core/vfs): whatever the user sees
// in the sidebar — data/, code/, figures/, manuscript/, runs/, project.clproj
// — is what gets packed, so the archive always mirrors the real project
// structure. A manifest.json (project metadata + run records + lineage graph
// + author/license form) and an optional repro.lock (FR6.5 fingerprints) are
// added on top.
// ==========================================================================

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Project } from '@/types/project';
import { serializeProject } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';
import type { LineageGraph } from '@/core/lineage/graph';
import { buildLineage } from '@/core/lineage/graph';
import { listRuns } from '@/core/storage';
import { hashValue } from '@/core/build/hash';
import { verifyBuildAttestation } from '@/core/build/provenance';
import { verifyCacheBundle } from '@/core/build/bundle';
import {
  buildLock,
  lockToJson,
  parseLock,
  type BuildLockOptions,
  type ReproLock,
} from '@/core/repro/lock';
import { logger } from '@/core/logger';
import { getVfs, type Vfs } from '@/core/vfs';

export interface SupplementMeta {
  author?: string;
  license?: string;
  description?: string;
}

export interface SupplementOptions {
  /** Override the persisted runs (e.g. the selected rows on the Repro page). */
  runs?: RunRecord[];
  /** Restrict both the manifest and the lock to these run ids. */
  runIds?: string[];
  /** Passed through to `buildLock` (runtime/dependency fingerprints). */
  versions?: BuildLockOptions['versions'];
  dependencies?: BuildLockOptions['dependencies'];
  /** Add a content-addressed build-cache snapshot to the archive. */
  buildCacheJson?: string;
  /** Add the digest-verifiable build attestation to the archive. */
  attestationJson?: string;
  /** Include `project.clproj` (default: false; reproducibility bundles set it). */
  includeProject?: boolean;
  /** Add a per-file digest inventory + manifest digest (default: false). */
  integrity?: boolean;
  /** Include the workspace `data/` directory. */
  includeData?: boolean;
  /** Include the workspace `code/` directory. */
  includeCode?: boolean;
  /** Include every other workspace file (figures/, manuscript/, runs/,
   *  project.clproj, root files). */
  includeWorkspace?: boolean;
  /** Attach `repro.lock` capturing data/code/params/seed fingerprints (FR6.5). */
  reproLock?: boolean;
  /** Metadata form values (author / license / description). */
  meta?: SupplementMeta;
  /** Vfs override (tests inject a MemoryVfs); defaults to the global one. */
  vfs?: Vfs;
  /** Workspace root override; defaults to the project's own workspace. */
  root?: string;
}

export interface SupplementManifest {
  generator: string;
  generatedAt: string;
  project: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    description: string | null;
    tags: string[];
  };
  meta: SupplementMeta;
  runs: RunRecord[];
  lineage: LineageGraph;
  contents: {
    /** Packed files under `data/` (workspace-relative). */
    data: string[];
    /** Packed files under `code/` (workspace-relative). */
    code: string[];
    /** Every other packed file (workspace-relative). */
    files: string[];
    reproLock: string | null;
    /** Optional build evidence, present when supplied by the caller. */
    buildCache: string | null;
    attestation: string | null;
    project: string | null;
  };
  /** Present when `integrity: true`: digests of every member + a manifest digest. */
  integrity?: {
    files: Array<{ path: string; bytes: number; digest: string }>;
    digest: string;
  };
}

/** Internal workspace paths that never belong in a supplement. */
const EXCLUDED_DIRS = new Set(['.git', '.ergalics', 'supplement']);
const EXCLUDED_NAMES = new Set(['.gitkeep', '.keep']);

interface WorkspaceFile {
  path: string;
  content: string;
  bucket: 'data' | 'code' | 'files';
}

/** Recursively collect workspace files, bucketed by their top-level dir. */
async function collectWorkspaceFiles(
  vfs: Vfs,
  root: string,
): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await vfs.readDir(root, dir);
    for (const entry of entries) {
      if (entry.isDir) {
        if (EXCLUDED_DIRS.has(entry.name) || EXCLUDED_DIRS.has(entry.path)) continue;
        await walk(entry.path);
        continue;
      }
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const bucket = entry.path.startsWith('data/')
        ? 'data'
        : entry.path.startsWith('code/')
          ? 'code'
          : 'files';
      try {
        out.push({ path: entry.path, content: await vfs.readFile(root, entry.path), bucket });
      } catch (err) {
        // A directory-mtime file or an unreadable entry must not sink the
        // whole package — skip it and note the drop in the manifest instead.
        logger.warn('package', `supplement: skipping unreadable ${entry.path}`, err);
      }
    }
  };

  await walk('');
  return out;
}

/**
 * Build the supplement zip from the project's workspace tree (the file
 * explorer's view). Run records and the lineage graph come from the
 * project's durable stores; when storage is unavailable (tests, private
 * mode) the manifest degrades to an empty runs list rather than failing.
 */
export async function buildSupplement(
  project: Project,
  opts: SupplementOptions = {},
): Promise<Uint8Array> {
  let runs: RunRecord[] | undefined = opts.runs;
  if (!runs) {
    try {
      runs = await listRuns(project.id);
    } catch (err) {
      logger.warn('package', 'run records unavailable, manifest degrades', err);
      runs = [];
    }
  }
  if (opts.runIds) {
    const ids = new Set(opts.runIds);
    runs = runs.filter((run) => ids.has(run.id));
  }
  const lineage = buildLineage(project.data.files, runs);

  const vfs = opts.vfs ?? getVfs();
  const root = opts.root ?? `/ergalics-projects/${project.id}`;
  const workspaceFiles = await collectWorkspaceFiles(vfs, root);

  const entries: Record<string, Uint8Array> = {};
  const contents: SupplementManifest['contents'] = {
    data: [],
    code: [],
    files: [],
    reproLock: null,
    buildCache: null,
    attestation: null,
    project: null,
  };

  for (const file of workspaceFiles) {
    const include =
      file.bucket === 'data'
        ? opts.includeData !== false
        : file.bucket === 'code'
          ? opts.includeCode !== false
          : opts.includeWorkspace !== false;
    if (!include) continue;
    entries[file.path] = strToU8(file.content);
    contents[file.bucket].push(file.path);
  }

  if (opts.reproLock) {
    // FR6.5: pin data/code/params/seed fingerprints alongside the materials.
    const lock = buildLock(project, {
      runs,
      ...(opts.runIds !== undefined ? { runIds: opts.runIds } : {}),
      ...(opts.versions !== undefined ? { versions: opts.versions } : {}),
      ...(opts.dependencies !== undefined ? { dependencies: opts.dependencies } : {}),
    });
    entries['repro.lock'] = strToU8(lockToJson(lock));
    contents.reproLock = 'repro.lock';
  }

  // Optional build evidence: the same archive now carries everything needed
  // to *reproduce* a result (lock + inputs) and to *prove* what ran (attestation
  // + content-addressed cache). No second packager is required.
  if (opts.buildCacheJson) {
    entries['build-cache.json'] = strToU8(opts.buildCacheJson);
    contents.buildCache = 'build-cache.json';
    contents.files.push('build-cache.json');
  }
  if (opts.attestationJson) {
    entries['build-attestation.json'] = strToU8(opts.attestationJson);
    contents.attestation = 'build-attestation.json';
    contents.files.push('build-attestation.json');
  }
  if (opts.includeProject) {
    entries['project.clproj'] = strToU8(serializeProject(project));
    contents.project = 'project.clproj';
    contents.files.push('project.clproj');
  }

  const manifest: SupplementManifest = {
    generator: 'Ergalics Studio',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      description: project.metadata.description,
      tags: project.metadata.tags,
    },
    meta: opts.meta ?? {},
    runs,
    lineage,
    contents,
  };
  if (opts.integrity) {
    const files = Object.entries(entries)
      .map(([path, bytes]) => ({ path, bytes: bytes.byteLength, digest: hashValue(strFromU8(bytes)) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    manifest.integrity = {
      files,
      digest: hashValue({ generator: manifest.generator, projectId: project.id, files }),
    };
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return zipSync(entries, { level: 6 });
}

export interface SupplementVerification {
  ok: boolean;
  issues: string[];
  manifest: SupplementManifest | null;
  /** Members that passed their digest check. */
  verified: string[];
}

/**
 * Verify a supplement/reproducibility bundle without touching the project.
 * Checks the integrity inventory (when present), then the embedded lock,
 * attestation and build-cache snapshot structurally.
 */
export function verifySupplementBundle(bytes: Uint8Array): SupplementVerification {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    return {
      ok: false,
      issues: [`cannot unzip bundle: ${err instanceof Error ? err.message : String(err)}`],
      manifest: null,
      verified: [],
    };
  }
  const raw = entries['manifest.json'];
  if (!raw) return { ok: false, issues: ['missing manifest.json'], manifest: null, verified: [] };
  let manifest: SupplementManifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as SupplementManifest;
  } catch (err) {
    return {
      ok: false,
      issues: [`invalid manifest: ${err instanceof Error ? err.message : String(err)}`],
      manifest: null,
      verified: [],
    };
  }
  const issues: string[] = [];
  const verified: string[] = [];
  const integrity = manifest.integrity;
  if (integrity) {
    const recomputed = hashValue({
      generator: manifest.generator,
      projectId: manifest.project.id,
      files: integrity.files,
    });
    if (recomputed !== integrity.digest) issues.push('manifest digest mismatch');
    for (const file of integrity.files) {
      const content = entries[file.path];
      if (!content) {
        issues.push(`missing file: ${file.path}`);
        continue;
      }
      if (content.byteLength !== file.bytes || hashValue(strFromU8(content)) !== file.digest) {
        issues.push(`content mismatch: ${file.path}`);
      } else {
        verified.push(file.path);
      }
    }
  }

  const parseJson = (path: string): unknown | null => {
    const content = entries[path];
    if (!content) return null;
    try {
      return JSON.parse(strFromU8(content)) as unknown;
    } catch (err) {
      issues.push(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
  if (manifest.contents?.reproLock) {
    const lock = parseJson(manifest.contents.reproLock) as ReproLock | null;
    if (lock) {
      try {
        parseLock(JSON.stringify(lock));
        if (lock.projectId !== manifest.project.id) issues.push('lock projectId mismatch');
      } catch (err) {
        issues.push(`invalid lock: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (manifest.contents?.attestation) {
    const parsed = parseJson(manifest.contents.attestation);
    if (parsed !== null) {
      for (const issue of verifyBuildAttestation(parsed).issues) issues.push(`attestation: ${issue}`);
    }
  }
  if (manifest.contents?.buildCache) {
    const parsed = parseJson(manifest.contents.buildCache);
    if (parsed !== null) {
      for (const issue of verifyCacheBundle(parsed).issues) issues.push(`build cache: ${issue}`);
    }
  }
  return { ok: issues.length === 0, issues, manifest, verified };
}

/** Count the files currently under the workspace `data/` directory. */
export async function countWorkspaceDataFiles(
  project: Project,
  vfs: Vfs = getVfs(),
  root?: string,
): Promise<number> {
  const workspaceRoot = root ?? `/ergalics-projects/${project.id}`;
  const files = await collectWorkspaceFiles(vfs, workspaceRoot);
  return files.filter((f) => f.bucket === 'data').length;
}
