// ==========================================================================
// Ergalics Studio — data file registry (bundled examples + project files)
//
// Single resolution point for "load a data file by name". It merges two
// sources:
//   1. Bundled example datasets (examples/data/*), imported at build time.
//   2. User-imported project data files (Project.data.files), registered at
//      runtime via `setProjectFiles`.
//
// Both the flow-mode `source.file` block and the block/code-mode
// `studio.load()` resolve through `resolveDataFile`, so user files work
// identically across both surfaces (editor architecture §10.4).
// ==========================================================================

import type { FileEntry } from '@/types/project';
import { isSupportedDataFileName } from './fileFormat';

// Bundled examples are loaded lazily: a non-eager glob keeps the heavy
// datasets (geo/point-cloud/flux JSON — hundreds of KB each) out of the
// first-screen bundle and fetches them on demand when actually opened.
// `Object.keys` still enumerates names synchronously for pickers.
const bundledFiles = import.meta.glob('../../examples/data/*', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** Module cache so repeated resolution of the same example stays cheap. */
const bundledLoaders = new Map<string, Promise<string | undefined>>();

function loadBundledFile(path: string): Promise<string | undefined> {
  const base = basename(path);
  const hit = Object.entries(bundledFiles).find(([key]) => basename(key) === base);
  if (!hit) return Promise.resolve(undefined);
  const cached = bundledLoaders.get(base);
  if (cached) return cached;
  const p = hit[1]().then((text) => text as string).catch(() => undefined);
  bundledLoaders.set(base, p);
  return p;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Runtime registry of the current project's data files, keyed by name. */
let projectFiles = new Map<string, string>();

/** Replace the project-file registry (call on project load/import/removal). */
export function setProjectFiles(files: FileEntry[]): void {
  projectFiles = new Map(files.map((f) => [f.name, decodeFileEntry(f)]));
}

/** Decode a stored FileEntry back to its text content. */
export function decodeFileEntry(entry: FileEntry): string {
  // Data files are stored as plain text. Keep this a single source of truth
  // in case a binary (base64) path is added later.
  return entry.content;
}

/** Names of the current project's data files, in insertion order. */
export function listProjectFiles(): string[] {
  return Array.from(projectFiles.keys());
}

/** Resolve a project data file's text by name (or undefined). */
export function resolveProjectFile(path: string): string | undefined {
  const base = basename(path);
  return projectFiles.get(base);
}

/** Resolve any file — project files take priority, then bundled examples. */
export async function resolveDataFile(path: string): Promise<string | undefined> {
  return resolveProjectFile(path) ?? resolveBundledFile(path);
}

/** Resolve a bundled example file by name (async — lazily fetched). */
export async function resolveBundledFile(path: string): Promise<string | undefined> {
  return loadBundledFile(path);
}

/** All resolvable file names (project files first, then bundled examples). */
export function listDataFiles(): string[] {
  const names = new Set<string>(projectFiles.keys());
  for (const key of Object.keys(bundledFiles)) names.add(basename(key));
  return Array.from(names);
}

export interface GroupedDataFiles {
  /** User-imported project files, in insertion order. */
  project: string[];
  /** Bundled example datasets (names shadowed by project files excluded). */
  examples: string[];
}

// ---- Picker extension presets ----------------------------------------------
//
// Lab pages declare which file kinds make sense for their analysis, so the
// pickers only offer files the module can actually interpret (e.g. the Signal
// Lab must not offer point-cloud .xyz dumps, and a 3D viewer has no use for
// a report .md). Without a preset every supported text data file is offered.

/** Tabular / series data (signal, model fit, statistics, SQL, uncertainty). */
export const DATA_EXTS_SERIES: readonly string[] = ['.csv', '.tsv', '.txt', '.dat', '.json'];
/** Point-cloud / geometric data (.xyz coordinate dumps + tabular fallbacks). */
export const DATA_EXTS_POINT: readonly string[] = ['.xyz', '.csv', '.tsv', '.txt', '.dat'];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * File names split by origin so pickers can present them in labelled groups.
 * Project files shadow same-named examples (`resolveDataFile` prefers them),
 * so the examples group drops duplicates to keep every entry unambiguous.
 * Entries outside `allow` (case-insensitive extensions; default: every
 * supported text data file) are filtered out so pickers never offer a file
 * the calling module cannot interpret.
 */
export function listDataFilesGrouped(allow?: readonly string[]): GroupedDataFiles {
  const ok = allow
    ? (n: string) => allow.includes(extensionOf(n))
    : isSupportedDataFileName;
  const project = Array.from(projectFiles.keys()).filter(ok);
  const projectSet = new Set(project);
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(bundledFiles)) {
    const base = basename(key);
    if (projectSet.has(base) || seen.has(base) || !ok(base)) continue;
    seen.add(base);
    examples.push(base);
  }
  return { project, examples };
}
