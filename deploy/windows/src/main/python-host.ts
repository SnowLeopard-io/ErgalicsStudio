// ==========================================================================
// Real CPython session host (desktop "Python family bucket").
// ==========================================================================
// Spawns a persistent CPython child per session speaking newline-delimited
// JSON over stdio. The renderer-side client mirrors the PyodideClient
// contract (runPython / repl / interrupt / dispose), so code mode can swap
// runtimes without touching its call sites.
//
// Python search order: bundled portable environment (resources/python) →
// system interpreter on PATH. Interrupt = kill + respawn (same semantics as
// the Pyodide worker interrupt: a fresh interpreter).

import { app, type App } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunRequest {
  sessionId: string;
  code: string;
  files?: Record<string, string>;
  params?: Record<string, unknown>;
  loadPackages?: string[];
}

interface Session {
  id: string;
  child: ChildProcess | null;
  dead: boolean;
  buffer: string;
  pending: ((line: Record<string, unknown>) => void)[];
}

type Broadcaster = (payload: Record<string, unknown>) => void;

function findPythonExecutable(app: App): { exe: string; portable: boolean } {
  // Windows bundles python.exe at the portable root; Unix portable layouts
  // conventionally use bin/python3 (or bin/python). Keep the Windows search
  // order first so the existing installer behaviour is unchanged.
  const names = process.platform === 'win32'
    ? ['python.exe']
    : ['bin/python3', 'bin/python', 'python3', 'python'];
  const roots = [
    path.join(process.resourcesPath ?? '', 'resources', 'python'),
    path.join(app.getAppPath(), 'resources', 'python'),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) return { exe: candidate, portable: true };
    }
  }
  return { exe: process.platform === 'win32' ? 'python' : 'python3', portable: false };
}

function findRunnerPath(app: App): string {
  // Packaged: extraResources copies desktop/resources → <resources>/resources.
  const packed = path.join(process.resourcesPath ?? '', 'resources', RUNNER);
  if (fs.existsSync(packed)) return packed;
  return path.join(app.getAppPath(), 'resources', RUNNER);
}

const RUNNER = 'ergalics-python-rpc.py';

export class PythonHost {
  private broadcaster: Broadcaster = () => {};
  private readonly sessions = new Map<string, Session>();
  private readonly exeInfo: { exe: string; portable: boolean };

  constructor(app: App) {
    this.exeInfo = findPythonExecutable(app);
  }

  attachBroadcaster(fn: Broadcaster): void {
    this.broadcaster = fn;
  }

  status(): { available: boolean; pythonPath: string; portable: boolean; version?: string } {
    return { available: true, pythonPath: this.exeInfo.exe, portable: this.exeInfo.portable };
  }

  sessionStart(): { sessionId: string } {
    const id = `py-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(id, { id, child: null, dead: false, buffer: '', pending: [] });
    return { sessionId: id };
  }

  private async spawnChild(session: Session): Promise<ChildProcess> {
    const runnerPath = findRunnerPath(app);
    const child = spawn(this.exeInfo.exe, ['-X', 'utf8', runnerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    session.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      session.buffer += chunk;
      let idx: number;
      while ((idx = session.buffer.indexOf('\n')) >= 0) {
        const line = session.buffer.slice(0, idx).trim();
        session.buffer = session.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          this.routeMessage(session, msg);
        } catch {
          this.broadcaster({ sessionId: session.id, type: 'stderr', text: line });
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      // Interpreter-level errors (not captured stdout redirection).
      if (chunk.trim()) this.broadcaster({ sessionId: session.id, type: 'stderr', text: chunk });
    });

    child.on('exit', () => {
      session.child = null;
      session.dead = true;
      for (const p of session.pending.splice(0)) p({ type: 'result', ok: false, error: 'python process exited', durationMs: 0, variables: {} });
    });

    // Wait for the runner handshake.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('python runner handshake timeout')), 15_000);
      session.pending.push((msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return child;
  }

  private routeMessage(session: Session, msg: Record<string, unknown>): void {
    if (msg.type === 'stdout' || msg.type === 'stderr') {
      this.broadcaster({ sessionId: session.id, ...msg });
      return;
    }
    // Result messages resolve the first pending waiter (runs are serialized).
    const waiter = session.pending.shift();
    if (waiter) waiter(msg);
  }

  private async ensureChild(session: Session): Promise<ChildProcess> {
    if (session.dead || !session.child) {
      session.dead = false;
      await this.spawnChild(session);
    }
    return session.child as ChildProcess;
  }

  private send(child: ChildProcess, msg: Record<string, unknown>): void {
    child.stdin?.write(JSON.stringify(msg) + '\n');
  }

  async run(req: RunRequest): Promise<Record<string, unknown>> {
    const session = this.sessions.get(req.sessionId);
    if (!session) throw new Error('unknown python session');
    const child = await this.ensureChild(session);
    this.send(child, {
      op: 'run',
      code: req.code,
      files: req.files ?? {},
      params: req.params ?? {},
      packages: req.loadPackages ?? [],
    });
    return this.awaitResult(session);
  }

  async repl(sessionId: string, code: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('unknown python session');
    const child = await this.ensureChild(session);
    this.send(child, { op: 'repl', code });
    return this.awaitResult(session);
  }

  private awaitResult(session: Session): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('python run timed out')), 10 * 60_000);
      session.pending.push((msg) => {
        clearTimeout(timer);
        if (msg.type === 'result') resolve(msg);
        else reject(new Error(String(msg.error ?? 'unexpected runner message')));
      });
    });
  }

  interrupt(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.child) return;
    // Windows has no cross-process SIGINT we can rely on; the client contract
    // (fresh interpreter after interrupt) makes kill+respawn equivalent.
    session.child.kill();
  }

  sessionEnd(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.child?.kill();
    this.sessions.delete(sessionId);
  }
}

// Keep `app` import referenced for the dev-layout branch.
void app;
