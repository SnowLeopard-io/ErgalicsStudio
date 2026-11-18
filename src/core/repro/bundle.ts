// ==========================================================================
// Ergalics Studio — one-click reproducibility bundle (pure TS + zip)
//
// A `repro.lock` fingerprints *inputs*, a build attestation proves *what was
// computed*, and a cache snapshot lets another machine reuse those results.
// This module packs all three — plus the project, the selected run records and
// a short README — into one self-verifying zip:
//
//   repro.lock.json         buildLock v2 (data/code/param/seed + env hashes)
//   project.clproj          the project definition the lock was built from
//   runs.json               selected RunRecords (metrics, params, build stats)
//   build-attestation.json  digest-verifiable attestation of the last build
//   build-cache.json        portable content-addressed cache snapshot
//   manifest.json           file inventory + digests + generator metadata
//
// The manifest digest covers every file's path, byte length and content hash,
// so a swapped or truncated member is detected before anything is imported.
// ==========================================================================

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Project } from '@/types/project';
import { serializeProject } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';
import { hashValue } from '@/core/build/hash';
import { verifyBuildAttestation } from '@/core/build/provenance';
import { verifyCacheBundle } from '@/core/build/bundle';
import {
  buildLock,
  lockToJson,
  parseLock,
  type BuildLockOptions,
  type ReproLock,
} from './lock';

export const REPRO_BUNDLE_SCHEMA = 'ergalics.repro-bundle/v1';

const LOCK_PATH = 'repro.lock.json';
const PROJECT_PATH = 'project.clproj';
const RUNS_PATH = 'runs.json';
const ATTESTATION_PATH = 'build-attestation.json';
const CACHE_PATH = 'build-cache.json';
const README_PATH = 'README.txt';
const MANIFEST_PATH = 'manifest.json';

export interface ReproBundleOptions extends Pick<
  BuildLockOptions,
  'runIds' | 'versions' | 'dependencies' | 'runTolerance' | 'buildHash'
> {
  project: Project;
  /** Defaults to all runs in the experiment store. */
  runs?: RunRecord[];
  /** JSON from `useBlockStore.exportBuildCache()`. */
  buildCacheJson?: string;
  /** JSON from `attestationToJson(lastAttestation)`. */
  attestationJson?: string;
  /** Include the `.clproj` definition (default: true). */
  includeProject?: boolean;
  now?: Date;
}

export interface ReproBundleFile {
  path: string;
  bytes: number;
  digest: string;
}

export interface ReproBundleManifest {
  schema: string;
  generatedAt: string;
  generator: string;
  project: { id: string; name: string };
  /** Fingerprint of the lock, for a quick "same inputs?" comparison. */
  lockHash: string;
  counts: {
    runs: number;
    dataFiles: number;
    codeArtifacts: number;
    hasAttestation: boolean;
    hasBuildCache: boolean;
  };
  files: ReproBundleFile[];
  /** Digest over (schema, project, lockHash, file paths + digests). */
  digest: string;
  instructions: string;
}

function manifestDigest(
  manifest: Omit<ReproBundleManifest, 'digest'>,
): string {
  return hashValue({
    schema: manifest.schema,
    project: manifest.project,
    lockHash: manifest.lockHash,
    files: manifest.files.map((f) => ({ path: f.path, bytes: f.bytes, digest: f.digest })),
  });
}

function readmeText(lock: ReproLock, manifest: Omit<ReproBundleManifest, 'digest'>): string {
  return [
    'Ergalics Studio — reproducibility bundle',
    '========================================',
    '',
    `Project: ${manifest.project.name} (${manifest.project.id})`,
    `Generated: ${manifest.generatedAt}`,
    `Lock: v${lock.lockVersion} (${lock.runs.length} runs)`,
    '',
    'Contents:',
    `  ${LOCK_PATH}       input fingerprints — import with Repro Lock → Import`,
    `  ${PROJECT_PATH}       project definition (open with File → Open Project)`,
    `  ${RUNS_PATH}            run records, including cache hit rates`,
    `  ${ATTESTATION_PATH}  last build proof — verify with the canvas Provenance button`,
    `  ${CACHE_PATH}       content-addressed cache — import with Settings → Build cache`,
    `  ${MANIFEST_PATH}           this bundle's file inventory and integrity digests`,
    '',
    'Integrity: every file digest is listed in manifest.json; the manifest itself',
    'carries a digest over those entries. Files are optional except the lock and',
    'manifest — missing optional members are reported by bundle verification.',
    '',
    'Reproduce: open the project, import the lock, then run the recorded nodes.',
    'A cache hit means the inputs, parameters, code and environment all match.',
  ].join('\n');
}

