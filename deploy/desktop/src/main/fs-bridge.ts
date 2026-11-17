// ==========================================================================
// Filesystem bridge — dialogs + guarded file operations.
// ==========================================================================
// Every path-based operation must resolve inside a *registered root*. Roots
// are registered when the user picks a directory/file through a native
// dialog (user consent) or explicitly via fs:registerRoot. This blocks
// arbitrary-path reads/writes from a compromised renderer.

import { app, dialog, shell, type App } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface SaveDialogOpts {
  title?: string;
  defaultName?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogOpts {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  multi?: boolean;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

export interface FsBridge {
  pickDirectory(title: string): Promise<string | null>;
  pickFileSave(opts: SaveDialogOpts): Promise<string | null>;
  pickFileOpen(opts: OpenDialogOpts): Promise<string[] | null>;
  registerRoot(root: string): void;
  isWithinRoots(p: string): boolean;
  readFile(p: string, encoding: string): Promise<string | Uint8Array>;
  writeFile(p: string, data: unknown): Promise<void>;
  stat(p: string): Promise<{ isFile: boolean; isDir: boolean; size: number; mtime: number }>;
  readDir(p: string): Promise<DirEntry[]>;
  ensureDir(p: string): Promise<void>;
  delete(p: string, isDir: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  revealInShell(p: string): Promise<void>;
}

export function createFsBridge(app: App): FsBridge {
  const roots = new Set<string>();

  function registerRoot(root: string): void {
    if (typeof root === 'string' && root.length > 2) roots.add(path.resolve(root));
  }

  function guard(p: string): string {
    const abs = path.resolve(p);
    for (const root of roots) {
      if (abs === root || abs.startsWith(root + path.sep)) return abs;
    }
    throw new Error(`path outside registered roots: ${p}`);
  }

  const bridge: FsBridge = {
    async pickDirectory(title: string) {
      const r = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || r.filePaths.length === 0) return null;
      registerRoot(r.filePaths[0]);
      return r.filePaths[0];
    },

    async pickFileSave(opts) {
      const r = await dialog.showSaveDialog({
        title: opts.title ?? 'Save',
        defaultPath: opts.defaultName,
        filters: opts.filters,
      });
      if (r.canceled || !r.filePath) return null;
      const abs = path.resolve(r.filePath);
      registerRoot(path.dirname(abs));
      return abs;
    },

    async pickFileOpen(opts) {
      const r = await dialog.showOpenDialog({
        title: opts.title ?? 'Open',
        filters: opts.filters,
        properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      });
      if (r.canceled || r.filePaths.length === 0) return null;
      for (const p of r.filePaths) registerRoot(path.dirname(p));
      return r.filePaths;
    },

    registerRoot,
    isWithinRoots(p: string): boolean {
      try { guard(p); return true; } catch { return false; }
    },

    async readFile(p, encoding) {
      const abs = guard(p);
      if (encoding === 'binary') {
        const buf = await fsp.readFile(abs);
        return new Uint8Array(buf);
      }
      return fsp.readFile(abs, 'utf8');
    },

    async writeFile(p, data) {
      const abs = guard(p);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      if (data instanceof Uint8Array) await fsp.writeFile(abs, Buffer.from(data));
      else if (typeof data === 'string') await fsp.writeFile(abs, data, 'utf8');
      else if (data instanceof ArrayBuffer || Array.isArray(data)) await fsp.writeFile(abs, Buffer.from(data as ArrayBuffer));
      else throw new Error('unsupported write payload');
    },

    async stat(p) {
      const s = await fsp.stat(guard(p));
      return { isFile: s.isFile(), isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
    },

    async readDir(p) {
      const abs = guard(p);
      const names = await fsp.readdir(abs);
      const out: DirEntry[] = [];
      for (const name of names) {
        try {
          const s = await fsp.stat(path.join(abs, name));
          out.push({ name, isDir: s.isDirectory(), size: s.size });
        } catch {
          out.push({ name, isDir: false, size: 0 });
        }
      }
      return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    },

    async ensureDir(p) {
      await fsp.mkdir(guard(p), { recursive: true });
    },

    async delete(p, isDir) {
      const abs = guard(p);
      if (isDir) await fsp.rm(abs, { recursive: true, force: true });
      else await fsp.unlink(abs);
    },

    async rename(from, to) {
      await fsp.rename(guard(from), guard(to));
    },

    async exists(p) {
      try { await fsp.access(guard(p)); return true; } catch { return false; }
    },

    async revealInShell(p) {
      const abs = guard(p);
      const s = await fsp.stat(abs).catch(() => null);
      if (s?.isDirectory()) void shell.openPath(abs);
      else void shell.showItemInFolder(abs);
    },
  };

  // Seed a benign default root so simple flows work without a dialog first.
  registerRoot(path.join(app.getPath('documents'), 'ErgalicsStudio'));
  return bridge;
}
