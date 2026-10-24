// ==========================================================================
// Ergalics Studio — in-memory Vfs (tests / non-browser environments)
//
// Mirrors LightningVfs semantics (missing readDir → [], auto-parents on
// write, recursive tree delete/copy) over a flat path → bytes map, so unit
// tests can exercise workspace consumers without IndexedDB.
// ==========================================================================

import type { Vfs, VfsEntry } from './types';
import { safeVfsDirPath } from './path';

export class MemoryVfs implements Vfs {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>();

  /** `root` scopes seeded paths (defaults to filesystem root) so tests can
   *  seed a workspace subtree that matches the consumer's root argument. */
  constructor(seed?: Record<string, string | Uint8Array>, root = '/') {
    if (seed) {
      for (const [path, content] of Object.entries(seed)) {
        if (typeof content === 'string') {
          void this.writeFile(root, path, content);
        } else {
          void this.writeFileBinary(root, path, content);
        }
      }
    }
  }

  private async addDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      this.dirs.add(current);
    }
  }

  async readFile(root: string, filePath: string): Promise<string> {
    const data = this.files.get(this.key(root, filePath));
    if (!data) throw new Error(`ENOENT: ${filePath}`);
    return new TextDecoder().decode(data);
  }

  async readFileBinary(root: string, filePath: string): Promise<Uint8Array> {
    const data = this.files.get(this.key(root, filePath));
    if (!data) throw new Error(`ENOENT: ${filePath}`);
    return data;
  }

  async writeFile(root: string, filePath: string, content: string): Promise<void> {
    await this.writeFileBinary(root, filePath, new TextEncoder().encode(content));
  }

  async writeFileBinary(root: string, filePath: string, data: Uint8Array): Promise<void> {
    const key = this.key(root, filePath);
    await this.addDir(key.substring(0, key.lastIndexOf('/')));
    this.files.set(key, data);
  }

  async deleteEntry(root: string, targetPath: string, isDir: boolean): Promise<void> {
    const key = this.key(root, targetPath);
    if (isDir) {
      const prefix = key.endsWith('/') ? key : `${key}/`;
      for (const path of [...this.files.keys()]) {
        if (path.startsWith(prefix)) this.files.delete(path);
      }
      for (const path of [...this.dirs]) {
        if (path === key || path.startsWith(prefix)) this.dirs.delete(path);
      }
    } else {
      this.files.delete(key);
    }
  }

  async deleteRoot(root: string): Promise<void> {
    const prefix = `${this.key(root, '')}/`;
    for (const path of [...this.files.keys()]) {
      if (path.startsWith(prefix)) this.files.delete(path);
    }
    for (const path of [...this.dirs]) {
      if (path.startsWith(prefix)) this.dirs.delete(path);
    }
  }

  async renameEntry(root: string, from: string, to: string): Promise<void> {
    const fromKey = this.key(root, from);
    const toKey = this.key(root, to);
    if (this.dirs.has(fromKey)) {
      const prefix = `${fromKey}/`;
      const moved: Array<[string, Uint8Array]> = [];
      for (const [path, data] of this.files) {
        if (path.startsWith(prefix)) moved.push([path, data]);
      }
      for (const [path, data] of moved) {
        this.files.delete(path);
        this.files.set(`${toKey}/${path.slice(prefix.length)}`, data);
      }
      await this.addDir(toKey);
      for (const path of [...this.dirs]) {
        if (path.startsWith(prefix)) this.dirs.delete(path);
      }
      this.dirs.delete(fromKey);
      return;
    }
    const data = this.files.get(fromKey);
    if (!data) throw new Error(`ENOENT: ${from}`);
    this.files.delete(fromKey);
    await this.writeFileBinary(root, to, data);
  }

  async readDir(root: string, dirPath: string): Promise<VfsEntry[]> {
    const base = this.key(root, dirPath);
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const names = new Map<string, boolean>(); // name → isDir
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) names.set(rest, false);
      else names.set(rest.slice(0, slash), true);
    }
    for (const path of this.dirs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      names.set(slash < 0 ? rest : rest.slice(0, slash), true);
    }
    const entries: VfsEntry[] = [...names].map(([name, isDir]) => ({
      name,
      path: dirPath ? `${dirPath}/${name}` : name,
      isDir,
      size: 0,
    }));
    return entries.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async exists(root: string, targetPath: string): Promise<boolean> {
    let key: string;
    try {
      key = this.key(root, targetPath);
    } catch {
      return false; // invalid path — treat like a missing file (LightningVfs parity)
    }
    return this.files.has(key) || this.dirs.has(key);
  }

  /** Normalize a (root, relPath) pair to the flat map key. Both segments are
   *  split-and-rejoined so root='/' and empty relPaths never double-slash.
   *  Guarded by the shared Vfs path guard, so '..'/absolute/NUL paths throw
   *  exactly like LightningVfs (one semantics across adapters). */
  private key(root: string, relPath: string): string {
    const rel = safeVfsDirPath(relPath);
    const segs = [...root.split('/'), ...rel.split('/')].filter(Boolean);
    return `/${segs.join('/')}`;
  }
}