/** Pack a project + runs + optional build evidence into a verifiable zip. */
export async function buildReproBundle(
  options: ReproBundleOptions,
): Promise<Uint8Array> {
  const { project } = options;
  const runs = (options.runs ?? []).filter((run) => run.projectId === project.id);
  const lock = buildLock(project, {
    runs,
    ...(options.runIds !== undefined ? { runIds: options.runIds } : {}),
    ...(options.versions !== undefined ? { versions: options.versions } : {}),
    ...(options.dependencies !== undefined ? { dependencies: options.dependencies } : {}),
    ...(options.runTolerance !== undefined ? { runTolerance: options.runTolerance } : {}),
    ...(options.buildHash !== undefined ? { buildHash: options.buildHash } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const entries: Record<string, Uint8Array> = {};
  const add = (path: string, text: string): void => {
    entries[path] = strToU8(text);
  };

  add(LOCK_PATH, lockToJson(lock));
  add(RUNS_PATH, JSON.stringify(runs, null, 2));
  if (options.includeProject !== false) add(PROJECT_PATH, serializeProject(project));
  if (options.attestationJson) add(ATTESTATION_PATH, options.attestationJson);
  if (options.buildCacheJson) add(CACHE_PATH, options.buildCacheJson);

  const files: ReproBundleFile[] = Object.entries(entries)
    .map(([path, bytes]) => ({ path, bytes: bytes.byteLength, digest: hashValue(strFromU8(bytes)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const unsigned: Omit<ReproBundleManifest, 'digest'> = {
    schema: REPRO_BUNDLE_SCHEMA,
    generatedAt: (options.now ?? new Date()).toISOString(),
    generator: 'Ergalics Studio',
    project: { id: project.id, name: project.name },
    lockHash: hashValue(lock),
    counts: {
      runs: lock.runs.length,
      dataFiles: lock.data.length,
      codeArtifacts: lock.code.artifacts.length,
      hasAttestation: entries[ATTESTATION_PATH] !== undefined,
      hasBuildCache: entries[CACHE_PATH] !== undefined,
    },
    files,
    instructions: 'Import repro.lock.json in Repro Lock, project.clproj via File → Open, build-cache.json in Settings → Build cache.',
  };
  add(README_PATH, readmeText(lock, unsigned));
  unsigned.files = [
    ...files,
    { path: README_PATH, bytes: entries[README_PATH]!.byteLength, digest: hashValue(readmeText(lock, unsigned)) },
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const manifest: ReproBundleManifest = { ...unsigned, digest: manifestDigest(unsigned) };
  add(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return zipSync(entries, { level: 6 });
}

export interface ReproBundleVerification {
  ok: boolean;
  issues: string[];
  manifest: ReproBundleManifest | null;
  /** Names of files that passed their digest check. */
  verified: string[];
}

/**
 * Open a bundle and verify every listed file plus the embedded lock,
 * attestation and cache snapshot. Never mutates the current project.
 */
export function verifyReproBundle(bytes: Uint8Array): ReproBundleVerification {
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
  const manifestBytes = entries[MANIFEST_PATH];
  if (!manifestBytes) {
    return { ok: false, issues: ['missing manifest.json'], manifest: null, verified: [] };
  }
  let manifest: ReproBundleManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as ReproBundleManifest;
  } catch (err) {
    return {
      ok: false,
      issues: [`invalid manifest: ${err instanceof Error ? err.message : String(err)}`],
      manifest: null,
      verified: [],
    };
  }
  const issues: string[] = [];
  if (manifest.schema !== REPRO_BUNDLE_SCHEMA) {
    issues.push(`unsupported schema: ${String(manifest.schema)}`);
  }
  const { digest: _digest, ...unsigned } = manifest;
  if (manifestDigest(unsigned) !== manifest.digest) {
    issues.push('manifest digest mismatch');
  }
  const verified: string[] = [];
  for (const file of manifest.files ?? []) {
    const content = entries[file.path];
    if (!content) {
      issues.push(`missing file: ${file.path}`);
      continue;
    }
    const text = strFromU8(content);
    if (content.byteLength !== file.bytes || hashValue(text) !== file.digest) {
      issues.push(`content mismatch: ${file.path}`);
    } else {
      verified.push(file.path);
    }
  }

  const lockBytes = entries[LOCK_PATH];
  if (lockBytes) {
    try {
      const lock = parseLock(strFromU8(lockBytes));
      if (lock.projectId !== manifest.project?.id) issues.push('lock projectId mismatch');
    } catch (err) {
      issues.push(`invalid lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const parseJson = (content: Uint8Array, path: string): unknown | null => {
    try {
      return JSON.parse(strFromU8(content)) as unknown;
    } catch (err) {
      issues.push(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
  const attestationBytes = entries[ATTESTATION_PATH];
  if (attestationBytes) {
    const parsed = parseJson(attestationBytes, ATTESTATION_PATH);
    if (parsed !== null) {
      const result = verifyBuildAttestation(parsed);
      issues.push(...result.issues.map((issue) => `attestation: ${issue}`));
    }
  }
  const cacheBytes = entries[CACHE_PATH];
  if (cacheBytes) {
    const parsed = parseJson(cacheBytes, CACHE_PATH);
    if (parsed !== null) {
      const result = verifyCacheBundle(parsed);
      issues.push(...result.issues.map((issue) => `build cache: ${issue}`));
    }
  }
  return { ok: issues.length === 0, issues, manifest, verified };
}
