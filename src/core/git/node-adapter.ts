// ==========================================================================
// Ergalics Studio — Node.js Git Adapter (simple-git wrapper)
// For Electron / desktop / server-side use
// ==========================================================================

// Type-only import: erased at build time so the browser bundle never resolves
// `simple-git`. The runtime binding is loaded lazily via `require` below,
// which is only reachable in a Node/Electron context.
import type {
  SimpleGit,
  SimpleGitOptions,
  DefaultLogFields,
  LogResult,
} from 'simple-git';
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
  GIT_ERROR_CODES,
} from './types';
import { STANDARD_HOOKS, STANDARD_TEMPLATE_FILES } from './templates';

function loadSimpleGit(): (opts?: Partial<SimpleGitOptions>) => SimpleGit {
  // Node/Electron only; never called in the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('simple-git');
}

export class NodeGitAdapter implements GitAdapter {
  private repos: Map<string, SimpleGit> = new Map();

  private getGit(repoPath: string): SimpleGit {
    let git = this.repos.get(repoPath);
    if (!git) {
      const options: Partial<SimpleGitOptions> = {
        baseDir: repoPath,
        binary: 'git',
        maxConcurrentProcesses: 6,
      };
      git = loadSimpleGit()(options);
      this.repos.set(repoPath, git);
    }
    return git;
  }

  async init(repoPath: string, template: 'standard' | 'minimal' = 'standard'): Promise<void> {
    const git = this.getGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Ergalics Studio');
    await git.addConfig('user.email', 'studio@ergalics.local');
    await git.checkoutLocalBranch('main');

    if (template === 'standard') {
      await this.writeStandardTemplate(repoPath);
      await git.add('.');
      await git.commit('chore: init project with standard structure');
      // §3.6: preinstall the Ergalics hooks into .git/hooks (chmod 755).
      await this.installHooks(repoPath, STANDARD_HOOKS);
    }
  }

  private async writeStandardTemplate(repoPath: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    for (const f of STANDARD_TEMPLATE_FILES) {
      const fullPath = path.join(repoPath, f.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, f.content);
    }
  }

  async clone(url: string, targetPath: string, opts?: CloneOptions): Promise<void> {
    const git = loadSimpleGit()({ baseDir: targetPath });
    await git.clone(url, targetPath, {
      '--depth': opts?.depth,
      '--branch': opts?.branch || 'main',
      '--single-branch': opts?.singleBranch ?? true,
    });
  }

  async isRepo(repoPath: string): Promise<boolean> {
    try {
      const git = this.getGit(repoPath);
      await git.checkIsRepo();
      return true;
    } catch {
      return false;
    }
  }

  async status(repoPath: string): Promise<GitStatus> {
    const git = this.getGit(repoPath);
    const status = await git.status();
    const branch = status.current;
    const aheadBehind = await this.getAheadBehind(repoPath, branch);

    return {
      clean: status.isClean(),
      staged: status.staged,
      unstaged: status.modified,
      untracked: status.not_added,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      currentBranch: branch || 'main',
    };
  }

