// ==========================================================================
// Store-orchestration tests.
//
// The core kernels are well covered, but the STORE layer (the glue that
// decides what a mutation means and where it lands) had no tests at all —
// and every bug of that class found in the audits lived exactly there:
// a citation key collision silently overwriting a reference, two figure
// panels sharing a grid cell, a stale sheet id making a mutation a no-op.
//
// These tests pin the behaviour of that layer.
// ==========================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@/types/project';

vi.mock('@/stores/pluginStore', () => ({
  usePluginStore: {
    getState: () => ({
      activeId: null,
      getAllParams: vi.fn(async () => ({})),
      restoreState: vi.fn(),
      deactivate: vi.fn(),
      notifyProjectLifecycle: vi.fn(),
    }),
  },
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSaveInterval: 0 }) },
}));

import { useProjectStore } from '@/stores/projectStore';
import { usePublishStore } from '@/stores/publishStore';
import { useFigureStore } from '@/stores/figureStore';
import { useResearchStore } from '@/stores/researchStore';
import type { BibEntry } from '@/core/publish/bibtex';

function project(): Project {
  return createEmptyProject('p');
}

function entry(key: string, extra: Partial<BibEntry['fields']> = {}): BibEntry {
  return {
    type: 'article',
    key,
    fields: { author: 'Smith, J.', year: '2020', title: 'A work on things', ...extra },
  };
}

beforeEach(() => {
  const p = project();
  useProjectStore.setState({ project: p, dirty: false, status: 'ready', statusText: null });
});

describe('publishStore: the citation library', () => {
  it('adds an entry under a free key', () => {
    usePublishStore.getState().addLibraryEntries([entry('smith2020')]);
    const lib = useProjectStore.getState().project!.state.publish!.library;
    expect(lib).toHaveLength(1);
    expect(lib[0]!.key).toBe('smith2020');
  });

  it('never lets an import overwrite an unrelated reference', () => {
    usePublishStore.getState().addLibraryEntries([entry('smith2020', { doi: '10.1/a' })]);
    // A different paper that happens to carry the same key.
    usePublishStore.getState().addLibraryEntries([
      entry('smith2020', { title: 'Another work', doi: '10.1/b' }),
    ]);
    const lib = useProjectStore.getState().project!.state.publish!.library;
    expect(lib).toHaveLength(2);
    // The first reference survived.
    expect(lib.some((e) => e.fields.doi === '10.1/a')).toBe(true);
    // And the new one got a free key.
    expect(new Set(lib.map((e) => e.key)).size).toBe(2);
  });

  it('updates an entry in place when it is the SAME work (same DOI)', () => {
    usePublishStore.getState().addLibraryEntries([entry('smith2020', { doi: '10.1/a' })]);
    usePublishStore.getState().addLibraryEntries([
      entry('smith2020', { doi: '10.1/a', title: 'A work on things, revised' }),
    ]);
    const lib = useProjectStore.getState().project!.state.publish!.library;
    expect(lib).toHaveLength(1);
    expect(lib[0]!.fields.title).toBe('A work on things, revised');
  });

  it('a rename that would duplicate a key does not create one', () => {
    usePublishStore.getState().addLibraryEntries([entry('a2020')]);
    usePublishStore.getState().addLibraryEntries([entry('b2021')]);
    usePublishStore.getState().updateLibraryEntry('b2021', entry('a2020'));
    const lib = useProjectStore.getState().project!.state.publish!.library;
    expect(new Set(lib.map((e) => e.key)).size).toBe(2);
  });
});

describe('figureStore: panel placement', () => {
  const spec = {
    width: 300, height: 200, title: 'p',
    series: [{ name: 'p', kind: 'line' as const, color: '#000', points: [{ x: 0, y: 0 }] }],
  };

  it('auto-places panels into free cells', () => {
    const sheetId = useFigureStore.getState().createSheet('F')!;
    useFigureStore.getState().addPanel(sheetId, spec);
    useFigureStore.getState().addPanel(sheetId, spec);
    const sheet = useProjectStore.getState().project!.state.figureSheets![0]!;
    expect(sheet.panels.map((p) => [p.row, p.col])).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it('never lets two panels share a grid cell (they would overlap)', () => {
    const sheetId = useFigureStore.getState().createSheet('F')!;
    useFigureStore.getState().addPanel(sheetId, spec, { row: 0, col: 0 });
    // An explicit placement onto an occupied cell must not overlap.
    useFigureStore.getState().addPanel(sheetId, spec, { row: 0, col: 0 });
    const sheet = useProjectStore.getState().project!.state.figureSheets![0]!;
    const cells = sheet.panels.map((p) => `${p.row}:${p.col}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('moving a panel onto an occupied cell relocates it instead of overlapping', () => {
    const sheetId = useFigureStore.getState().createSheet('F')!;
    useFigureStore.getState().addPanel(sheetId, spec, { row: 0, col: 0 });
    useFigureStore.getState().addPanel(sheetId, spec, { row: 0, col: 1 });
    // Move panel 0 onto panel 1's cell.
    useFigureStore.getState().updatePanel(sheetId, 0, spec, { row: 0, col: 1 });
    const sheet = useProjectStore.getState().project!.state.figureSheets![0]!;
    const cells = sheet.panels.map((p) => `${p.row}:${p.col}`);
    expect(new Set(cells).size).toBe(2);
  });

  it('honours a placement that names only the row', () => {
    const sheetId = useFigureStore.getState().createSheet('F')!;
    useFigureStore.getState().addPanel(sheetId, spec, { row: 2 });
    const sheet = useProjectStore.getState().project!.state.figureSheets![0]!;
    expect(sheet.panels[0]!.row).toBe(2);
  });
});

describe('researchStore: sweeps, profiles and reports', () => {
  it('saves and replaces a plan by id', () => {
    const plan = {
      id: 'p1', name: 'P', axes: [], createdAt: 0, metric: 'value', repeats: 1,
    } as never;
    useResearchStore.getState().savePlan(plan);
    useResearchStore.getState().savePlan({ ...plan, name: 'P2' } as never);
    const plans = useProjectStore.getState().project!.state.sweeps ?? [];
    expect(plans).toHaveLength(1);
    expect(plans[0]!.name).toBe('P2');
  });

  it('deleting a plan removes its results too', () => {
    const plan = { id: 'p1', name: 'P', axes: [], createdAt: 0, metric: 'value', repeats: 1 } as never;
    useResearchStore.getState().savePlan(plan);
    useResearchStore.getState().saveSweepResult({ planId: 'p1', cells: [], status: 'done' } as never);
    expect(Object.keys(useProjectStore.getState().project!.state.sweepResults ?? {})).toHaveLength(1);
    useResearchStore.getState().deletePlan('p1');
    const state = useProjectStore.getState().project!.state;
    expect(state.sweeps ?? []).toHaveLength(0);
    expect(Object.keys(state.sweepResults ?? {})).toHaveLength(0);
  });

  it('a profile is replaced per file key', () => {
    const profile = { fileKey: 'f', rows: 1, columns: [], score: 90, duplicates: {}, issues: [] } as never;
    useResearchStore.getState().saveProfile(profile);
    useResearchStore.getState().saveProfile({ ...profile, score: 50 } as never);
    const profiles = useProjectStore.getState().project!.state.profiles ?? [];
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.score).toBe(50);
  });
});
