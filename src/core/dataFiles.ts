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
// identically across both surfaces (block-code-modes.md §10.4).
// ==========================================================================

import type { FileEntry } from '@/types/project';

const bundledFiles = import.meta.glob('../../examples/data/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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
export function resolveDataFile(path: string): string | undefined {
  return resolveProjectFile(path) ?? resolveBundledFile(path);
}

/** Resolve a bundled example file by name (or undefined). */
export function resolveBundledFile(path: string): string | undefined {
  const base = basename(path);
  for (const [key, text] of Object.entries(bundledFiles)) {
    if (basename(key) === base) return text;
  }
  return undefined;
}

/** All resolvable file names (project files first, then bundled examples). */
export function listDataFiles(): string[] {
  const names = new Set<string>(projectFiles.keys());
  for (const key of Object.keys(bundledFiles)) names.add(basename(key));
  return Array.from(names);
}
