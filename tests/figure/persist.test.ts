// Regression test: figure panel/sheet removal must survive save + project
// reopen ("deleted panel reappears after refresh" bug report). Destructive
// edits bypass the dirty-debounce and persist immediately.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@/types/project';
import { getProject, saveProject, listProjects } from '@/core/storage';
import { useProjectStore } from '@/stores/projectStore';
import { useFigureStore } from '@/stores/figureStore';
import type { FigureSheet } from '@/types/project';

const plugins = vi.hoisted(() => ({
  getAllParams: vi.fn<() => Promise<Record<string, Record<string, unknown>>>>(),
  restoreState: vi.fn(),
  deactivate: vi.fn(),
  notifyProjectLifecycle: vi.fn(),
}));
vi.mock('@/stores/pluginStore', () => ({ usePluginStore: { getState: () => plugins } }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSaveInterval: 0 }) },
}));
vi.mock('@/core/storage', () => ({
  getProject: vi.fn(), saveProject: vi.fn(), listProjects: vi.fn(),
  deleteProject: vi.fn(), deleteRunsByProject: vi.fn(),
}));

function spec(n: string) {
  return {
    width: 300, height: 200, title: n, series: [{ name: n, kind: 'line' as const, color: '#000', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(saveProject).mockResolvedValue(undefined);
  vi.mocked(listProjects).mockResolvedValue([]);
  plugins.getAllParams.mockResolvedValue({});
  useProjectStore.setState({ project: null, dirty: false, status: 'ready', statusText: null });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('figure panel removal persistence', () => {
  it('removePanel survives save + project reopen', async () => {
    const project: Project = createEmptyProject('fig');
    const now = Date.now();
    const sheet: FigureSheet = {
      id: 'sheet-1', name: 'F', templateId: 'ieee_single', caption: '',
      panels: [
        { row: 0, col: 0, spec: spec('a') },
        { row: 0, col: 1, spec: spec('b') },
      ],
      createdAt: now, updatedAt: now,
    };
    project.state.figureSheets = [sheet];
    vi.mocked(getProject).mockResolvedValueOnce(project);
    await useProjectStore.getState().openProject(project.id);

    expect(useFigureStore.getState().activeSheetId).toBe(null);
    useFigureStore.getState().setActive('sheet-1');
    useFigureStore.getState().removePanel('sheet-1', 1);

    const afterRemove = useProjectStore.getState().project?.state.figureSheets?.[0]?.panels.length;
    expect(afterRemove).toBe(1);

    // Destructive edits persist immediately — a refresh right after the
    // click must not resurrect the panel from the stale snapshot.
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(saveProject)).toHaveBeenCalled();
    const saved = vi.mocked(saveProject).mock.lastCall?.[0];
    expect(saved?.state.figureSheets?.[0]?.panels.length).toBe(1);

    // Simulate the refresh: reopen the persisted snapshot.
    vi.mocked(getProject).mockResolvedValueOnce(saved);
    await useProjectStore.getState().openProject(project.id);
    expect(useProjectStore.getState().project?.state.figureSheets?.[0]?.panels.length).toBe(1);
  });
});
