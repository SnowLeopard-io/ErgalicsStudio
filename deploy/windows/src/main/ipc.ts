// ==========================================================================
// IPC surface — whitelisted invoke handlers.
// ==========================================================================
// Every native capability the renderer may reach is registered here behind an
// explicit channel name. Handlers validate arguments (paths must resolve
// inside a registered root) before touching the filesystem.

import { ipcMain, app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { createFsBridge, type FsBridge } from './fs-bridge';
import { createGitBridge, type GitBridge } from './git-bridge';
import { PythonHost } from './python-host';
import { PtyHost } from './pty-host';

let fsBridge: FsBridge;
let gitBridge: GitBridge;
let pythonHost: PythonHost;
let ptyHost: PtyHost;

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, fn);
}

// Renderer arguments cross a trust boundary: they arrive as `unknown`, so each
// handler narrows them explicitly instead of trusting a TypeScript annotation.
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`ipc: ${field} must be a string`);
  return value;
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`ipc: ${field} must be a finite number`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`ipc: ${field} must be a boolean`);
  return value;
}

function obj<T>(value: unknown, field: string): T {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`ipc: ${field} must be an object`);
  }
  return value as T;
}

function arr(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`ipc: ${field} must be an array`);
  return value;
}

export function registerIpc(): void {
  fsBridge = createFsBridge(app);
  gitBridge = createGitBridge(fsBridge);
  pythonHost = new PythonHost(app);
  ptyHost = new PtyHost();

  // --- app info -----------------------------------------------------------
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  // --- filesystem ---------------------------------------------------------
  handle('fs:pickDirectory', (_e, title) => fsBridge.pickDirectory(str(title, 'title')));
  handle('fs:pickFileSave', (_e, opts) => fsBridge.pickFileSave(obj<Parameters<FsBridge['pickFileSave']>[0]>(opts, 'opts')));
  handle('fs:pickFileOpen', (_e, opts) => fsBridge.pickFileOpen(obj<Parameters<FsBridge['pickFileOpen']>[0]>(opts, 'opts')));
  handle('fs:registerRoot', (_e, root) => fsBridge.registerRoot(str(root, 'root')));
  handle('fs:readFile', (_e, p, encoding) => fsBridge.readFile(str(p, 'path'), str(encoding, 'encoding')));
  handle('fs:writeFile', (_e, p, data) => fsBridge.writeFile(str(p, 'path'), data));
  handle('fs:stat', (_e, p) => fsBridge.stat(str(p, 'path')));
  handle('fs:readDir', (_e, p) => fsBridge.readDir(str(p, 'path')));
  handle('fs:ensureDir', (_e, p) => fsBridge.ensureDir(str(p, 'path')));
  handle('fs:delete', (_e, p, isDir) => fsBridge.delete(str(p, 'path'), bool(isDir, 'isDir')));
  handle('fs:rename', (_e, from, to) => fsBridge.rename(str(from, 'from'), str(to, 'to')));
  handle('fs:exists', (_e, p) => fsBridge.exists(str(p, 'path')));
  handle('fs:revealInShell', (_e, p) => fsBridge.revealInShell(str(p, 'path')));

  // --- git (simple-git bridge, whitelisted method map) ---------------------
  handle('git:invoke', (_e, method, args) => gitBridge.invoke(str(method, 'method'), arr(args, 'args')));

  // --- real Python sessions -------------------------------------------------
  handle('python:status', () => pythonHost.status());
  handle('python:sessionStart', () => pythonHost.sessionStart());
  handle('python:run', (_e, msg) => pythonHost.run(obj<Parameters<PythonHost['run']>[0]>(msg, 'msg')));
  handle('python:repl', (_e, sessionId, code) => pythonHost.repl(str(sessionId, 'sessionId'), str(code, 'code')));
  handle('python:interrupt', (_e, sessionId) => pythonHost.interrupt(str(sessionId, 'sessionId')));
  handle('python:sessionEnd', (_e, sessionId) => pythonHost.sessionEnd(str(sessionId, 'sessionId')));

  // --- terminal (PTY) --------------------------------------------------------
  handle('pty:start', (_e, opts) => ptyHost.start(obj<Parameters<PtyHost['start']>[0]>(opts, 'opts')));
  handle('pty:write', (_e, id, data) => ptyHost.write(str(id, 'id'), str(data, 'data')));
  handle('pty:resize', (_e, id, cols, rows) => ptyHost.resize(str(id, 'id'), num(cols, 'cols'), num(rows, 'rows')));
  handle('pty:kill', (_e, id) => ptyHost.kill(str(id, 'id')));

  ptyHost.attachBroadcaster((channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  });
  pythonHost.attachBroadcaster((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('python:event', payload);
    }
  });
}
