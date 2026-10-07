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
  GitError,
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
  RepoEntry,
  GIT_ERROR_CODES,
} from './types';
import { STANDARD_HOOKS, STANDARD_TEMPLATE_FILES } from './templates';

// Lazy singleton: constructing LightningFS requires `indexedDB`, which does
// not exist in Node (unit tests) — so instantiate on first use, not at import.
let fsInstance: LightningFS | null = null;

function getFS(): LightningFS {
  if (!fsInstance) fsInstance = new LightningFS('ergalics-git');
  return fsInstance;
}

const GIT_DIR = (repoPath: string) => `${repoPath}/.git`;
const DEFAULT_AUTHOR = { name: 'Ergalics Studio', email: 'studio@ergalics.local' };

// ---- CORS proxy -------------------------------------------------------------
// Browser git needs a CORS proxy for every remote HTTP call. The public
// isomorphic-git proxy does not cover every host (gitee notably fails with a
// bare ERR_FAILED), so the proxy is user-configurable and persisted in
// localStorage; `setGitCorsProxy('')` restores the public default.
const CORS_PROXY_KEY = 'ergalics:git-cors-proxy';
const DEFAULT_GIT_CORS_PROXY = 'https://cors.isomorphic-git.org';
let gitCorsProxy = DEFAULT_GIT_CORS_PROXY;
if (typeof localStorage !== 'undefined') {
  gitCorsProxy = localStorage.getItem(CORS_PROXY_KEY) || DEFAULT_GIT_CORS_PROXY;
}

export function getGitCorsProxy(): string {
  return gitCorsProxy;
}

export function setGitCorsProxy(url: string): void {
  const next = url.trim();
  gitCorsProxy = next.length > 0 ? next : DEFAULT_GIT_CORS_PROXY;
  try {
    localStorage.setItem(CORS_PROXY_KEY, gitCorsProxy);
  } catch {
    // Private-mode storage quota — the in-memory value still applies.
  }
}

/** Per-call override falling back to the persisted global proxy. */
const proxyFor = (opts?: { corsProxy?: string }) => opts?.corsProxy ?? getGitCorsProxy();

/**
 * Create `dirPath` segment by segment (absolute, from the fs root).
 * LightningFS `mkdir` has no `recursive` option and `writeFile` does not
 * create missing parents, so every level must be mkdir'ed explicitly. The
 * first implementation double-prefixed the repo path and never created the
 * target directory itself, which broke every nested write (runs/, hooks/…).
 */
