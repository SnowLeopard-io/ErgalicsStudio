// ==========================================================================
// Ergalics Studio — Browser Git Adapter (isomorphic-git + LightningFS)
//
// isomorphic-git v1 in the browser, backed by an IndexedDB filesystem
// (@isomorphic-git/lightning-fs). Repository contents live under a virtual
// per-project path (see projectStore#getProjectRepoPath), so every project is
// a standalone Git repo inside one IndexedDB database.
// ==========================================================================

import * as Git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import {
  GitAdapter,
  GitStatus,
  GitCommit,
  GitBranch,
  GitRemote,
  GitHook,
  DiffResult,
  DiffHunk,
  LogOptions,
  CloneOptions,
  CommitOptions,
  MergeResult,
  PushOptions,
  PullOptions,
  DiffOptions,
  HookType,
} from './types';

// Lazy singleton: constructing LightningFS requires `indexedDB`, which does
// not exist in Node (unit tests) — so instantiate on first use, not at import.
let fsInstance: LightningFS | null = null;

function getFS(): LightningFS {
  if (!fsInstance) fsInstance = new LightningFS('ergalics-git');
  return fsInstance;
}

const GIT_DIR = (repoPath: string) => `${repoPath}/.git`;
const DEFAULT_AUTHOR = { name: 'Ergalics Studio', email: 'studio@ergalics.local' };

/**
 * LightningFS `mkdir` has no `recursive` option — create every missing
 * segment ourselves.
 */
async function mkdirp(repoPath: string, dirPath: string): Promise<void> {
  const fs = getFS();
  const parts = dirPath.split('/').filter(Boolean);
  let current = parts[0];
  if (!dirPath.startsWith('/')) {
    current = `${repoPath}/${parts[0]}`;
  } else {
    current = `/${parts[0]}`;
  }
  for (const part of parts) {
    await fs.promises.mkdir(current, undefined).catch(() => {
      /* already exists */
    });
    current = `${current}/${part}`;
  }
}

function toProgressHandler(
  onProgress?: (phase: string, loaded: number, total: number) => void,
): ((event: { phase: string; loaded: number; total: number }) => void) | undefined {
  return onProgress
    ? (event) => onProgress(event.phase, event.loaded, event.total)
    : undefined;
}

function mapCommit(commit: Awaited<ReturnType<typeof Git.readCommit>>): GitCommit {
  return {
    hash: commit.oid,
    shortHash: commit.oid.slice(0, 7),
    message: commit.commit.message,
    author: {
      name: commit.commit.author.name,
      email: commit.commit.author.email,
    },
    timestamp: commit.commit.author.timestamp * 1000,
    parents: commit.commit.parent,
  };
}

/**
 * Map an isomorphic-git status matrix row to the Ergalics GitStatus buckets.
 * Row layout: [filepath, HEAD(0|1), workdir(0|1|2), stage(0|1)] where
 * 0 = absent, 1 = identical, 2 = workdir differs from the index.
 */
function mapStatusRow(row: readonly (string | number | undefined)[], out: GitStatus): void {
  const file = String(row[0] ?? '');
  const head = Number(row[1] ?? 0);
  const workdir = Number(row[2] ?? 0);
  const stage = Number(row[3] ?? 0);
  if (head === 0 && stage === 0) {
    if (workdir !== 0) out.untracked.push(file);
    return;
  }
  if (stage !== head) {
    out.staged.push(file);
    return;
  }
  if (workdir !== stage) out.unstaged.push(file);
}

// ---- Minimal line diff (LCS) ----------------------------------------------

function lcsDiffLines(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'context' | 'add' | 'del'; content: string }> {
  const n = oldLines.length;
  const m = newLines.length;
  // Guard against pathological inputs: fall back to full replace.
  if (n * m > 4_000_000) {
    return [
      ...oldLines.map((content) => ({ type: 'del' as const, content })),
      ...newLines.map((content) => ({ type: 'add' as const, content })),
    ];
  }
  // DP table of LCS lengths (uint32 rows to keep allocation reasonable).
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const rowI = dp[i]!;
    const rowI1 = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      rowI[j] =
        oldLines[i] === newLines[j]
          ? (rowI1[j + 1] ?? 0) + 1
          : Math.max(rowI1[j] ?? 0, rowI[j + 1] ?? 0);
    }
  }
  const out: Array<{ type: 'context' | 'add' | 'del'; content: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const a = oldLines[i]!;
    const b = newLines[j]!;
    if (a === b) {
      out.push({ type: 'context', content: a });
      i++;
      j++;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ type: 'del', content: a });
      i++;
    } else {
      out.push({ type: 'add', content: b });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', content: oldLines[i++]! });
  while (j < m) out.push({ type: 'add', content: newLines[j++]! });
  return out;
}

