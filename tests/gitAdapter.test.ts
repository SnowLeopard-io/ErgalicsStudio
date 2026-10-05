// ==========================================================================
// Ergalics Studio — Git adapter unit tests (docs/requirements/01 §3.3/3.4)
//
// Node has no `indexedDB`, so LightningFS cannot start here. Instead of
// faking a whole browser, the tests inject a minimal in-memory fs into
// IsomorphicGitAdapter (constructor injection point) implementing exactly
// the subset isomorphic-git's FileSystem wrapper binds: readFile,
// writeFile, mkdir, rmdir, unlink, readdir, stat, lstat.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import type LightningFS from '@isomorphic-git/lightning-fs';
import { IsomorphicGitAdapter } from '@/core/git/isomorphic-adapter';
import { commitWorkingTree, generateCommitMessage } from '@/core/git/autoCommit';

// ---- in-memory fs ----------------------------------------------------------

interface StatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
}

function makeMemoryFS() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  const encoder = new TextEncoder();

  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const parentOf = (p: string) => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  };
  // Lexical normalize: isomorphic-git passes paths like `${dir}/.` or with
  // duplicate slashes; LightningFS's path module resolves those the same way.
  const norm = (p: string) => {
    const parts = p.split('/').filter((s) => s.length > 0 && s !== '.');
    return `/${parts.join('/')}`;
  };
  const ensureDirs = (p: string) => {
    let current = '';
    for (const part of p.split('/').filter(Boolean)) {
      current += `/${part}`;
      dirs.add(current);
    }
  };
  // Deterministic per-path timestamp (git index needs mtime/ctime).
  const mtimeOf = (p: string) => 1_700_000_000_000 + (p.length % 97);
  const statOf = (rawPath: string): StatLike => {
    const p = norm(rawPath);
    const data = files.get(p);
    const mtime = mtimeOf(p);
    if (data !== undefined) {
      return {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: data.byteLength,
        mode: 0o100644,
        mtimeMs: mtime,
        ctimeMs: mtime,
      };
    }
    if (dirs.has(p)) {
      return {
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
        size: 0,
        mode: 0o40755,
        mtimeMs: mtime,
        ctimeMs: mtime,
      };
    }
    throw enoent(p);
  };

  const decoder = new TextDecoder();
  return {
    promises: {
      async readFile(rawPath: string, opts?: { encoding?: string }): Promise<Uint8Array | string> {
        const p = norm(rawPath);
        const data = files.get(p);
        if (data === undefined) throw enoent(p);
        // isomorphic-git reads refs/config with {encoding:'utf8'} and hands
        // the result straight to string APIs — honor the option like Node.
        if (opts?.encoding === 'utf8') return decoder.decode(data);
        return data;
      },
      async writeFile(rawPath: string, data: Uint8Array | string): Promise<void> {
        const p = norm(rawPath);
        ensureDirs(parentOf(p));
        files.set(p, typeof data === 'string' ? encoder.encode(data) : data);
      },
      async mkdir(rawPath: string): Promise<void> {
        const p = norm(rawPath);
        if (dirs.has(p) || files.has(p)) {
          throw Object.assign(new Error(`EEXIST: ${p}`), { code: 'EEXIST' });
        }
        ensureDirs(parentOf(p));
        dirs.add(p);
      },
      async rmdir(rawPath: string): Promise<void> {
        dirs.delete(norm(rawPath));
      },
      async unlink(rawPath: string): Promise<void> {
        const p = norm(rawPath);
        if (!files.has(p)) throw enoent(p);
        files.delete(p);
      },
      async readdir(rawPath: string): Promise<string[]> {
        const p = norm(rawPath);
        if (!dirs.has(p)) throw enoent(p);
        const prefix = p === '/' ? '/' : `${p}/`;
        const names = new Set<string>();
        for (const full of [...files.keys(), ...dirs]) {
          if (full === p || !full.startsWith(prefix)) continue;
          const rest = full.slice(prefix.length);
          if (rest.length > 0 && !rest.includes('/')) names.add(rest);
        }
        return [...names];
      },
      stat: async (p: string) => statOf(p),
      lstat: async (p: string) => statOf(p),
      async readlink(): Promise<string> {
        throw Object.assign(new Error('EPERM: readlink'), { code: 'EPERM' });
      },
      async symlink(): Promise<void> {
        throw Object.assign(new Error('EPERM: symlink'), { code: 'EPERM' });
      },
    },
  };
}

