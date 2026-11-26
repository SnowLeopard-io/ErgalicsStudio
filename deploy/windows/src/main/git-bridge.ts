// ==========================================================================
// Git bridge — simple-git behind a whitelisted method map.
// ==========================================================================
// The renderer speaks the existing GitAdapter contract; each call arrives as
// {method, args} and is dispatched through this explicit map only. The
// repoPath argument must resolve inside a registered root (same guard as the
// fs-bridge), so a compromised renderer cannot point simple-git at arbitrary
// directories.

// simple-git 4 ships no default export; the named factory works in v3 and v4.
import { simpleGit, type SimpleGit } from 'simple-git';
import * as path from 'node:path';
import type { FsBridge } from './fs-bridge';

export interface GitBridge {
  invoke(method: string, args: unknown[]): Promise<unknown>;
}

/** Whitelisted method → arity. Keeps the surface auditable. */
const METHODS: Record<string, number> = {
  init: 2, clone: 3, isRepo: 1, status: 1, log: 2, diff: 2, branches: 1, remotes: 1,
  add: 2, commit: 3, checkout: 3, branch: 3, deleteBranch: 3, merge: 2,
  push: 2, pull: 2, fetch: 2, addRemote: 3, removeRemote: 3,
  installHooks: 2, getHook: 2, removeHook: 2,
  writeFile: 3, readFile: 2, writeFileBinary: 3, readFileBinary: 2,
  deleteEntry: 3, renameEntry: 3, readDir: 2,
  getRootDir: 1, getConfig: 2, setConfig: 3,
};

const MAX_BINARY = 64 * 1024 * 1024;

