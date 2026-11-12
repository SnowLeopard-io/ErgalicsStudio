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
  'workbench:  open <file>  touch <file>  git status|log|diff  env  reset',
  'python:     pip install <pkg>  who  time <expr>  clear (cls)',
  'any other line is executed as Python in the session interpreter',
];

/** `git status` / `git log` / `git diff` through the project git adapter. */
async function runGit(arg: string, ctx: HostCommandContext): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project) {
    ctx.append('stderr', 'git: no project open');
    return;
  }
  const tokens = splitArgs(arg);
  const sub = (tokens[0] ?? 'status').toLowerCase();
  const adapter = getGitAdapter();
  const repoPath = getProjectRepoPath(project);
  try {
    if (sub === 'status') {
      const status = await adapter.status(repoPath);
      const lines = [`branch ${status.currentBranch}${status.ahead ? ` (+${status.ahead})` : ''}${status.behind ? ` (-${status.behind})` : ''}`];
      for (const file of status.staged) lines.push(`  A  ${file}`);
      for (const file of status.unstaged) lines.push(`  M  ${file}`);
      for (const file of status.untracked) lines.push(`  ?  ${file}`);
      if (status.clean) lines.push('working tree clean');
      ctx.append('info', lines.join('\n'));
      return;
    }
    if (sub === 'log') {
      const commits = await adapter.log(repoPath, { limit: Number(tokens[1] ?? '10') });
      if (!commits.length) {
        ctx.append('info', 'no commits yet');
        return;
      }
      const lines = commits.map(
        (c) => `  ${c.shortHash} ${new Date(c.timestamp).toLocaleString()} ${c.author.name} — ${c.message.split('\n')[0]}`,
      );
      ctx.append('info', lines.join('\n'));
      return;
    }
    if (sub === 'diff') {
      const diffs = await adapter.diff(repoPath, {});
      if (!diffs.length) {
        ctx.append('info', 'no changes');
        return;
      }
      const lines = diffs.map((d) => `  ${d.filePath}  +${d.additions} -${d.deletions}`);
      ctx.append('info', lines.join('\n'));
      return;
    }
    ctx.append('stderr', `git: unknown subcommand '${sub}' (status | log | diff)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.append('stderr', `git: ${message}`);
  }
}
