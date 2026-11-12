// ==========================================================================
// Ergalics Studio — terminal host commands (workbench-side actions)
//
// These commands do not run in the interpreter: they act on the project and
// the workbench, so the terminal is a real bridge between the shell-like
// surface and the IDE:
//
//   open <file>     open a project file in the editor / preview
//   touch <file>    create an empty file in the project
//   reset           restart the Python interpreter (fresh namespace)
//   pip install X   install a Pyodide wheel into the live interpreter
//   env             interpreter + workspace status
//   git status|log|diff   project git through the git adapter
//   help            list the available commands
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getGitAdapter } from '@/core/git';
import {
  installPythonPackages,
  mountWorkspaceFiles,
  warmPythonRuntime,
} from '@/core/pyodide/code-runtime';
import { openWorkspaceFile, toProjectPath } from '@/core/workspace/open-file';
import { projectFileExists, writeProjectFile } from '@/core/workspace/project-files';
import { splitArgs, type ReplCommand } from '@/core/pyodide/repl-commands';

export interface HostCommandContext {
  /** Append a line to the calling terminal session. */
  append: (stream: 'stdout' | 'stderr' | 'info', text: string) => void;
  /** Interpreter cwd (the prompt path). */
  cwd: string;
  /** Run a Python snippet in the session interpreter and capture its output. */
  runPython?: (code: string) => Promise<{ out: string; err: string }>;
}