export class IsomorphicGitAdapter implements GitAdapter {
  private controllers: Map<string, AbortController> = new Map();

  async init(repoPath: string, template: 'standard' | 'minimal' = 'standard'): Promise<void> {
    const fs = getFS();
    await mkdirp(repoPath, repoPath);
    await Git.init({ fs, dir: repoPath, defaultBranch: 'main' });
    if (template === 'standard') {
      await this.writeStandardTemplate(repoPath);
    }
  }

  private async writeStandardTemplate(repoPath: string): Promise<void> {
    const fs = getFS();
    const files = [
      { path: '.gitignore', content: STANDARD_GITIGNORE },
      { path: '.gitattributes', content: STANDARD_GITATTRIBUTES },
      { path: 'project.clproj', content: '{\n}' },
      { path: 'runs/.gitkeep', content: '' },
      { path: 'figures/.gitkeep', content: '' },
      { path: 'manuscript/.gitkeep', content: '' },
      { path: 'data/.gitkeep', content: '' },
      { path: 'code/.gitkeep', content: '' },
    ];

    for (const f of files) {
      const fullPath = `${repoPath}/${f.path}`;
      await mkdirp(repoPath, fullPath.substring(0, fullPath.lastIndexOf('/')));
      await fs.promises.writeFile(fullPath, f.content);
    }

    await Git.add({ fs, dir: repoPath, filepath: '.' });
    await Git.commit({
      fs,
      dir: repoPath,
      message: 'chore: init project with standard structure',
      author: DEFAULT_AUTHOR,
    });
  }

  async clone(url: string, targetPath: string, opts?: CloneOptions): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(`${targetPath}:clone`, controller);
    const fs = getFS();
    await mkdirp(targetPath, targetPath);

