import { describe, expect, it } from 'vitest';
import type { Vfs, VfsEntry } from '@/core/vfs';
import {
  buildSearchRegex,
  searchWorkspace,
  SEARCH_MAX_MATCHES_PER_FILE,
} from '@/core/search/workspaceSearch';

function entry(name: string, path: string, isDir = false, size = 10): VfsEntry {
  return { name, path, isDir, size };
}

/** Minimal Vfs facade over an in-memory directory/file map. */
function fakeFs(tree: Record<string, VfsEntry[]>, texts: Record<string, string>) {
  const fs: Pick<Vfs, 'readDir' | 'readFile'> = {
    readDir: async (_root, dir) => tree[dir] ?? [],
    readFile: async (_root, path) => {
      const text = texts[path];
      if (text === undefined) throw new Error('missing');
      return text;
    },
  };
  return fs;
}

describe('buildSearchRegex', () => {
  it('escapes literal queries and honours case sensitivity', () => {
    const re = buildSearchRegex('a.b', { caseSensitive: true })!;
    expect(re.test('a.b')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('axb')).toBe(false);

    const loose = buildSearchRegex('abc')!;
    expect(loose.test('ABC')).toBe(true);
  });

  it('wraps whole-word queries in word boundaries', () => {
    const re = buildSearchRegex('cat', { wholeWord: true })!;
    expect(re.test('a cat here')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('concatenate')).toBe(false);
  });

  it('returns null for an invalid regular expression', () => {
    expect(buildSearchRegex('(', { regex: true })).toBeNull();
  });
});

describe('searchWorkspace', () => {
  const tree: Record<string, VfsEntry[]> = {
    '': [entry('src', 'src', true), entry('README.md', 'README.md'), entry('logo.png', 'logo.png')],
    src: [entry('main.py', 'src/main.py')],
  };
  const texts = {
    'README.md': 'first line\nsearch me here\nlast line',
    'src/main.py': 'def search():\n    return "search"\n',
    'logo.png': 'search inside binary?',
  };

  it('groups line matches by text file and skips binaries', async () => {
    const result = await searchWorkspace(fakeFs(tree, texts), 'root', 'search');
    expect(result.invalidRegex).toBe(false);
    expect(result.total).toBe(3);
    expect(result.files.map((f) => f.path)).toEqual(['src/main.py', 'README.md']);
    expect(result.files[1]!.matches[0]).toMatchObject({
      line: 2,
      column: 1,
      text: 'search me here',
      highlightStart: 0,
      highlightLength: 6,
    });
    expect(result.files[0]!.matches[0]!.line).toBe(1);
  });

  it('respects case-sensitive and whole-word options', async () => {
    const sensitive = await searchWorkspace(fakeFs(tree, texts), 'root', 'Search', {
      caseSensitive: true,
    });
    expect(sensitive.total).toBe(0);

    const whole = await searchWorkspace(fakeFs(tree, texts), 'root', 'searc', {
      wholeWord: true,
    });
    expect(whole.total).toBe(0);
  });

  it('reports an invalid regular expression instead of throwing', async () => {
    const result = await searchWorkspace(fakeFs(tree, texts), 'root', '(', { regex: true });
    expect(result.invalidRegex).toBe(true);
    expect(result.files).toHaveLength(0);
  });

  it('does not descend into .git', async () => {
    const gitTree: Record<string, VfsEntry[]> = {
      '': [entry('.git', '.git', true), entry('notes.txt', 'notes.txt')],
      '.git': [entry('config', '.git/config')],
    };
    const result = await searchWorkspace(
      fakeFs(gitTree, { '.git/config': 'needle', 'notes.txt': 'needle' }),
      'root',
      'needle',
    );
    expect(result.files.map((f) => f.path)).toEqual(['notes.txt']);
  });

  it('caps the matches shown per file', async () => {
    const many = Array.from({ length: 80 }, () => 'hit').join('\n');
    const result = await searchWorkspace(
      fakeFs({ '': [entry('log.txt', 'log.txt')] }, { 'log.txt': many }),
      'root',
      'hit',
    );
    expect(result.files[0]!.matches).toHaveLength(SEARCH_MAX_MATCHES_PER_FILE);
    expect(result.total).toBe(SEARCH_MAX_MATCHES_PER_FILE);
  });

  it('returns empty results for an empty query', async () => {
    const result = await searchWorkspace(fakeFs(tree, texts), 'root', '');
    expect(result.total).toBe(0);
    expect(result.files).toHaveLength(0);
  });
});
