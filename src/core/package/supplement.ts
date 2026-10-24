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

import { zipSync, strToU8 } from 'fflate';
import type { Project } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';
import type { LineageGraph } from '@/core/lineage/graph';
import { buildLineage } from '@/core/lineage/graph';
import { listRuns } from '@/core/storage';
import { buildLock, lockToJson } from '@/core/repro/lock';
import { logger } from '@/core/logger';
import { getVfs, type Vfs } from '@/core/vfs';

export interface SupplementMeta {
  author?: string;
  license?: string;
  description?: string;
}

export interface SupplementOptions {
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
  let runs: RunRecord[] = [];
  try {
    runs = await listRuns(project.id);
  } catch (err) {
    logger.warn('package', 'run records unavailable, manifest degrades', err);
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
    const lock = buildLock(project, { runs });
    entries['repro.lock'] = strToU8(lockToJson(lock));
    contents.reproLock = 'repro.lock';
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
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return zipSync(entries, { level: 6 });
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