function makeAdapter() {
  const memfs = makeMemoryFS();
  const adapter = new IsomorphicGitAdapter(memfs as unknown as LightningFS);
  return { adapter, memfs };
}

let repoSeq = 0;
const nextRepo = () => `/ergalics-test/repo-${++repoSeq}`;

// ---- ① mkdirp: nested paths must be created segment by segment -------------

describe('mkdirp regression (§3.1 nested writes)', () => {
  it('writeFile creates nested parents (a/b/c.txt)', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'minimal');

    await adapter.writeFile(repo, 'a/b/c.txt', 'hello');
    expect(await adapter.readFile(repo, 'a/b/c.txt')).toBe('hello');
  });

  it('writeFile creates .ergalics/hooks paths (dotted segments)', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'minimal');

    await adapter.writeFile(repo, '.ergalics/hooks/pre-commit', '#!/bin/sh\ntrue\n');
    expect(await adapter.readFile(repo, '.ergalics/hooks/pre-commit')).toContain('true');
  });

  it('init(standard) materializes the §3.1 tree without ENOENT', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    // Before the mkdirp fix this threw ENOENT writing runs/.gitkeep and left
    // the repo without .gitignore / initial commit.
    await adapter.init(repo, 'standard');

    expect(await adapter.readFile(repo, '.gitignore')).toContain('.ergalics/');
    expect(await adapter.readFile(repo, '.ergalics/workspace.json')).toContain('openTabs');
    // US-07: CI workflow template lands in the working tree on init.
    expect(await adapter.readFile(repo, '.github/workflows/ergalics.yml')).toContain(
      'pack-supplement',
    );
    // §3.6: hooks preinstalled into .git/hooks.
    expect(await adapter.getHook(repo, 'pre-commit')).toContain('repro.lock');
    expect(await adapter.getHook(repo, 'pre-push')).toContain('test:unit');
    expect(await adapter.getHook(repo, 'post-checkout')).toContain('workspace.json');
  });
});

// ---- ② init → status → add → commit → log full chain -----------------------

describe('init → status → add → commit → log (§3.3)', () => {
  it('commits the standard template on init and tracks changes', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');

    // Initial commit (US-01: git log shows the init commit right away).
    const log0 = await adapter.log(repo);
    expect(log0.length).toBe(1);
    expect(log0[0]!.message).toContain('chore: init');
    expect(log0[0]!.shortHash).toHaveLength(7);
    expect(log0[0]!.parents).toEqual([]);

    const st0 = await adapter.status(repo);
    expect(st0.clean).toBe(true);
    expect(st0.currentBranch).toBe('main');
    expect(st0.ahead).toBe(0);
    expect(st0.behind).toBe(0);

    await adapter.writeFile(repo, 'runs/run-1.json', '{"id":"run-1"}');
    const st1 = await adapter.status(repo);
    expect(st1.clean).toBe(false);
    expect(st1.untracked).toContain('runs/run-1.json');
    // .ergalics/ is gitignored (§3.2) and never shows as pending.
    expect(st1.untracked).not.toContain('.ergalics/workspace.json');

    await adapter.add(repo, ['runs/run-1.json']);
    const st2 = await adapter.status(repo);
    expect(st2.staged).toContain('runs/run-1.json');

    const hash = await adapter.commit(repo, 'run: first experiment (source=flow)');
    expect(hash).toHaveLength(40);

    const log1 = await adapter.log(repo, { limit: 10 });
    expect(log1.length).toBe(2);
    expect(log1[0]!.message).toContain('run: first experiment');
    expect(log1[0]!.parents).toEqual([log1[1]!.hash]);
  });
});

// ---- ③ auto-commit helpers --------------------------------------------------

