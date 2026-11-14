// ==========================================================================
// Regression tests for the per-project workbench session record.
//
// The layout is stored in localStorage and read back on the next project open,
// so a stale or hand-edited value must never crash the workbench — these tests
// pin the sanitising rules and the save/load/clear round trip.
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasTab } from '@/stores/appStore';
import {
  MAX_PERSISTED_CONSOLE,
  clearWorkbenchSession,
  loadWorkbenchSession,
  persistableTab,
  sanitizeWorkbenchSession,
  saveWorkbenchSession,
  type WorkbenchSession,
} from '@/stores/workbenchSession';

/** Minimal localStorage stand-in (the test environment is `node`). */
function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeWorkbenchSession', () => {
  it('rejects non-objects', () => {
    expect(sanitizeWorkbenchSession(null)).toBeNull();
    expect(sanitizeWorkbenchSession('nope')).toBeNull();
    expect(sanitizeWorkbenchSession([])).toBeNull();
  });

  it('drops invalid tabs and keeps valid ones', () => {
    const session = sanitizeWorkbenchSession({
      tabs: [
        { kind: 'file', key: 'file:a.txt', path: 'a.txt' },
        { kind: 'file', key: 'file:b.txt', path: '' },
        { kind: 'editor', key: 'editor:c.py', path: 'c.py', editor: 'code' },
        { kind: 'editor', key: 'editor:d.py', path: 'd.py', editor: 'bogus' },
        { kind: 'surface', key: 'surface:code:c.py', mode: 'code', path: 'c.py' },
        { kind: 'surface', key: 'surface:weird', mode: 'weird' },
        { kind: 'tool', key: 'tool:latex-editor', id: 'latex-editor' },
        { kind: 'settings', key: 'settings:app' },
        { kind: 'mystery', key: 'x' },
        'not a tab',
      ],
    });
    expect(session?.tabs.map((tab) => tab.key)).toEqual([
      'file:a.txt',
      'editor:c.py',
      'surface:code:c.py',
      'tool:latex-editor',
      'settings:app',
    ]);
  });

  it('nulls an active tab that is not in the tab list', () => {
    const session = sanitizeWorkbenchSession({
      tabs: [{ kind: 'file', key: 'file:a.txt', path: 'a.txt' }],
      activeTab: 'file:gone.txt',
    });
    expect(session?.activeTab).toBeNull();
    expect(
      sanitizeWorkbenchSession({
        tabs: [{ kind: 'file', key: 'file:a.txt', path: 'a.txt' }],
        activeTab: 'file:a.txt',
      })?.activeTab,
    ).toBe('file:a.txt');
  });

  it('dedupes expanded dirs and drops the root / non-strings', () => {
    const session = sanitizeWorkbenchSession({
      expandedDirs: ['data', 'data', '', 'figures', 7, null],
    });
    expect(session?.expandedDirs).toEqual(['data', 'figures']);
  });

  it('filters bad console entries and caps the tail', () => {
    const entries = Array.from({ length: MAX_PERSISTED_CONSOLE + 10 }, (_, i) => ({
      stream: 'stdout',
      text: `line ${i}`,
      timestamp: i,
    }));
    const session = sanitizeWorkbenchSession({
      console: [...entries, { stream: 'nope', text: 'x' }, { stream: 'stdout', text: 9 }, null],
    });
    expect(session?.console).toHaveLength(MAX_PERSISTED_CONSOLE);
    expect(session?.console[0]?.text).toBe('line 10');
    expect(session?.console.at(-1)?.text).toBe(`line ${MAX_PERSISTED_CONSOLE + 9}`);
  });

  it('defaults mode, error and savedAt', () => {
    const session = sanitizeWorkbenchSession({ mode: 'bogus', error: 42 });
    expect(session).toEqual({
      tabs: [],
      activeTab: null,
      mode: 'standard',
      expandedDirs: [],
      console: [],
      error: null,
      savedAt: 0,
    });
  });
});

describe('persistableTab', () => {
  it('keeps only the durable tab description', () => {
    const tabs: CanvasTab[] = [
      { kind: 'file', key: 'file:a.md', path: 'a.md' },
      { kind: 'editor', key: 'editor:b.py', path: 'b.py', editor: 'code' },
      { kind: 'surface', key: 'surface:flow:f.json', mode: 'flow', path: 'f.json' },
      { kind: 'surface', key: 'surface:code', mode: 'code' },
      { kind: 'tool', key: 'tool:latex-editor', id: 'latex-editor' },
      { kind: 'settings', key: 'settings:app' },
    ];
    expect(tabs.map(persistableTab)).toEqual([
      { kind: 'file', key: 'file:a.md', path: 'a.md' },
      { kind: 'editor', key: 'editor:b.py', path: 'b.py', editor: 'code' },
      { kind: 'surface', key: 'surface:flow:f.json', mode: 'flow', path: 'f.json' },
      { kind: 'surface', key: 'surface:code', mode: 'code' },
      { kind: 'tool', key: 'tool:latex-editor', id: 'latex-editor' },
      { kind: 'settings', key: 'settings:app' },
    ]);
  });
});

describe('session storage round trip', () => {
  const session: WorkbenchSession = {
    tabs: [{ kind: 'file', key: 'file:a.txt', path: 'a.txt' }],
    activeTab: 'file:a.txt',
    mode: 'code',
    expandedDirs: ['data'],
    console: [{ stream: 'stdout', text: 'hi', timestamp: 1 }],
    error: 'boom',
    savedAt: 123,
  };

  it('saves, loads and clears per project id', () => {
    expect(loadWorkbenchSession('p1')).toBeNull();
    saveWorkbenchSession('p1', session);
    expect(loadWorkbenchSession('p1')).toEqual(session);
    // A different project never sees this layout.
    expect(loadWorkbenchSession('p2')).toBeNull();
    clearWorkbenchSession('p1');
    expect(loadWorkbenchSession('p1')).toBeNull();
  });

  it('returns null for corrupt JSON instead of throwing', () => {
    localStorage.setItem('ergalics:workbench-session:p1', '{not json');
    expect(loadWorkbenchSession('p1')).toBeNull();
  });
});