export function createGitBridge(fs: FsBridge): GitBridge {
  const gits = new Map<string, SimpleGit>();

  function gitFor(repoPath: string): SimpleGit {
    let g = gits.get(repoPath);
    if (!g) {
      g = simpleGit({ baseDir: repoPath, timeout: { block: 120_000 } });
      gits.set(repoPath, g);
    }
    return g;
  }

  function repo(p: unknown): string {
    if (typeof p !== 'string' || !fs.isWithinRoots(p)) {
      throw new Error(`git: repoPath outside registered roots: ${String(p)}`);
    }
    return p;
  }

  return {
    async invoke(method: string, args: unknown[]): Promise<unknown> {
      if (!(method in METHODS)) throw new Error(`git: unknown method ${method}`);
      const g = gitFor(repo(args[0]));
      const a = args as never[];
      switch (method) {
        case 'isRepo': return (await g.checkIsRepo()).valueOf();
        case 'status': {
          const s = await g.status();
          return {
            clean: s.isClean(),
            staged: s.staged,
            unstaged: s.modified,
            untracked: s.not_added,
            ahead: s.ahead,
            behind: s.behind,
            currentBranch: s.current ?? '',
            currentCommit: s.commit,
          };
        }
        case 'log': {
          const opts = (a[1] ?? {}) as { limit?: number };
          const res = await g.log({ maxCount: Math.min(opts.limit ?? 50, 500) });
          return res.all.map((c) => ({
            hash: c.hash,
            shortHash: c.hash.slice(0, 7),
            message: c.message,
            author: { name: c.author_name, email: c.author_email },
            timestamp: Number(c.date) * (Number(c.date) > 1e12 ? 1 : 1000),
            parents: c.refs ? [] : [],
          }));
        }
        case 'branches': {
          const res = await g.branchLocal();
          return Object.entries(res.branches).map(([name, b]) => ({
            name,
            current: res.current === name,
            upstream: b.remote ? `${b.remote}/${name}` : undefined,
            lastCommit: b.commit
              ? { hash: b.commit, shortHash: b.commit.slice(0, 7), message: b.label ?? '', author: { name: '', email: '' }, timestamp: 0, parents: [] }
              : undefined,
          }));
        }
        case 'remotes': {
          const res = await g.getRemotes(true);
          return res.map((r) => ({ name: r.name, url: r.refs.fetch ?? '', fetchRef: r.refs.fetch }));
        }
        case 'init': await g.init(); return undefined;
        case 'clone': {
          const url = String(a[1]);
          const target = String(a[2]);
          if (!fs.isWithinRoots(target)) throw new Error('git: clone target outside registered roots');
          await simpleGit().clone(url, target);
          return undefined;
        }
        case 'add': await g.add((a[1] as string[]) ?? []); return undefined;
        case 'commit': {
          const opts = (a[2] ?? {}) as { author?: { name: string; email: string } };
          const res = await g.commit(String(a[1]), [], opts.author ? { '--author': `${opts.author.name} <${opts.author.email}>` } : {});
          return res.commit;
        }
        case 'checkout': await g.checkout(String(a[1]), a[2] ? ['--orphan'] : []); return undefined;
        case 'branch': await g.branch([a[2] as string, String(a[1])].filter(Boolean) as string[]); return undefined;
        case 'deleteBranch': await g.branch(['-D', String(a[1])]); return undefined;
        case 'merge': {
          try {
            const res = await g.merge([String(a[1]), '--no-edit']);
            return { success: res.result === 'success', commitHash: res.commit, message: res.result };
          } catch (err) {
            return { success: false, message: String(err) };
          }
        }
        case 'push': {
          const o = a[1] as { remote: string; branch: string; force?: boolean; setUpstream?: boolean };
          const flags: string[] = [];
          if (o.force) flags.push('--force');
          if (o.setUpstream) flags.push('--set-upstream');
          await g.push(o.remote, o.branch, flags.length ? flags : undefined);
          return undefined;
        }
        case 'pull': {
          const o = a[1] as { remote: string; branch: string };
          await g.pull(o.remote, o.branch);
          return undefined;
        }
        case 'fetch': {
          const o = a[1] as { remote: string };
          await g.fetch(o.remote);
          return undefined;
        }
        case 'addRemote': await g.addRemote(String(a[1]), String(a[2])); return undefined;
        case 'removeRemote': await g.removeRemote(String(a[1])); return undefined;

        // Working-tree file plumbing (mirrors GitAdapter contract).
        case 'writeFile': {
          const repoPath = repo(a[0]);
          const rel = String(a[1]);
          const abs = joinUnder(repoPath, rel);
          await fs.writeFile(abs, String(a[2]));
          return undefined;
        }
        case 'readFile': {
          const repoPath = repo(a[0]);
          return fs.readFile(joinUnder(repoPath, String(a[1])), 'utf8');
        }
        case 'writeFileBinary': {
          const repoPath = repo(a[0]);
          await fs.writeFile(joinUnder(repoPath, String(a[1])), a[2]);
          return undefined;
        }
        case 'readFileBinary': {
          const repoPath = repo(a[0]);
          return fs.readFile(joinUnder(repoPath, String(a[1])), 'binary');
        }
        case 'deleteEntry': {
          const repoPath = repo(a[0]);
          await fs.delete(joinUnder(repoPath, String(a[1])), Boolean(a[2]));
          return undefined;
        }
        case 'renameEntry': {
          const repoPath = repo(a[0]);
          await fs.rename(joinUnder(repoPath, String(a[1])), joinUnder(repoPath, String(a[2])));
          return undefined;
        }
        case 'readDir': {
          const repoPath = repo(a[0]);
          const entries = await fs.readDir(joinUnder(repoPath, String(a[1] ?? '.')));
          return entries.map((e) => ({ name: e.name, path: String(a[1] ?? '.') ? `${String(a[1])}/${e.name}` : e.name, isDir: e.isDir, size: e.size }));
        }
        case 'getRootDir': {
          try { return (await g.revparse(['--show-toplevel'])) || null; } catch { return null; }
        }
        case 'getConfig': {
          try { return (await g.getConfig(String(a[1]))).value.trim() || null; } catch { return null; }
        }
        case 'setConfig': await g.addConfig(String(a[1]), String(a[2])); return undefined;

        // Hooks: git hooks are plain executables in .git/hooks.
        case 'installHooks': {
          const repoPath = repo(a[0]);
          const hooks = a[1] as { type: string; content: string }[];
          for (const h of hooks) {
            const p = joinUnder(repoPath, `.git/hooks/${h.type}`);
            await fs.writeFile(p, `#!/bin/sh\n${h.content}\n`);
          }
          return undefined;
        }
        case 'getHook': {
          const repoPath = repo(a[0]);
          try { return await fs.readFile(joinUnder(repoPath, `.git/hooks/${String(a[1])}`), 'utf8'); } catch { return null; }
        }
        case 'removeHook': {
          const repoPath = repo(a[0]);
          try { await fs.delete(joinUnder(repoPath, `.git/hooks/${String(a[1])}`), false); } catch { /* already gone */ }
          return undefined;
        }
        case 'diff': {
          const opts = (a[1] ?? {}) as { filePath?: string; staged?: boolean };
          if (opts.filePath) {
            const summary = await g.diffSummary(['HEAD', opts.filePath].filter(Boolean) as string[]);
            return [{
              filePath: opts.filePath,
              isBinary: false,
              additions: summary.insertions,
              deletions: summary.deletions,
              hunks: [],
            }];
          }
          return [];
        }
        default:
          throw new Error(`git: method ${method} not implemented in desktop bridge`);
      }
    },
  };

  function joinUnder(repoPath: string, rel: string): string {
    // The fs-bridge root registration already covers the repo directory
    // (the user picked it), so the fs guard validates the resolved path.
    return path.resolve(repoPath, rel);
  }
}