describe('auto-commit helpers (§3.4)', () => {
  it('generateCommitMessage builds <type>: <subject> lines', () => {
    expect(generateCommitMessage('run', 'normalize (source=flow)')).toBe(
      'run: normalize (source=flow)',
    );
    expect(generateCommitMessage('figure', 'Figure 3')).toBe('figure: Figure 3');
    expect(generateCommitMessage('release', 'supplement v2026-10-05')).toBe(
      'release: supplement v2026-10-05',
    );
    expect(generateCommitMessage('chore', 'init project')).toBe('chore: init project');
  });

  it('commitWorkingTree skips clean trees and commits dirty ones', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');

    // No changes → null (dedupe: repeated triggers never empty-commit).
    expect(await commitWorkingTree(adapter, repo, 'run: dup')).toBeNull();
    expect((await adapter.log(repo)).length).toBe(1);

    await adapter.writeFile(repo, 'data/note.txt', '1.0');
    const hash = await commitWorkingTree(adapter, repo, generateCommitMessage('data', 'note'));
    expect(hash).toBeTruthy();
    // Git commit messages carry a trailing newline by convention.
    expect((await adapter.log(repo))[0]!.message.trim()).toBe('data: note');

    // Clean again after committing.
    expect(await commitWorkingTree(adapter, repo, 'data: dup')).toBeNull();
  });
});

// ---- ④ ahead/behind + checkout guard ---------------------------------------

describe('ahead/behind (§3.3 GitStatus)', () => {
  it('is 0/0 without a remote-tracking ref', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');
    const st = await adapter.status(repo);
    expect(st.ahead).toBe(0);
    expect(st.behind).toBe(0);
  });

  it('counts divergent commits against refs/remotes/origin/main', async () => {
    const { adapter, memfs } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');
    // Register the remote the tracking ref will belong to.
    await adapter.addRemote(repo, 'origin', 'https://example.invalid/ergalics/repo.git');

    // Fork tmp at the init commit BEFORE the local commit → true divergence.
    await adapter.branch(repo, 'tmp');

    // Local-only commit on main (not reachable from tmp).
    await adapter.writeFile(repo, 'a.txt', 'local change');
    await commitWorkingTree(adapter, repo, 'c2: local');

    // Remote-only commit on tmp (clean tree → checkout allowed).
    await adapter.checkout(repo, 'tmp');
    await adapter.writeFile(repo, 'b.txt', 'remote change');
    await commitWorkingTree(adapter, repo, 'c3: remote');
    const branches = await adapter.branches(repo);
    const tmpTip = branches.find((b) => b.name === 'tmp')!.lastCommit!.hash;

    // Back to main, then "fetch": write the remote-tracking ref directly.
    await adapter.checkout(repo, 'main');
    await memfs.promises.writeFile(`${repo}/.git/refs/remotes/origin/main`, `${tmpTip}\n`);

    const st = await adapter.status(repo);
    expect(st.currentBranch).toBe('main');
    expect(st.ahead).toBe(1); // c2 not reachable from c3
    expect(st.behind).toBe(1); // c3 not reachable from c2
  });
});

describe('checkout dirty-tree guard (§3.3)', () => {
  it('refuses to discard staged/unstaged changes on branch switch', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');
    await adapter.branch(repo, 'exp/new-method');

    await adapter.writeFile(repo, 'project.clproj', '{"edited":true}');
    await expect(adapter.checkout(repo, 'exp/new-method')).rejects.toThrow(
      /uncommitted changes would be lost[\s\S]*project\.clproj/,
    );
  });

  it('allows checkout when the tree is clean', async () => {
    const { adapter } = makeAdapter();
    const repo = nextRepo();
    await adapter.init(repo, 'standard');
    await adapter.branch(repo, 'exp/clean');
    await adapter.checkout(repo, 'exp/clean');
    const st = await adapter.status(repo);
    expect(st.currentBranch).toBe('exp/clean');
    // The working tree survived the switch (all files still readable).
    expect(await adapter.readFile(repo, '.gitignore')).toContain('.ergalics/');
  });
});
