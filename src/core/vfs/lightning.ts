// ==========================================================================
// Ergalics Studio — LightningFS-backed Vfs (browser)
//
// Thin extraction of the pure-filesystem half of the git adapter onto the
// same IndexedDB store ('ergalics-git'), so workspaces written by older
// builds stay readable with zero migration. No isomorphic-git imports —
// this layer cannot touch repository metadata.
// ==========================================================================

import LightningFS from '@isomorphic-git/lightning-fs';
import type { Vfs, VfsEntry } from './types';
import { safeVfsDirPath, safeVfsRelPath } from './path';

// Lazy singleton: constructing LightningFS requires `indexedDB`, which does
// not exist in Node (unit tests) — so instantiate on first use, not at import.
let fsInstance: LightningFS | null = null;

function getFS(): LightningFS {
  if (!fsInstance) fsInstance = new LightningFS('ergalics-git');
  return fsInstance;
}

/**
 * Create `dirPath` segment by segment (absolute, from the fs root).
 * LightningFS `mkdir` has no `recursive` option and `writeFile` does not
 * create missing parents, so every level must be mkdir'ed explicitly.
 */
async function mkdirp(fs: LightningFS, dirPath: string): Promise<void> {
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    await fs.promises.mkdir(current, undefined).catch(() => {
      /* already exists */
    });
  }
}

export class LightningVfs implements Vfs {
  /** Injection point for tests / alternative stores. */
  constructor(private readonly fsOverride?: LightningFS) {}

  private getFS(): LightningFS {
    return this.fsOverride ?? getFS();
  }

  async readFile(root: string, filePath: string): Promise<string> {
    const rel = safeVfsRelPath(filePath);
    const data = await this.getFS().promises.readFile(`${root}/${rel}`);
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  }

  async readFileBinary(root: string, filePath: string): Promise<Uint8Array> {
    const rel = safeVfsRelPath(filePath);
    const data = await this.getFS().promises.readFile(`${root}/${rel}`);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    return data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
  }

  async writeFile(root: string, filePath: string, content: string): Promise<void> {
    const rel = safeVfsRelPath(filePath);
    const fs = this.getFS();
    const fullPath = `${root}/${rel}`;
    await mkdirp(fs, fullPath.substring(0, fullPath.lastIndexOf('/')));
    await fs.promises.writeFile(fullPath, content);
  }

  async writeFileBinary(root: string, filePath: string, data: Uint8Array): Promise<void> {
    const rel = safeVfsRelPath(filePath);
    const fs = this.getFS();
    const fullPath = `${root}/${rel}`;
    await mkdirp(fs, fullPath.substring(0, fullPath.lastIndexOf('/')));
    await fs.promises.writeFile(fullPath, data);
  }

  /** Recursively unlink every file under `dir` then remove the empty dir
   *  (LightningFS `rmdir` only removes empty directories). */
  private async removeTree(fs: LightningFS, dir: string): Promise<void> {
    let names: string[];
    try {
      names = (await fs.promises.readdir(dir)) as string[];
    } catch {
      return; // Already gone — nothing to do.
    }
    for (const name of names) {
      const child = `${dir}/${name}`;
      const st = (await fs.promises.stat(child)) as { isDirectory(): boolean };
      if (st.isDirectory()) {
        await this.removeTree(fs, child);
      } else {
        await fs.promises.unlink(child);
      }
    }
    await fs.promises.rmdir(dir).catch(() => {});
  }

  /** Recursively copy a directory tree (LightningFS has no rename/copyFile). */
  private async copyTree(fs: LightningFS, fromDir: string, toDir: string): Promise<void> {
    await mkdirp(fs, toDir);
    const names = (await fs.promises.readdir(fromDir)) as string[];
    for (const name of names) {
      const fromChild = `${fromDir}/${name}`;
      const toChild = `${toDir}/${name}`;
      const st = (await fs.promises.stat(fromChild)) as { isDirectory(): boolean };
      if (st.isDirectory()) {
        await this.copyTree(fs, fromChild, toChild);
      } else {
        const data = (await fs.promises.readFile(fromChild)) as Uint8Array | string;
        await fs.promises.writeFile(toChild, data);
      }
    }
  }

  private async isDirectory(root: string, targetPath: string): Promise<boolean> {
    try {
      const rel = safeVfsRelPath(targetPath);
      const st = (await this.getFS().promises.stat(`${root}/${rel}`)) as {
        isDirectory(): boolean;
      };
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  async deleteEntry(root: string, targetPath: string, isDir: boolean): Promise<void> {
    const fs = this.getFS();
    const full = `${root}/${safeVfsRelPath(targetPath)}`;
    if (isDir) {
      await this.removeTree(fs, full);
    } else {
      await fs.promises.unlink(full);
    }
  }

  /** Remove the whole per-project workspace (including the .git object
   *  store) — project deletion must not leave the tree orphaned in the
   *  shared IndexedDB-backed filesystem. */
  async deleteRoot(root: string): Promise<void> {
    await this.removeTree(this.getFS(), root);
  }

  async renameEntry(root: string, from: string, to: string): Promise<void> {
    const fs = this.getFS();
    const fromFull = `${root}/${safeVfsRelPath(from, 'rename source')}`;
    const toFull = `${root}/${safeVfsRelPath(to, 'rename target')}`;
    await mkdirp(fs, toFull.substring(0, toFull.lastIndexOf('/')));
    if (await this.isDirectory(root, from)) {
      await this.copyTree(fs, fromFull, toFull);
      await this.removeTree(fs, fromFull);
    } else {
      const data = (await fs.promises.readFile(fromFull)) as Uint8Array | string;
      await fs.promises.writeFile(toFull, data);
      await fs.promises.unlink(fromFull);
    }
  }

  /** LightningFS readdir yields bare names — stat each child for the
   *  dir/file split. N+1 stats are fine: explorer listings are small and
   *  lazy per directory. */
  async readDir(root: string, dirPath: string): Promise<VfsEntry[]> {
    const fs = this.getFS();
    const rel = safeVfsDirPath(dirPath);
    const full = rel ? `${root}/${rel}` : root;
    let names: string[];
    try {
      names = (await fs.promises.readdir(full)) as string[];
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names.map(async (name) => {
        const path = rel ? `${rel}/${name}` : name;
        try {
          const st = (await fs.promises.stat(`${full}/${name}`)) as {
            isDirectory(): boolean;
            size?: number;
          };
          return { name, path, isDir: st.isDirectory(), size: st.size ?? 0 } satisfies VfsEntry;
        } catch {
          return { name, path, isDir: false, size: 0 } satisfies VfsEntry;
        }
      }),
    );
    return entries.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async exists(root: string, targetPath: string): Promise<boolean> {
    try {
      const rel = safeVfsRelPath(targetPath);
      await this.getFS().promises.stat(`${root}/${rel}`);
      return true;
    } catch {
      return false;
    }
  }
}
