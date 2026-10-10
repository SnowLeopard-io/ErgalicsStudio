// ==========================================================================
// VFS path guard (issues #21/#22) — pure node, MemoryVfs shares the guard
// with LightningVfs, so adapter semantics are testable without IndexedDB.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { MemoryVfs, LightningVfs, safeVfsRelPath, safeVfsDirPath, isValidVfsEntryName, VfsPathError } from '@/core/vfs';

describe('safeVfsRelPath', () => {
  it('accepts plain relative paths and normalizes separators', () => {
    expect(safeVfsRelPath('a/b.txt')).toBe('a/b.txt');
    expect(safeVfsRelPath('runs/run-1.json')).toBe('runs/run-1.json');
    expect(safeVfsRelPath('a//b')).toBe('a/b');
    expect(safeVfsRelPath('a\\b')).toBe('a/b');
  });

  it.each([
    ['..', 'bare dotdot'],
    ['../x', 'leading traversal'],
    ['a/../b', 'mid traversal'],
    ['a/..', 'trailing traversal'],
    ['..\\x', 'backslash traversal'],
    ['/abs', 'absolute posix'],
    ['\\abs', 'absolute backslash'],
    ['C:\\x', 'drive letter'],
    ['a\0b', 'NUL byte'],
    ['', 'empty'],
  ])('rejects %s (%s)', (p) => {
    expect(() => safeVfsRelPath(p)).toThrow(VfsPathError);
  });

  it('allows the empty path only through safeVfsDirPath', () => {
    expect(safeVfsDirPath('')).toBe('');
    expect(safeVfsDirPath('a/b')).toBe('a/b');
    expect(() => safeVfsDirPath('../x')).toThrow(VfsPathError);
  });

  it('entry names must be single safe segments', () => {
    expect(isValidVfsEntryName('report.csv')).toBe(true);
    expect(isValidVfsEntryName('.gitignore')).toBe(true);
    expect(isValidVfsEntryName('a..b.txt')).toBe(true);
    expect(isValidVfsEntryName('')).toBe(false);
    expect(isValidVfsEntryName('.')).toBe(false);
    expect(isValidVfsEntryName('..')).toBe(false);
    expect(isValidVfsEntryName('a/b')).toBe(false);
    expect(isValidVfsEntryName('a\\b')).toBe(false);
    expect(isValidVfsEntryName('a\0b')).toBe(false);
  });
});

describe('MemoryVfs — traversal is rejected before touching the store', () => {
  it('writeFile with .. throws and writes nothing outside the root', async () => {
    const vfs = new MemoryVfs();
    await expect(vfs.writeFile('/projects/A', '../../B/evil.txt', 'x')).rejects.toThrow(VfsPathError);
    await expect(vfs.exists('/projects/B', 'evil.txt')).resolves.toBe(false);
  });

  it('read/delete/rename with .. throw', async () => {
    const vfs = new MemoryVfs({ 'ok.txt': 'x' }, '/projects/A');
    await expect(vfs.readFile('/projects/A', '../B/secret.txt')).rejects.toThrow(VfsPathError);
    await expect(vfs.deleteEntry('/projects/A', '../B', true)).rejects.toThrow(VfsPathError);
    await expect(vfs.renameEntry('/projects/A', 'ok.txt', '../B/x.txt')).rejects.toThrow(VfsPathError);
    // the source file is untouched by the failed rename
    await expect(vfs.readFile('/projects/A', 'ok.txt')).resolves.toBe('x');
  });

  it('readDir with .. throws (missing dirs still yield [])', async () => {
    const vfs = new MemoryVfs();
    await expect(vfs.readDir('/projects/A', '..')).rejects.toThrow(VfsPathError);
    await expect(vfs.readDir('/projects/A', 'missing-dir')).resolves.toEqual([]);
  });
});

describe('LightningVfs — the guard runs before any FS call', () => {
  function recordingFS() {
    const calls: string[] = [];
    const fs = {
      promises: {
        readFile: async (p: string) => {
          calls.push(`read:${p}`);
          return 'x';
        },
        writeFile: async (p: string) => {
          calls.push(`write:${p}`);
        },
        mkdir: async (p: string) => {
          calls.push(`mkdir:${p}`);
        },
        stat: async (p: string) => {
          calls.push(`stat:${p}`);
          throw new Error('ENOENT');
        },
        readdir: async () => [] as string[],
        unlink: async (p: string) => {
          calls.push(`unlink:${p}`);
        },
        rmdir: async () => {},
      },
    };
    return { calls, fs: fs as never };
  }

  it('rejects traversal without consulting the backing store', async () => {
    const { calls, fs } = recordingFS();
    const vfs = new LightningVfs(fs);
    await expect(vfs.readFile('/ergalics-projects/A', '../../B/project.clproj')).rejects.toThrow(VfsPathError);
    await expect(vfs.writeFile('/ergalics-projects/A', '../.git/config', 'x')).rejects.toThrow(VfsPathError);
    await expect(vfs.deleteEntry('/ergalics-projects/A', '../B', true)).rejects.toThrow(VfsPathError);
    await expect(vfs.renameEntry('/ergalics-projects/A', '../a', '../b')).rejects.toThrow(VfsPathError);
    await expect(vfs.exists('/ergalics-projects/A', '../../etc/passwd')).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('normal paths concatenate root + relative path', async () => {
    const { calls, fs } = recordingFS();
    const vfs = new LightningVfs(fs);
    await vfs.writeFile('/ergalics-projects/A', 'runs/x.json', 'x');
    // mkdirp creates every level, then the file is written at root + rel.
    expect(calls).toEqual([
      'mkdir:/ergalics-projects',
      'mkdir:/ergalics-projects/A',
      'mkdir:/ergalics-projects/A/runs',
      'write:/ergalics-projects/A/runs/x.json',
    ]);
  });
});
