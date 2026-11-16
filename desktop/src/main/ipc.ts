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
  handle('fs:pickDirectory', (_e, title: string) => fsBridge.pickDirectory(title));
  handle('fs:pickFileSave', (_e, opts: unknown) => fsBridge.pickFileSave(opts as Parameters<FsBridge['pickFileSave']>[0]));
  handle('fs:pickFileOpen', (_e, opts: unknown) => fsBridge.pickFileOpen(opts as Parameters<FsBridge['pickFileOpen']>[0]));
  handle('fs:registerRoot', (_e, root: string) => fsBridge.registerRoot(root));
  handle('fs:readFile', (_e, p: string, encoding: string) => fsBridge.readFile(p, encoding));
  handle('fs:writeFile', (_e, p: string, data: unknown) => fsBridge.writeFile(p, data));
  handle('fs:stat', (_e, p: string) => fsBridge.stat(p));
  handle('fs:readDir', (_e, p: string) => fsBridge.readDir(p));
  handle('fs:ensureDir', (_e, p: string) => fsBridge.ensureDir(p));
  handle('fs:delete', (_e, p: string, isDir: boolean) => fsBridge.delete(p, isDir));
  handle('fs:rename', (_e, from: string, to: string) => fsBridge.rename(from, to));
  handle('fs:exists', (_e, p: string) => fsBridge.exists(p));
  handle('fs:revealInShell', (_e, p: string) => fsBridge.revealInShell(p));

  // --- git (simple-git bridge, whitelisted method map) ---------------------
  handle('git:invoke', (_e, method: string, args: unknown[]) => gitBridge.invoke(method, args));

  // --- real Python sessions -------------------------------------------------
  handle('python:status', () => pythonHost.status());
  handle('python:sessionStart', () => pythonHost.sessionStart());
  handle('python:run', (_e, msg: unknown) => pythonHost.run(msg as Parameters<PythonHost['run']>[0]));
  handle('python:repl', (_e, sessionId: string, code: string) => pythonHost.repl(sessionId, code));
  handle('python:interrupt', (_e, sessionId: string) => pythonHost.interrupt(sessionId));
  handle('python:sessionEnd', (_e, sessionId: string) => pythonHost.sessionEnd(sessionId));

  // --- terminal (PTY) --------------------------------------------------------
  handle('pty:start', (_e, opts: unknown) => ptyHost.start(opts as Parameters<PtyHost['start']>[0]));
  handle('pty:write', (_e, id: string, data: string) => ptyHost.write(id, data));
  handle('pty:resize', (_e, id: string, cols: number, rows: number) => ptyHost.resize(id, cols, rows));
  handle('pty:kill', (_e, id: string) => ptyHost.kill(id));

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
