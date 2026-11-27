// ==========================================================================
// Ergalics Studio — Auto-commit strategy (docs/requirements/01 §3.4)
//
// Pure helpers, no store dependencies: `generateCommitMessage` builds the
// Conventional-Commit subject and `commitWorkingTree` stages + commits the
// current working tree, skipping cleanly when nothing changed (dedupe).
// Trigger points (run completed / figure saved / manual save / supplement
// export) live in the stores and funnel through `commitWorkingTree`.
// ==========================================================================

import type { GitAdapter } from './types';

/** Conventional-Commit types accepted by the 3.4 auto-commit strategy. */
export type AutoCommitType =
  | 'chore'
  | 'save'
  | 'run'
  | 'figure'
  | 'manuscript'
  | 'data'
  | 'code'
  | 'release'
  | 'repro';

const COMMIT_PREFIXES: Record<AutoCommitType, string> = {
  chore: 'chore',
  save: 'save',
  run: 'run',
  figure: 'figure',
  manuscript: 'manuscript',
  data: 'data',
  code: 'code',
  release: 'release',
  repro: 'repro',
};

/** Build a Conventional-Commit subject line (§3.4): `<type>: <details>`. */
export function generateCommitMessage(type: AutoCommitType, details: string): string {
  return `${COMMIT_PREFIXES[type]}: ${details}`;
}

/**
 * Stage every pending change in the working tree and commit it (§3.4).
 * Returns the commit hash, or null when the tree was clean — the no-change
 * dedupe that keeps repeated autosaves/runs from piling up empty commits.
 */
export async function commitWorkingTree(
  adapter: GitAdapter,
  repoPath: string,
  message: string,
  onCommitted?: () => Promise<void> | void,
): Promise<string | null> {
  const status = await adapter.status(repoPath);
  const changed = [...status.staged, ...status.unstaged, ...status.untracked];
  if (changed.length === 0) return null;
  await adapter.add(repoPath, changed);
  const hash = await adapter.commit(repoPath, message);
  if (onCommitted) await onCommitted();
  return hash;
}
