// ==========================================================================
// Preload — typed, whitelisted bridge exposed as window.ergalicsDesktop.
// ==========================================================================
// sandbox:true keeps the preload minimal; every exposed function maps to one
// whitelisted IPC channel and nothing else.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api = {
  appInfo: () => ipcRenderer.invoke('app:info'),

  fs: {
    pickDirectory: (title: string) => ipcRenderer.invoke('fs:pickDirectory', title),
    pickFileSave: (opts: unknown) => ipcRenderer.invoke('fs:pickFileSave', opts),
    pickFileOpen: (opts: unknown) => ipcRenderer.invoke('fs:pickFileOpen', opts),
    registerRoot: (root: string) => ipcRenderer.invoke('fs:registerRoot', root),
    readFile: (path: string, encoding: 'utf8' | 'binary' = 'utf8') =>
      ipcRenderer.invoke('fs:readFile', path, encoding),
    writeFile: (path: string, data: unknown) => ipcRenderer.invoke('fs:writeFile', path, data),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    ensureDir: (path: string) => ipcRenderer.invoke('fs:ensureDir', path),
    delete: (path: string, isDir: boolean) => ipcRenderer.invoke('fs:delete', path, isDir),
    rename: (from: string, to: string) => ipcRenderer.invoke('fs:rename', from, to),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    revealInShell: (path: string) => ipcRenderer.invoke('fs:revealInShell', path),
  },

  git: {
    invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('git:invoke', method, args),
  },

  python: {
    status: () => ipcRenderer.invoke('python:status'),
    sessionStart: () => ipcRenderer.invoke('python:sessionStart'),
    run: (msg: unknown) => ipcRenderer.invoke('python:run', msg),
    repl: (sessionId: string, code: string) => ipcRenderer.invoke('python:repl', sessionId, code),
    interrupt: (sessionId: string) => ipcRenderer.invoke('python:interrupt', sessionId),
    sessionEnd: (sessionId: string) => ipcRenderer.invoke('python:sessionEnd', sessionId),
    onEvent: (cb: (payload: Record<string, unknown>) => void) => {
      const listener = (_e: IpcRendererEvent, payload: Record<string, unknown>) => cb(payload);
      ipcRenderer.on('python:event', listener);
      return () => ipcRenderer.removeListener('python:event', listener);
    },
  },

  pty: {
    start: (opts: unknown) => ipcRenderer.invoke('pty:start', opts),
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    onData: (cb: (id: string, data: string) => void) => {
      const listener = (_e: IpcRendererEvent, payload: { id: string; data: string }) =>
        cb(payload.id, payload.data);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
    onExit: (cb: (id: string, code: string) => void) => {
      const listener = (_e: IpcRendererEvent, payload: { id: string; code: string }) =>
        cb(payload.id, payload.code);
      ipcRenderer.on('pty:exit', listener);
      return () => ipcRenderer.removeListener('pty:exit', listener);
    },
  },
};

contextBridge.exposeInMainWorld('ergalicsDesktop', api);