  async log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]> {
    const git = this.getGit(repoPath);
    const log: LogResult = await git.log({
      ...(opts?.limit && { '-n': opts.limit }),
      ...(opts?.since && { '--since': new Date(opts.since).toISOString() }),
      ...(opts?.until && { '--until': new Date(opts.until).toISOString() }),
      ...(opts?.author && { '--author': opts.author }),
      ...(opts?.path && { '--': opts.path }),
      ...(opts?.skip && { '--skip': opts.skip }),
    });

    return log.all.map((c: DefaultLogFields & { parents?: string | string[] }) => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 7),
      message: c.message,
      author: { name: c.author_name, email: c.author_email },
      timestamp: Date.parse(c.date),
      parents: Array.isArray(c.parents)
        ? c.parents
        : typeof c.parents === 'string' && c.parents.length > 0
          ? c.parents.split(' ')
          : [],
    }));
  }

  async diff(repoPath: string, opts?: DiffOptions): Promise<DiffResult[]> {
    const git = this.getGit(repoPath);
    const args: string[] = ['diff'];

    if (opts?.staged) args.push('--cached');
    if (opts?.commitA && opts?.commitB) {
      args.push(`${opts.commitA}..${opts.commitB}`);
    } else if (opts?.commitA) {
      args.push(opts.commitA);
    }
    if (opts?.filePath) args.push('--', opts.filePath);

    const diffText = await git.raw(args);
    return this.parseDiff(diffText);
  }

  private parseDiff(diffText: string): DiffResult[] {
    if (!diffText.trim()) return [];
    const files = diffText.split('diff --git ').slice(1);
    return files.map((f) => this.parseSingleDiff(f));
  }

  private parseSingleDiff(diff: string): DiffResult {
    const lines = diff.split('\n');
    const fileMatch = lines[0]?.match(/^a\/(.+) b\/(.+)$/);
    const filePath = fileMatch?.[2] ?? 'unknown';
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let additions = 0;
    let deletions = 0;
    let isBinary = false;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines.slice(1)) {
      if (line.startsWith('Binary files')) {
        isBinary = true;
        break;
      }
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1] ?? '0', 10);
        newLine = parseInt(hunkMatch[3] ?? '0', 10);
        currentHunk = {
          oldStart: oldLine,
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: newLine,
          newLines: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
        continue;
      }

      if (currentHunk) {
        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNumber: newLine++ });
          additions++;
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'del', content: line.slice(1), oldLineNumber: oldLine++ });
          deletions++;
        } else if (line.startsWith(' ')) {
          currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    return { filePath, isBinary, additions, deletions, hunks };
  }

  async branches(repoPath: string): Promise<GitBranch[]> {
    const git = this.getGit(repoPath);
    const summary = await git.branch();
    const result: GitBranch[] = [];

    for (const [name, info] of Object.entries(summary.branches ?? {}) as Array<
      [string, { current?: boolean; upstream?: string; ahead?: number; behind?: number }]
    >) {
      const commit = await this.getBranchCommit(repoPath, name);
      result.push({
        name,
        current: info.current ?? false,
        upstream: info.upstream,
        ahead: info.ahead,
        behind: info.behind,
        lastCommit: commit,
      });
    }
    return result;
  }

  async remotes(repoPath: string): Promise<GitRemote[]> {
    const git = this.getGit(repoPath);
    const remotes = await git.getRemotes(true);
    return remotes.map((r: { name: string; refs: { fetch?: string | null; push?: string | null } }) => ({
      name: r.name,
      url: r.refs.fetch || r.refs.push || '',
    }));
  }

  async add(repoPath: string, files: string[]): Promise<void> {
    const git = this.getGit(repoPath);
    await git.add(files);
  }

  async commit(repoPath: string, message: string, opts?: CommitOptions): Promise<string> {
    const git = this.getGit(repoPath);
    if (opts?.author) {
      await git.addConfig('user.name', opts.author.name);
      await git.addConfig('user.email', opts.author.email);
    }
    const result = await git.commit(message, opts?.allowEmpty ? ['--allow-empty'] : undefined);
    return result.commit;
  }

  async checkout(repoPath: string, ref: string, create = false): Promise<void> {
    const git = this.getGit(repoPath);
    if (!create) {
      // Refuse to silently discard uncommitted work (mirrors the isomorphic
      // adapter): staged/modified files and a different target branch → EDIRTY.
      const st = await git.status();
      const dirty = [...st.staged, ...st.modified];
      if (st.current && st.current !== ref && dirty.length > 0) {
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
    if (create) {
      await git.checkoutLocalBranch(ref);
    } else {
      await git.checkout(ref);
    }
  }

  async branch(repoPath: string, name: string, startPoint?: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.branch(name, startPoint);
  }

  async deleteBranch(repoPath: string, name: string, force = false): Promise<void> {
    const git = this.getGit(repoPath);
    await git.deleteLocalBranch(name, force);
  }

  async merge(repoPath: string, branch: string): Promise<MergeResult> {
    const git = this.getGit(repoPath);
    try {
      const result = await git.merge(branch);
      if (result.failed) {
        return { success: false, conflicts: result.conflicts };
      }
      return { success: true, commitHash: result.commit };
    } catch (err) {
      return { success: false, conflicts: [] };
    }
  }

  async push(repoPath: string, opts: PushOptions): Promise<void> {
    const git = this.getGit(repoPath);
    await git.push(opts.remote, opts.branch, {
      '--force': opts.force,
      '--set-upstream': opts.setUpstream,
    });
  }

  async pull(repoPath: string, opts: PullOptions): Promise<void> {
    const git = this.getGit(repoPath);
    await git.pull(opts.remote, opts.branch, { '--rebase': opts.rebase });
  }

  async fetch(repoPath: string, remote: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.fetch(remote);
  }

  async addRemote(repoPath: string, name: string, url: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.addRemote(name, url);
  }

  async removeRemote(repoPath: string, name: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.removeRemote(name);
  }

  async installHooks(repoPath: string, hooks: GitHook[]): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const hooksDir = path.join(repoPath, '.git', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });

    for (const hook of hooks) {
      const hookPath = path.join(hooksDir, hook.type);
      const content = `#!/bin/sh\n${hook.content}`;
      await fs.writeFile(hookPath, content);
      await fs.chmod(hookPath, 0o755);
    }
  }

  async writeFile(repoPath: string, filePath: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullPath = path.join(repoPath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async readFile(repoPath: string, filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    return fs.readFile(path.join(repoPath, filePath), 'utf-8');
  }

  async getHook(repoPath: string, type: HookType): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
      const content = await fs.readFile(path.join(repoPath, '.git', 'hooks', type), 'utf-8');
      return content.replace(/^#!/, '').trim();
    } catch {
      return null;
    }
  }

  async removeHook(repoPath: string, type: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
      await fs.unlink(path.join(repoPath, '.git', 'hooks', type));
    } catch {
      // ignore
    }
  }

  async getRootDir(repoPath: string): Promise<string | null> {
    const git = this.getGit(repoPath);
    try {
      const root = await git.revparse(['--show-toplevel']);
      return root.trim();
    } catch {
      return null;
    }
  }

  async getConfig(repoPath: string, key: string): Promise<string | null> {
    const git = this.getGit(repoPath);
    try {
      return await git.getConfig(key);
    } catch {
      return null;
    }
  }

  async setConfig(repoPath: string, key: string, value: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.addConfig(key, value);
  }

  private async getAheadBehind(repoPath: string, branch: string): Promise<{ ahead: number; behind: number }> {
    const git = this.getGit(repoPath);
    if (!branch) return { ahead: 0, behind: 0 };
    try {
      await git.revparse([`${branch}@{upstream}`]);
      const raw = await git.raw([
        'rev-list',
        '--left-right',
        '--count',
        `${branch}...${branch}@{upstream}`,
      ]);
      const [ahead, behind] = raw.trim().split(/\s+/).map((n: string) => Number(n) || 0);
      return { ahead, behind };
    } catch {
      // No upstream configured — a local-only repo is 0/0.
      return { ahead: 0, behind: 0 };
    }
  }

  private async getBranchCommit(repoPath: string, branch: string): Promise<GitCommit | undefined> {
    const git = this.getGit(repoPath);
    try {
      const log = await git.log(['-n', '1', '--format=%H|%s|%an|%ae|%at|%P', branch]);
      const c = log.latest;
      if (!c) return undefined;
      return {
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message,
        author: { name: c.author_name, email: c.author_email },
        timestamp: Date.parse(c.date),
        parents: c.parents,
      };
    } catch {
      return undefined;
    }
  }
}