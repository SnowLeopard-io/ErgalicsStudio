// ==========================================================================
// Terminal host — PTY sessions for the embedded terminal.
// ==========================================================================
// Primary implementation uses node-pty (VS Code's native PTY) when the
// optional dependency is present; the fallback is a plain child_process pipe
// (full interactivity lost, but commands still run and stream).
//
// ShellProvider is the cross-platform seam: Windows ships PowerShell/cmd
// providers; a Linux/WSL provider only needs to implement the same two
// functions and the renderer/IPC contract stays untouched.

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

export interface PtyStartOpts {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface ShellProvider {
  name: string;
  detect(): Promise<boolean>;
  /** Command + args to launch the shell; env carries injected tool paths. */
  build(cwd?: string): { file: string; args: string[]; env: Record<string, string> };
}

const powershellProvider: ShellProvider = {
  name: 'powershell',
  async detect() {
    return process.platform === 'win32';
  },
  build(cwd) {
    // Force UTF-8 on both console streams — default GBK codepage renders CJK
    // output as mojibake in the UTF-8-expecting xterm frontend.
    const init =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
      '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; ' +
      (cwd ? `Set-Location -LiteralPath "${cwd}"; ` : '');
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', init],
      env: buildPythonEnv(cwd),
    };
  },
};

const cmdProvider: ShellProvider = {
  name: 'cmd',
  async detect() {
    return process.platform === 'win32';
  },
  build(cwd) {
    return {
      file: 'cmd.exe',
      // chcp 65001 switches the console to UTF-8 before anything prints.
      args: ['/K', 'chcp 65001 >nul' + (cwd ? ` & cd /d "${cwd}"` : '')],
      env: buildPythonEnv(cwd),
    };
  },
};

/**
 * Put the bundled portable Python (if any) at the front of PATH so `python`
 * and `pip` inside the terminal point at the studio environment.
 */
function buildPythonEnv(cwd?: string): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    const root = pathMod.join(process.resourcesPath ?? '', 'resources', 'python');
    const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
    const candidates = [root, pathMod.join(root, bin)].filter((p) => fsMod.existsSync(p));
    if (candidates.length > 0) {
      env.PATH = `${candidates.join(pathMod.delimiter)}${pathMod.delimiter}${env.PATH ?? ''}`;
      env.VIRTUAL_ENV = root;
    }
  } catch {
    /* stay with the inherited environment */
  }
  return env;
}

/** Unix shell: the only provider registered on Linux/macOS builds. */
const posixProvider: ShellProvider = {
  name: 'bash',
  async detect() {
    return process.platform !== 'win32';
  },
  build(cwd) {
    const shell = process.env.SHELL || '/bin/sh';
    // Re-exec the interactive shell in the requested cwd; quoting the cwd
    // keeps paths with spaces or shell metacharacters from being interpreted.
    const args = cwd ? ['-c', `cd ${JSON.stringify(cwd)} && exec ${shell}`] : [];
    return { file: shell, args, env: buildPythonEnv(cwd) };
  },
};

const PROVIDERS: ShellProvider[] = process.platform === 'win32'
  ? [powershellProvider, cmdProvider]
  : [posixProvider];

type Broadcaster = (channel: string, payload: Record<string, unknown>) => void;

/** The subset of node-pty's IPty surface this host actually uses. */
interface PtyLike {
  write: (d: string) => void;
  resize: (c: number, r: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
}

interface Term {
  id: string;
  provider: string;
  /** node-pty handle when available. */
  pty?: PtyLike;
  child?: ChildProcess;
}

export class PtyHost {
  private broadcaster: Broadcaster = () => {};
  private readonly terms = new Map<string, Term>();
  // node-pty is optional: loaded dynamically so the app never hard-fails on a
  // missing native build.
   
  private ptyModule: { spawn: (...a: unknown[]) => PtyLike } | null = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('node-pty');
    } catch {
      return null;
    }
  })();

  attachBroadcaster(fn: Broadcaster): void {
    this.broadcaster = fn;
  }

  async start(opts: PtyStartOpts): Promise<{ id: string; shellName: string; mode: 'pty' | 'pipe' }> {
    const provider = opts.shell
      ? (PROVIDERS.find((p) => p.name === opts.shell) ?? PROVIDERS[0])
      : PROVIDERS[0];
    const { file, args, env } = provider.build(opts.cwd);
    const id = `tty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const term: Term = { id, provider: provider.name };
    const onData = (data: string) => this.broadcaster('pty:data', { id, data });
    const onExit = (code: unknown) => {
      this.broadcaster('pty:exit', { id, code: String(code) });
      this.terms.delete(id);
    };

    if (this.ptyModule) {
      const pty = this.ptyModule.spawn(file, args, {
        name: 'xterm-color',
        cols: opts.cols ?? 100,
        rows: opts.rows ?? 28,
        cwd: opts.cwd,
        env,
      });
      term.pty = pty;
      pty.onData(onData);
      pty.onExit((e) => onExit(e.exitCode));
    } else {
      const child = spawn(file, args, { env, cwd: opts.cwd, shell: false });
      term.child = child;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', (code) => onExit(code));
    }
    this.terms.set(id, term);
    return { id, shellName: provider.name, mode: this.ptyModule ? 'pty' : 'pipe' };
  }

  write(id: string, data: string): void {
    const t = this.terms.get(id);
    if (!t) return;
    if (t.pty) t.pty.write(data);
    else t.child?.stdin?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.terms.get(id)?.pty?.resize(cols, rows);
  }

  kill(id: string): void {
    const t = this.terms.get(id);
    if (!t) return;
    if (t.pty) t.pty.kill();
    else t.child?.kill();
    this.terms.delete(id);
  }
}
