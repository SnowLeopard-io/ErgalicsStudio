// ==========================================================================
// Ergalics Studio — supplementary-materials packaging (core)
//
// Builds the zip researchers upload alongside a paper: a manifest.json
// (project metadata + run records + lineage graph + author/license form),
// optionally the raw data files and the authored code sessions. Pure data
// assembly + fflate zip; the dialog only collects the form and downloads.
// ==========================================================================

import { zipSync, strToU8 } from 'fflate';
import type { Project } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';
import type { LineageGraph } from '@/core/lineage/graph';
import { buildLineage } from '@/core/lineage/graph';
import { listRuns } from '@/core/storage';
import { buildLock, lockToJson } from '@/core/repro/lock';
import { logger } from '@/core/logger';

export interface SupplementMeta {
  author?: string;
  license?: string;
  description?: string;
}

export interface SupplementOptions {
  /** Include the project's data files under `data/`. */
  includeData?: boolean;
  /** Include authored code sessions under `code/`. */
  code?: boolean;
  /** Metadata form values (author / license / description). */
  meta?: SupplementMeta;
  /** Attach `repro.lock` capturing data/code/params/seed fingerprints (FR6.5). */
  reproLock?: boolean;
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
    data: string[];
    code: string[];
    reproLock: string | null;
  };
}

function codeExtension(language: string): string {
  switch (language) {
    case 'python':
      return 'py';
    case 'r':
      return 'r';
    case 'js':
      return 'js';
    default:
      return 'txt';
  }
}

/** Zip-safe name with numeric prefixes when two files share a name. */
function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  let i = 1;
  let candidate = `${i}_${name}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${i}_${name}`;
  }
  return candidate;
}

/**
 * Build the supplement zip. Run records and the lineage graph come from the
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

  const entries: Record<string, Uint8Array> = {};
  const contents: SupplementManifest['contents'] = { data: [], code: [], reproLock: null };

  if (opts.includeData) {
    const used = new Set<string>();
    for (const file of project.data.files) {
      const name = dedupeName(file.name, used);
      used.add(name);
      entries[`data/${name}`] = strToU8(file.content);
      contents.data.push(name);
    }
  }

  if (opts.code) {
    const used = new Set<string>();
    let i = 1;
    for (const session of project.state.editorSessions ?? []) {
      if (!session.lastCode?.trim()) continue;
      const base = `${project.name}-${i}`.replace(/[^\w.-]+/g, '_');
      const name = dedupeName(`${base}.${codeExtension(session.language)}`, used);
      used.add(name);
      entries[`code/${name}`] = strToU8(session.lastCode);
      contents.code.push(name);
      i += 1;
    }
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