async function mkdirp(fs: LightningFS, dirPath: string): Promise<void> {
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    await fs.promises.mkdir(current, undefined).catch(() => {
      /* already exists */
    });
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

  /**
   * Injection point for unit tests: Node has no `indexedDB`, so tests pass a
   * minimal in-memory fs (promises: readFile/writeFile/mkdir/rmdir/unlink/
   * readdir/stat/lstat — the subset isomorphic-git's FileSystem wraps).
   */
  constructor(private readonly fsOverride?: LightningFS) {}

  private getFS(): LightningFS {
    return this.fsOverride ?? getFS();
  }

  async init(repoPath: string, template: 'standard' | 'minimal' = 'standard'): Promise<void> {
    const fs = this.getFS();
    await mkdirp(fs, repoPath);
    await Git.init({ fs, dir: repoPath, defaultBranch: 'main' });
    if (template === 'standard') {
      await this.writeStandardTemplate(repoPath);
      // §3.6: preinstall the Ergalics hooks into .git/hooks.
      await this.installHooks(repoPath, STANDARD_HOOKS);
    }
  }

  private async writeStandardTemplate(repoPath: string): Promise<void> {
    const fs = this.getFS();

    for (const f of STANDARD_TEMPLATE_FILES) {
      const fullPath = `${repoPath}/${f.path}`;
      await mkdirp(fs, fullPath.substring(0, fullPath.lastIndexOf('/')));
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
    const fs = this.getFS();
    await mkdirp(fs, targetPath);

    await Git.clone({
      fs,
      http,
      dir: targetPath,
      url,
      corsProxy: proxyFor(opts),
      ref: opts?.branch || 'main',
      singleBranch: opts?.singleBranch ?? true,
      depth: opts?.depth,
      onProgress: toProgressHandler(opts?.onProgress),
    });
  }

  async isRepo(repoPath: string): Promise<boolean> {
    try {
      // LightningFS exposes no `access`; stat the .git dir instead.
      await this.getFS().promises.stat(GIT_DIR(repoPath));
      return true;
    } catch {
      return false;
    }
  }

  async status(repoPath: string): Promise<GitStatus> {
    const fs = this.getFS();
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
      const aheadBehind = await this.computeAheadBehind(repoPath, result.currentBranch);
      result.ahead = aheadBehind.ahead;
      result.behind = aheadBehind.behind;
    } catch {
      // Freshly init'ed repo without commits — defaults stand.
    }
    return result;
  }

  /**
   * Count commits ahead/behind the upstream (`<remote>/<branch>`, remote
   * defaults to `origin`, then the first configured remote). No upstream ref
   * (offline repo, never pushed) → 0/0. Histories are capped at 1000 commits
   * each; isomorphic-git has no merge-base primitive, so set differences of
   * the two walks stand in for one.
   */
  private async computeAheadBehind(
    repoPath: string,
    branch: string,
  ): Promise<{ ahead: number; behind: number }> {
    try {
      const fs = this.getFS();
      const remotes = await Git.listRemotes({ fs, dir: repoPath });
      const remote = remotes.find((r) => r.remote === 'origin')?.remote ?? remotes[0]?.remote;
      if (!remote) return { ahead: 0, behind: 0 };
      const localRef = `refs/heads/${branch}`;
      const upstreamRef = `refs/remotes/${remote}/${branch}`;
      const [local, upstream] = await Promise.all([
        Git.resolveRef({ fs, dir: repoPath, ref: localRef }).catch(() => null),
        Git.resolveRef({ fs, dir: repoPath, ref: upstreamRef }).catch(() => null),
      ]);
      if (!local || !upstream || local === upstream) return { ahead: 0, behind: 0 };
      const [localLog, upstreamLog] = await Promise.all([
        Git.log({ fs, dir: repoPath, ref: localRef, depth: 1000 }),
        Git.log({ fs, dir: repoPath, ref: upstreamRef, depth: 1000 }),
      ]);
      const localOids = new Set(localLog.map((c) => c.oid));
      const upstreamOids = new Set(upstreamLog.map((c) => c.oid));
      let ahead = 0;
      for (const oid of localOids) if (!upstreamOids.has(oid)) ahead++;
      let behind = 0;
      for (const oid of upstreamOids) if (!localOids.has(oid)) behind++;
      return { ahead, behind };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  async log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]> {
    const fs = this.getFS();
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
    const fs = this.getFS();
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
    const fs = this.getFS();
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
    const fs = this.getFS();
    const remotes = await Git.listRemotes({ fs, dir: repoPath });
    return remotes.map((r) => ({ name: r.remote, url: r.url }));
  }

  async add(repoPath: string, files: string[]): Promise<void> {
    const fs = this.getFS();
    for (const file of files) {
      // The file list comes from a status snapshot taken earlier; anything
      // deleted (or already committed) since then would abort the whole add
      // with a raw ENOENT from isomorphic-git. Skip vanished entries and
      // directories — commit picks up whatever still exists.
      try {
        const st = await fs.promises.stat(`${repoPath}/${file}`);
        if (st.isDirectory()) continue;
      } catch {
        continue;
      }
      await Git.add({ fs, dir: repoPath, filepath: file });
    }
  }

  async commit(repoPath: string, message: string, opts?: CommitOptions): Promise<string> {
    const fs = this.getFS();
    return Git.commit({
      fs,
      dir: repoPath,
      message,
      author: opts?.author || DEFAULT_AUTHOR,
    });
  }

  /**
   * Switch to `ref`. A plain checkout (create=false) refuses to run with
   * staged/unstaged changes — switching would silently discard them (the old
   * implementation always passed `force: true`). Pass create=true (new
   * branch at HEAD, working tree untouched) or commit first. Untracked files
   * are allowed, matching git's tolerance when they are not overwritten.
   */
  async checkout(repoPath: string, ref: string, create = false): Promise<void> {
    const fs = this.getFS();
    if (!create) {
      // Unborn HEAD resolves to undefined — nothing to lose yet.
      const current = await Git.currentBranch({ fs, dir: repoPath }).catch(() => undefined);
      if (current && current !== ref) {
        const st = await this.status(repoPath);
        const dirty = [...st.staged, ...st.unstaged];
        if (dirty.length > 0) {
          const err = new Error(
            `Cannot checkout '${ref}': uncommitted changes would be lost. ` +
              'Commit these files first:\n' +
              dirty.map((f) => `  ${f}`).join('\n'),
          ) as GitError;
          err.code = GIT_ERROR_CODES.DIRTY;
          err.gitCommand = 'checkout';
          throw err;
        }
      }
    }
    if (create) {
      await Git.branch({ fs, dir: repoPath, ref });
    }
    await Git.checkout({ fs, dir: repoPath, ref, force: true });
  }

  async branch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    const fs = this.getFS();
    await Git.branch({ fs, dir: repoPath, ref: name, object: startPoint });
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    const fs = this.getFS();
    await Git.deleteBranch({ fs, dir: repoPath, ref: name });
  }

  /**
   * Merge `branch` into the current branch. isomorphic-git v1 aborts the
   * merge on conflict instead of returning a conflict list, so any failure
   * surfaces as a generic conflict result.
   */
  async merge(repoPath: string, branch: string): Promise<MergeResult> {
    const fs = this.getFS();
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
    const fs = this.getFS();
    await Git.push({
      fs,
      http,
      dir: repoPath,
      remote: opts.remote,
      ref: opts.branch,
      force: opts.force,
      corsProxy: proxyFor(opts),
      onProgress: toProgressHandler(opts.onProgress),
      signal: controller.signal,
    });
  }

  async pull(repoPath: string, opts: PullOptions): Promise<void> {
    const fs = this.getFS();
    // Note: isomorphic-git v1 has no `--rebase`; pulls are merge-based.
    await Git.pull({
      fs,
      http,
      dir: repoPath,
      remote: opts.remote,
      ref: opts.branch,
      corsProxy: proxyFor(opts),
      fastForward: true,
      singleBranch: true,
      author: DEFAULT_AUTHOR,
    });
  }

  async fetch(repoPath: string, remote: string): Promise<void> {
    const fs = this.getFS();
    await Git.fetch({
      fs,
      http,
      dir: repoPath,
      remote,
      corsProxy: getGitCorsProxy(),
    });
  }

  async addRemote(repoPath: string, name: string, url: string): Promise<void> {
    const fs = this.getFS();
    await Git.addRemote({ fs, dir: repoPath, remote: name, url });
  }

  async removeRemote(repoPath: string, name: string): Promise<void> {
    const fs = this.getFS();
    await Git.deleteRemote({ fs, dir: repoPath, remote: name });
  }

  async installHooks(repoPath: string, hooks: GitHook[]): Promise<void> {
    const fs = this.getFS();
    const hooksDir = `${GIT_DIR(repoPath)}/hooks`;
    await mkdirp(fs, hooksDir);
    for (const hook of hooks) {
      const hookPath = `${hooksDir}/${hook.type}`;
      await fs.promises.writeFile(hookPath, `#!/bin/sh\n${hook.content}`);
      // LightningFS exposes no `chmod`; the executable bit is only meaningful
      // on real filesystems (see the Node adapter).
    }
  }

  async writeFile(repoPath: string, filePath: string, content: string): Promise<void> {
    const fs = this.getFS();
    const fullPath = `${repoPath}/${filePath}`;
    await mkdirp(fs, fullPath.substring(0, fullPath.lastIndexOf('/')));
    await fs.promises.writeFile(fullPath, content);
  }

  async readFile(repoPath: string, filePath: string): Promise<string> {
    const data = await this.getFS().promises.readFile(`${repoPath}/${filePath}`);
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  }

  /** LightningFS readdir yields bare names — stat each child for the
   * dir/file split. N+1 stats are fine: explorer listings are small and
   * lazy per directory. */
  async readDir(repoPath: string, dirPath: string): Promise<RepoEntry[]> {
    const fs = this.getFS();
    const full = dirPath ? `${repoPath}/${dirPath}` : repoPath;
    let names: string[];
    try {
      names = (await fs.promises.readdir(full)) as string[];
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names.map(async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        try {
          const st = (await fs.promises.stat(`${full}/${name}`)) as {
            isDirectory(): boolean;
            size?: number;
          };
          return { name, path, isDir: st.isDirectory(), size: st.size ?? 0 } satisfies RepoEntry;
        } catch {
          return { name, path, isDir: false, size: 0 } satisfies RepoEntry;
        }
      }),
    );
    return entries.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async getHook(repoPath: string, type: HookType): Promise<string | null> {
    const fs = this.getFS();
    try {
      const content = await fs.promises.readFile(`${GIT_DIR(repoPath)}/hooks/${type}`);
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      return text.replace(/^#![^\n]*\n/, '').trim();
    } catch {
      return null;
    }
  }

  async removeHook(repoPath: string, type: HookType): Promise<void> {
    const fs = this.getFS();
    try {
      await fs.promises.unlink(`${GIT_DIR(repoPath)}/hooks/${type}`);
    } catch {
      // Hook absent — nothing to remove.
    }
  }

  async getRootDir(repoPath: string): Promise<string | null> {
    try {
      const fs = this.getFS();
      return (await Git.findRoot({ fs, filepath: repoPath })) || null;
    } catch {
      return null;
    }
  }

  async getConfig(repoPath: string, key: string): Promise<string | null> {
    try {
      const fs = this.getFS();
      return (await Git.getConfig({ fs, dir: repoPath, path: key })) ?? null;
    } catch {
      return null;
    }
  }

  async setConfig(repoPath: string, key: string, value: string): Promise<void> {
    const fs = this.getFS();
    await Git.setConfig({ fs, dir: repoPath, path: key, value });
  }

  private async getCurrentCommit(repoPath: string): Promise<string | undefined> {
    try {
      const fs = this.getFS();
      return await Git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' });
    } catch {
      return undefined;
    }
  }

  abort(repoPath: string, op: 'push' | 'clone'): void {
    this.controllers.get(`${repoPath}:${op}`)?.abort();
  }
}
