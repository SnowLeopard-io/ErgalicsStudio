// ==========================================================================
// Ergalics Studio — standard workspace skeleton (§3.1, git-free)
//
// Seeds the §3.1 directory skeleton of a fresh project into the plain
// workspace tree. Lives in the Vfs layer on purpose: project creation must
// not require a git repository. `.github/**` (CI) is intentionally not
// seeded — that belongs to the optional version-control layer.
// ==========================================================================

import type { Vfs } from './types';
import { STANDARD_TEMPLATE_FILES } from '@/core/git/templates';

/** Working-tree files of the standard skeleton, minus git-only artifacts. */
const SKELETON_FILES = STANDARD_TEMPLATE_FILES.filter(
  (f) => !f.path.startsWith('.github/'),
);

export interface SeedSkeletonOptions {
  /**
   * Replace files that already exist. Defaults to true (fresh project).
   * Pass false when repairing an opened project: the skeleton fills in
   * missing directories (e.g. manuscript/) without touching user files.
   */
  overwrite?: boolean;
}

/**
 * Write the standard skeleton into the workspace root (idempotent) and
 * return the paths actually written.
 */
export async function seedStandardSkeleton(
  vfs: Vfs,
  root: string,
  options: SeedSkeletonOptions = {},
): Promise<string[]> {
  const { overwrite = true } = options;
  const written: string[] = [];
  for (const f of SKELETON_FILES) {
    if (!overwrite && (await vfs.exists(root, f.path))) continue;
    await vfs.writeFile(root, f.path, f.content);
    written.push(f.path);
  }
  return written;
}