/** Run a host command; returns true when the command was handled here. */
export async function runHostCommand(
  cmd: ReplCommand,
  ctx: HostCommandContext,
): Promise<boolean> {
  switch (cmd.magic) {
    case 'open': {
      if (!cmd.arg) {
        ctx.append('stderr', 'open: missing file argument');
        return true;
      }
      // Reveal the file in the explorer as well — the terminal should feel
      // connected to the workbench, not a separate world. (setSidebarView
      // toggles the sidebar when it is already on that view, so only call it
      // when the explorer is not already showing files.)
      const app = useAppStore.getState();
      if (app.sidebarView !== 'files' || !app.sidebarOpen) app.setSidebarView('files');
      ctx.append('info', await openWorkspaceFile(cmd.arg));
      return true;
    }
    case 'touch': {
      if (!cmd.arg) {
        ctx.append('stderr', 'touch: missing file argument');
        return true;
      }
      const rel = toProjectPath(cmd.arg);
      if (!useProjectStore.getState().project) {
        ctx.append('stderr', 'touch: no project open');
        return true;
      }
      try {
        if (await projectFileExists(rel)) {
          ctx.append('info', `touch: ${rel} already exists`);
          return true;
        }
        await writeProjectFile(rel, '');
        useAppStore.getState().bumpFileOps();
        ctx.append('info', `created ${rel}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.append('stderr', `touch: ${message}`);
      }
      return true;
    }
    case 'reset': {
      ctx.append('info', 'reset: restarting the Python interpreter…');
      await warmPythonRuntime({ restart: true, silent: true });
      await mountWorkspaceFiles();
      ctx.append('info', 'reset: interpreter restarted');
      return true;
    }
    case 'pip': {
      const tokens = splitArgs(cmd.arg);
      if (tokens[0] === 'list') {
        const { out, err } = (await ctx.runPython?.(
          `import sys\nprint('\\n'.join(sorted(m for m in sys.modules if not m.startswith('_'))))`,
        )) ?? { out: '', err: 'interpreter not ready' };
        if (out) ctx.append('info', out);
        if (err) ctx.append('stderr', err);
        return true;
      }
      const packages = tokens.filter((x) => x && x !== 'install');
      if (!packages.length) {
        ctx.append('stderr', 'pip: usage — pip install <package> | pip list');
        return true;
      }
      const result = await installPythonPackages(packages);
      if (result.ok) {
        ctx.append('info', `installed ${result.loaded.join(', ')}`);
      } else {
        ctx.append('stderr', `pip: ${result.error ?? 'install failed'}`);
      }
      return true;
    }
    case 'env': {
      ctx.append('info', `cwd      ${ctx.cwd}`);
      const project = useProjectStore.getState().project;
      ctx.append('info', `project  ${project ? (project.name ?? project.id) : '(none)'}`);
      const { out } = (await ctx.runPython?.(
        `import sys\nprint('python   ' + sys.version.split()[0] + ' (Pyodide, in-browser)')`,
      )) ?? { out: '' };
      if (out) ctx.append('info', out.trim());
      ctx.append('info', 'packages numpy (+ pip install <pkg> for more)');
      return true;
    }
    case 'git': {
      await runGit(cmd.arg, ctx);
      return true;
    }
    case 'help': {
      for (const line of HELP_LINES) ctx.append('info', line);
      return true;
    }
    default:
      return false;
  }
}

/** The command overview shown by `help` (kept in English on purpose: these
 *  are shell-ish names, and the surrounding UI is translated). */
const HELP_LINES = [
  'workspace:  pwd  cd <dir>  ls [dir]  tree [dir]  find <name>  cat <file>',
  '            head/tail <file> [n]  grep <pattern> [file]  wc <file>',
  'run:        python <file.py>  node <file.js>  rscript <file.R>  run <file>',
  'workbench:  open <file>  touch <file>  env  reset',
  'git:        status  log [n]  diff  add <files|.>  commit -m "msg"',
  '            branch [name]  checkout [-b] <ref>  remote  push|pull [remote]',
  'python:     pip install <pkg>  who  time <expr>  clear (cls)',
  'any other line is executed as Python in the session interpreter',
];

const GIT_SUBCOMMANDS = 'status | log | diff | add | commit | branch | checkout | remote | push | pull | init';

/** Refresh the Git panel + file explorer after a mutation. */
function refreshGitViews(withLog = false): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  void useProjectStore.getState().refreshGitStatus();
  // A commit/checkout moves history or swaps worktree files: the change tree
  // (and log) must re-read, and the explorer re-lists on checkout.
  if (withLog) void useProjectStore.getState().loadGitLog();
  if (useAppStore.getState().sidebarView === 'files') useAppStore.getState().bumpFileOps();
}

/** `git status` / `git log` / `git diff` / `git add` / `git commit` / …
 *  through the project git adapter — the same one the Git panel uses. */
async function runGit(arg: string, ctx: HostCommandContext): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project) {
    ctx.append('stderr', 'git: no project open');
    return;
  }
  const tokens = splitArgs(arg);
  const sub = (tokens[0] ?? 'status').toLowerCase();
  const rest = tokens.slice(1);
  const adapter = getGitAdapter();
  const repoPath = getProjectRepoPath(project);
  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    ctx.append('stderr', `git: ${message}`);
  };
  try {
    switch (sub) {
      case 'status': {
        const status = await adapter.status(repoPath);
        const lines = [
          `branch ${status.currentBranch}${status.ahead ? ` (+${status.ahead})` : ''}${status.behind ? ` (-${status.behind})` : ''}`,
        ];
        for (const file of status.staged) lines.push(`  A  ${file}`);
        for (const file of status.unstaged) lines.push(`  M  ${file}`);
        for (const file of status.untracked) lines.push(`  ?  ${file}`);
        if (status.clean) lines.push('working tree clean');
        ctx.append('info', lines.join('\n'));
        return;
      }
      case 'log': {
        const commits = await adapter.log(repoPath, { limit: Number(rest[0] ?? '10') || 10 });
        if (!commits.length) {
          ctx.append('info', 'no commits yet');
          return;
        }
        const lines = commits.map(
          (c) =>
            `  ${c.shortHash} ${new Date(c.timestamp).toLocaleString()} ${c.author.name} — ${c.message.split('\n')[0]}`,
        );
        ctx.append('info', lines.join('\n'));
        return;
      }
      case 'diff': {
        const diffs = await adapter.diff(repoPath, {});
        if (!diffs.length) {
          ctx.append('info', 'no changes');
          return;
        }
        const lines = diffs.map((d) => `  ${d.filePath}  +${d.additions} -${d.deletions}`);
        ctx.append('info', lines.join('\n'));
        return;
      }
      case 'add': {
        const files = await addFileList(adapter, repoPath, rest);
        if (!files.length) {
          ctx.append('stderr', 'git add: nothing to add (working tree clean)');
          return;
        }
        await adapter.add(repoPath, files);
        refreshGitViews();
        ctx.append('info', `staged ${files.length} file(s)`);
        return;
      }
      case 'reset': {
        // `git reset` (no args) unstages everything; with paths it unstages
        // just those entries — mirroring the index-only semantics of git.
        const files = rest.length ? rest : await changedFiles(adapter, repoPath);
        if (!files.length) {
          ctx.append('info', 'git reset: index is empty');
          return;
        }
        await adapter.resetIndex(repoPath, files);
        refreshGitViews();
        ctx.append('info', `unstaged ${files.length} file(s)`);
        return;
      }
      case 'commit': {
        const mFlag = rest.findIndex((t) => t === '-m' || t === '--message');
        const message = mFlag >= 0 ? rest[mFlag + 1] : undefined;
        if (!message) {
          ctx.append('stderr', 'git commit: usage — commit -m "message"');
          return;
        }
        const status = await adapter.status(repoPath);
        if (status.clean) {
          ctx.append('info', 'nothing to commit, working tree clean');
          return;
        }
        const hash = await adapter.commit(repoPath, message);
        refreshGitViews(true);
        ctx.append('info', `[${status.currentBranch} ${hash.slice(0, 7)}] ${message}`);
        return;
      }
      case 'branch': {
        if (rest[0]) {
          await adapter.branch(repoPath, rest[0]);
          refreshGitViews();
          ctx.append('info', `created branch ${rest[0]}`);
        } else {
          const list = await adapter.branches(repoPath);
          if (!list.length) {
            ctx.append('info', 'no branches');
            return;
          }
          ctx.append(
            'info',
            list.map((b) => `${b.current ? '* ' : '  '}${b.name}${b.upstream ? ` → ${b.upstream}` : ''}`).join('\n'),
          );
        }
        return;
      }
      case 'checkout': {
        const create = rest.includes('-b');
        const refs = rest.filter((t) => t !== '-b');
        const ref = refs[0];
        if (!ref) {
          ctx.append('stderr', 'git checkout: usage — checkout <ref> | checkout -b <new-branch>');
          return;
        }
        await adapter.checkout(repoPath, ref, create);
        refreshGitViews(true);
        ctx.append('info', `switched to ${ref}`);
        return;
      }
      case 'remote': {
        const remotes = await adapter.remotes(repoPath);
        if (!remotes.length) {
          ctx.append('info', 'no remotes (configure one in the Git panel)');
          return;
        }
        ctx.append('info', remotes.map((r) => `${r.name}\t${r.url}`).join('\n'));
        return;
      }
      case 'push':
      case 'pull': {
        const status = await adapter.status(repoPath);
        const remote = rest[0] ?? 'origin';
        const remotes = await adapter.remotes(repoPath);
        if (!remotes.some((r) => r.name === remote)) {
          ctx.append('stderr', `git ${sub}: no remote '${remote}' (git remote to list)`);
          return;
        }
        const branch = rest[1] ?? status.currentBranch;
        ctx.append('info', `git ${sub}: ${remote}/${branch} …`);
        if (sub === 'push') {
          await adapter.push(repoPath, { remote, branch, setUpstream: true });
        } else {
          await adapter.pull(repoPath, { remote, branch });
        }
        refreshGitViews(true);
        ctx.append('info', `git ${sub}: done`);
        return;
      }
      case 'init': {
        if (await adapter.isRepo(repoPath)) {
          ctx.append('info', 'git init: already a repository');
          return;
        }
        await adapter.init(repoPath, 'standard');
        refreshGitViews();
        ctx.append('info', 'initialized empty git repository');
        return;
      }
      default:
        ctx.append('stderr', `git: unknown subcommand '${sub}' (${GIT_SUBCOMMANDS})`);
    }
  } catch (err) {
    fail(err);
  }
}

/** Files to stage for `git add <files…> | . | -A`: explicit paths win, the
 *  all-shorthands expand to every worktree change (mirrors `git add -A`). */
async function addFileList(
  adapter: ReturnType<typeof getGitAdapter>,
  repoPath: string,
  rest: string[],
): Promise<string[]> {
  if (rest.length && !rest.includes('.') && !rest.includes('-A') && !rest.includes('--all')) {
    return rest;
  }
  return changedFiles(adapter, repoPath);
}

/** Every path with worktree or index changes (the add/reset universe). */
async function changedFiles(
  adapter: ReturnType<typeof getGitAdapter>,
  repoPath: string,
): Promise<string[]> {
  const status = await adapter.status(repoPath);
  return [...new Set([...status.staged, ...status.unstaged, ...status.untracked])];
}