    await Git.clone({
      fs,
      http,
      dir: targetPath,
      url,
      corsProxy: 'https://cors.isomorphic-git.org',
      ref: opts?.branch || 'main',
      singleBranch: opts?.singleBranch ?? true,
      depth: opts?.depth,
      onProgress: toProgressHandler(opts?.onProgress),
    });
  }

  async isRepo(repoPath: string): Promise<boolean> {
    try {
      // LightningFS exposes no `access`; stat the .git dir instead.
      await getFS().promises.stat(GIT_DIR(repoPath));
      return true;
    } catch {
      return false;
    }
  }

  async status(repoPath: string): Promise<GitStatus> {
    const fs = getFS();
    const matrix = await Git.statusMatrix({ fs, dir: repoPath });
    const result: GitStatus = {
      clean: true,
      staged: [],
      unstaged: [],
      untracked: [],
      ahead: 0,
      behind: 0,
      currentBranch: 'main',
    };
    for (const row of matrix) mapStatusRow(row, result);
    result.clean =
      result.staged.length === 0 &&
      result.unstaged.length === 0 &&
      result.untracked.length === 0;
    try {
      const branch = await Git.currentBranch({ fs, dir: repoPath });
      result.currentBranch = branch || 'main';
      result.currentCommit = await this.getCurrentCommit(repoPath);
    } catch {
      // Freshly init'ed repo without commits — defaults stand.
    }
    return result;
  }

  async log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]> {
    const fs = getFS();
    const commits = await Git.log({
      fs,
      dir: repoPath,
      depth: opts?.limit || 100,
      since: opts?.since !== undefined ? new Date(opts.since) : undefined,
    });
    return commits.map(mapCommit);
  }

  /**
   * Workspace-vs-HEAD diff. Note: isomorphic-git v1 exposes no index-content
   * reader, so `opts.staged` diffs are not yet supported (returns []).
   */
  async diff(repoPath: string, opts?: DiffOptions): Promise<DiffResult[]> {
    const fs = getFS();
    const results: DiffResult[] = [];
    const matrix = await Git.statusMatrix({ fs, dir: repoPath });
    let files: string[] = matrix.map((row) => row[0]);
    if (opts?.filePath) {
      files = files.filter((f) => f === opts.filePath);
    }
    let headOid: string | undefined;
    try {
      headOid = await Git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' });
    } catch {
      headOid = undefined;
    }

    for (const file of files) {
      let oldText = '';
      if (headOid) {
        try {
          const blob = await Git.readBlob({ fs, dir: repoPath, oid: headOid, filepath: file });
          oldText = new TextDecoder().decode(blob.blob);
        } catch {
          oldText = ''; // New file in HEAD's eyes.
        }
      }
      let newText = '';
      try {
        const data = await fs.promises.readFile(`${repoPath}/${file}`);
        newText = typeof data === 'string' ? data : new TextDecoder().decode(data);
      } catch {
        continue; // Deleted from the worktree — nothing to render.
      }
      if (oldText === newText) continue;
      results.push(this.buildDiff(file, oldText, newText));
    }
    return results;
  }

  private buildDiff(filePath: string, oldText: string, newText: string): DiffResult {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const raw = lcsDiffLines(oldLines, newLines);

    // Collapse raw line ops into hunks with 3 lines of context.
    const hunks: DiffHunk[] = [];
    let hunk: DiffHunk | null = null;
    let oldLine = 1;
    let newLine = 1;
    let additions = 0;
    let deletions = 0;
    const CONTEXT = 3;
    let sinceChange = Infinity;

    for (const op of raw) {
      if (op.type === 'context') {
        if (hunk && sinceChange <= CONTEXT) {
          hunk.lines.push({
            type: 'context',
            content: op.content,
            oldLineNumber: oldLine,
            newLineNumber: newLine,
          });
        }
        sinceChange++;
        oldLine++;
        newLine++;
        continue;
      }
      sinceChange = 0;
      if (!hunk || sinceChange === 0) {
        hunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] };
        hunks.push(hunk);
      }
      if (op.type === 'add') {
        hunk.lines.push({ type: 'add', content: op.content, newLineNumber: newLine++ });
        additions++;
      } else {
        hunk.lines.push({ type: 'del', content: op.content, oldLineNumber: oldLine++ });
        deletions++;
      }
    }
    return { filePath, isBinary: false, additions, deletions, hunks };
  }

  async branches(repoPath: string): Promise<GitBranch[]> {
    const fs = getFS();
    const names = await Git.listBranches({ fs, dir: repoPath });
    const current = await Git.currentBranch({ fs, dir: repoPath });
    const result: GitBranch[] = [];
    for (const name of names) {
      const branch: GitBranch = { name, current: name === current };
      try {
        const oid = await Git.resolveRef({ fs, dir: repoPath, ref: `refs/heads/${name}` });
        branch.lastCommit = mapCommit(await Git.readCommit({ fs, dir: repoPath, oid }));
      } catch {
        // Branch with no commits yet.
      }
      result.push(branch);
    }
    return result;
  }

  async remotes(repoPath: string): Promise<GitRemote[]> {
    const fs = getFS();
    const remotes = await Git.listRemotes({ fs, dir: repoPath });
    return remotes.map((r) => ({ name: r.remote, url: r.url }));
  }

  async add(repoPath: string, files: string[]): Promise<void> {
    const fs = getFS();
    for (const file of files) {
      await Git.add({ fs, dir: repoPath, filepath: file });
    }
  }

  async commit(repoPath: string, message: string, opts?: CommitOptions): Promise<string> {
    const fs = getFS();
    return Git.commit({
      fs,
      dir: repoPath,
      message,
      author: opts?.author || DEFAULT_AUTHOR,
    });
  }

  async checkout(repoPath: string, ref: string, create = false): Promise<void> {
    const fs = getFS();
    if (create) {
      await Git.branch({ fs, dir: repoPath, ref });
    }
    await Git.checkout({ fs, dir: repoPath, ref, force: true });
  }

  async branch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    const fs = getFS();
    await Git.branch({ fs, dir: repoPath, ref: name, object: startPoint });
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    const fs = getFS();
    await Git.deleteBranch({ fs, dir: repoPath, ref: name });
  }

  /**
   * Merge `branch` into the current branch. isomorphic-git v1 aborts the
   * merge on conflict instead of returning a conflict list, so any failure
   * surfaces as a generic conflict result.
   */
  async merge(repoPath: string, branch: string): Promise<MergeResult> {
    const fs = getFS();
    try {
      const result = await Git.merge({ fs, dir: repoPath, theirs: branch });
      return { success: true, commitHash: result.oid };
    } catch {
      return { success: false, conflicts: [] };
    }
  }

  async push(repoPath: string, opts: PushOptions): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(`${repoPath}:push`, controller);
    const fs = getFS();
    await Git.push({
      fs,
      http,
      dir: repoPath,
      remote: opts.remote,
      ref: opts.branch,
      force: opts.force,
      corsProxy: 'https://cors.isomorphic-git.org',
      onProgress: toProgressHandler(opts.onProgress),
      signal: controller.signal,
    });
  }

  async pull(repoPath: string, opts: PullOptions): Promise<void> {
    const fs = getFS();
    // Note: isomorphic-git v1 has no `--rebase`; pulls are merge-based.
    await Git.pull({
      fs,
      http,
      dir: repoPath,
      remote: opts.remote,
      ref: opts.branch,
      corsProxy: 'https://cors.isomorphic-git.org',
      fastForward: true,
      singleBranch: true,
      author: DEFAULT_AUTHOR,
    });
  }

  async fetch(repoPath: string, remote: string): Promise<void> {
    const fs = getFS();
    await Git.fetch({
      fs,
      http,
      dir: repoPath,
      remote,
      corsProxy: 'https://cors.isomorphic-git.org',
    });
  }

  async addRemote(repoPath: string, name: string, url: string): Promise<void> {
    const fs = getFS();
    await Git.addRemote({ fs, dir: repoPath, remote: name, url });
  }

  async removeRemote(repoPath: string, name: string): Promise<void> {
    const fs = getFS();
    await Git.deleteRemote({ fs, dir: repoPath, remote: name });
  }

  async installHooks(repoPath: string, hooks: GitHook[]): Promise<void> {
    const fs = getFS();
    const hooksDir = `${GIT_DIR(repoPath)}/hooks`;
    await mkdirp(repoPath, hooksDir);
    for (const hook of hooks) {
      const hookPath = `${hooksDir}/${hook.type}`;
      await fs.promises.writeFile(hookPath, `#!/bin/sh\n${hook.content}`);
      // LightningFS exposes no `chmod`; the executable bit is only meaningful
      // on real filesystems (see the Node adapter).
    }
  }

  async writeFile(repoPath: string, filePath: string, content: string): Promise<void> {
    const fs = getFS();
    const fullPath = `${repoPath}/${filePath}`;
    await mkdirp(repoPath, fullPath.substring(0, fullPath.lastIndexOf('/')));
    await fs.promises.writeFile(fullPath, content);
  }

  async getHook(repoPath: string, type: HookType): Promise<string | null> {
    const fs = getFS();
    try {
      const content = await fs.promises.readFile(`${GIT_DIR(repoPath)}/hooks/${type}`);
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      return text.replace(/^#![^\n]*\n/, '').trim();
    } catch {
      return null;
    }
  }

  async removeHook(repoPath: string, type: HookType): Promise<void> {
    const fs = getFS();
    try {
      await fs.promises.unlink(`${GIT_DIR(repoPath)}/hooks/${type}`);
    } catch {
      // Hook absent — nothing to remove.
    }
  }

  async getRootDir(repoPath: string): Promise<string | null> {
    try {
      const fs = getFS();
      return (await Git.findRoot({ fs, filepath: repoPath })) || null;
    } catch {
      return null;
    }
  }

  async getConfig(repoPath: string, key: string): Promise<string | null> {
    try {
      const fs = getFS();
      return (await Git.getConfig({ fs, dir: repoPath, path: key })) ?? null;
    } catch {
      return null;
    }
  }

  async setConfig(repoPath: string, key: string, value: string): Promise<void> {
    const fs = getFS();
    await Git.setConfig({ fs, dir: repoPath, path: key, value });
  }

  private async getCurrentCommit(repoPath: string): Promise<string | undefined> {
    try {
      const fs = getFS();
      return await Git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' });
    } catch {
      return undefined;
    }
  }

  abort(repoPath: string, op: 'push' | 'clone'): void {
    this.controllers.get(`${repoPath}:${op}`)?.abort();
  }
}

const STANDARD_GITIGNORE = `# Ergalics Studio local state
.ergalics/
*.log
.DS_Store

# Large data files (use Git LFS instead)
data/*.h5
data/*.nc
data/*.parquet
data/*.zarr/
data/*.fits
data/*.hdf5

# Build artifacts
manuscript/build/
figures/exports/
supplement/*.zip

# Runtime
node_modules/
dist/
*.wasm
`;

const STANDARD_GITATTRIBUTES = `# Git LFS for large binary files
*.h5 filter=lfs diff=lfs merge=lfs -text
*.nc filter=lfs diff=lfs merge=lfs -text
*.parquet filter=lfs diff=lfs merge=lfs -text
*.zarr filter=lfs diff=lfs merge=lfs -text
*.fits filter=lfs diff=lfs merge=lfs -text
*.hdf5 filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
*.jpg filter=lfs diff=lfs merge=lfs -text
*.pdf filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
`;
