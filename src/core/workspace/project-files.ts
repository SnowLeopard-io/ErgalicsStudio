// ==========================================================================
// Ergalics Studio — project file access (single entry point)
//
// Reading and writing a project file always means the same three steps: the
// current project, its repo path, and the VFS adapter. That dance was
// repeated in the terminal panel, the terminal host commands, the workspace
// opener and the editor file panels — this module is the one place that
// knows how to do it.
// ==========================================================================

import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getVfs } from '@/core/vfs';

/** Repo-relative path of the current project (null without a project). */
export function currentRepoPath(): string | null {
  const project = useProjectStore.getState().project;
  return project ? getProjectRepoPath(project) : null;
}

/** Read a project file (repo-relative). Throws when there is no project. */
export async function readProjectFile(path: string): Promise<string> {
  const repoPath = currentRepoPath();
  if (!repoPath) throw new Error('no project open');
  return getVfs().readFile(repoPath, path);
}

/** Read a project file, returning null when it cannot be read. */
export async function tryReadProjectFile(path: string): Promise<string | null> {
  try {
    return await readProjectFile(path);
  } catch {
    return null;
  }
}

/** Write a project file (repo-relative). Throws when there is no project. */
export async function writeProjectFile(path: string, content: string): Promise<void> {
  const repoPath = currentRepoPath();
  if (!repoPath) throw new Error('no project open');
  await getVfs().writeFile(repoPath, path, content);
}

/** Whether a project file exists (repo-relative). */
export async function projectFileExists(path: string): Promise<boolean> {
  const repoPath = currentRepoPath();
  if (!repoPath) return false;
  return getVfs().exists(repoPath, path);
}
