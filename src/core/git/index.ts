// ==========================================================================
// Ergalics Studio — Git Adapter Factory (environment-aware)
// ==========================================================================

import { GitAdapter } from './types';
import { IsomorphicGitAdapter } from './isomorphic-adapter';

export type { RepoEntry } from './types';

let nodeAdapter: GitAdapter | null = null;
/** Browser singleton: abort controllers live per adapter instance, so a fresh
 * instance per call would make push/clone aborts permanently ineffective. */
let browserAdapter: IsomorphicGitAdapter | null = null;

export function getGitAdapter(): GitAdapter {
  if (typeof window !== 'undefined') {
    // Browser environment
    if (!browserAdapter) browserAdapter = new IsomorphicGitAdapter();
    return browserAdapter;
  }

  // Node/Electron environment - lazy load
  if (!nodeAdapter) {
    // Dynamic import to avoid bundling simple-git in browser
    // @vite-ignore keeps the browser dependency scanner from following this
    // Node-only branch (it `require`s `simple-git`, which is intentionally not
    // an npm dependency of the web app and must not fail `npm run dev`).
    import(/* @vite-ignore */ './node-adapter').then((mod) => {
      nodeAdapter = new mod.NodeGitAdapter();
    }).catch(() => {
      // Fallback to isomorphic-git if simple-git not available
      nodeAdapter = new IsomorphicGitAdapter();
    });
  }
  return nodeAdapter || new IsomorphicGitAdapter();
}

export function setGitAdapter(adapter: GitAdapter): void {
  nodeAdapter = adapter;
}

export function resetGitAdapter(): void {
  nodeAdapter = null;
  browserAdapter = null;
}