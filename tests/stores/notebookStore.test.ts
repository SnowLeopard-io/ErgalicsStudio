import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { createEmptyProject, type Project } from '@/types/project';
import { createCell } from '@/core/notebook/notebook';
import { getProject, saveRun } from '@/core/storage';
import { on, NOTEBOOK_EXECUTED } from '@/core/events';
import type { CodeRuntime, CodeRuntimeHost } from '@/core/pyodide/runtime';

const python = vi.hoisted(() => ({
  runPython: vi.fn(), dispose: vi.fn(), hosts: [] as CodeRuntimeHost[],
}));
vi.mock('@/core/pyodide/runtime', () => ({ createCodeRuntime: (host: CodeRuntimeHost) => {
  python.hosts.push(host);
  return { runPython: python.runPython, dispose: python.dispose };
} }));
vi.mock('@/stores/pluginStore', () => ({ usePluginStore: { getState: () => ({ restoreState: vi.fn() }) } }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ autoSaveInterval: 0 }) } }));
vi.mock('@/core/storage', () => ({
  getProject: vi.fn(), listProjects: vi.fn(async () => []), saveRun: vi.fn(async () => {}),
  listRuns: vi.fn(async () => []), deleteRun: vi.fn(), deleteRunsByProject: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Result = Awaited<ReturnType<CodeRuntime['runPython']>>;
const result: Result = { ok: true, durationMs: 1, variables: {}, outputs: {} };
async function open(project: Project) {
  vi.mocked(getProject).mockResolvedValueOnce(project);
  await useProjectStore.getState().openProject(project.id);
}
function notebook(name: string) {
  const project = createEmptyProject(name);
  const cell = createCell('code', 'answer = 42');
  project.state.notebook = { cells: [cell] };
  return { project, cell };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  python.runPython.mockReset();
  python.hosts.length = 0;
  useProjectStore.setState({ project: null, status: 'ready', dirty: false });
  useNotebookStore.getState().disposeRuntime();
  python.dispose.mockClear();
});
afterEach(() => {
  useNotebookStore.getState().disposeRuntime();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('updates outputs and records runs in an unchanged project', async () => {
  const { project, cell } = notebook('A');
  await open(project);
  python.runPython.mockResolvedValueOnce(result);
  await useNotebookStore.getState().runCell(cell.id);
  expect(useProjectStore.getState().project?.state.notebook?.cells[0]?.ok).toBe(true);
  expect(vi.mocked(saveRun).mock.lastCall?.[0].projectId).toBe(project.id);
});

it.each([false, true])('discards late notebook results/errors after a project switch (error=%s)', async (error) => {
  const { project: a, cell } = notebook('A');
  const b = createEmptyProject('B');
  b.state.notebook = structuredClone(a.state.notebook);
  await open(a);
  const computation = deferred<Result>();
  python.runPython.mockReturnValueOnce(computation.promise);
  const event = vi.fn();
  const sub = on(NOTEBOOK_EXECUTED, event);
  try {
    const running = useNotebookStore.getState().runCell(cell.id);
    await open(b);
    expect(python.dispose).toHaveBeenCalledOnce();
    expect(useNotebookStore.getState().runningCellId).toBeNull();
    if (error) computation.reject(new Error('disposed'));
    else computation.resolve(result);
    await running;
    expect(useProjectStore.getState().project?.state.notebook?.cells[0]?.ok).toBeUndefined();
    expect(saveRun).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); }
});

it('invalidates a run when closing and reopening the same project id', async () => {
  const { project, cell } = notebook('A');
  await open(project);
  const computation = deferred<Result>();
  python.runPython.mockReturnValueOnce(computation.promise);
  const running = useNotebookStore.getState().runCell(cell.id);
  await open(project);
  computation.resolve(result);
  await running;
  expect(useProjectStore.getState().project?.state.notebook?.cells[0]?.ok).toBeUndefined();
  expect(saveRun).not.toHaveBeenCalled();
});

it('ignores callbacks/completion from a disposed runtime while a new run is active', async () => {
  const { project, cell } = notebook('A');
  await open(project);
  const old = deferred<Result>();
  const latest = deferred<Result>();
  python.runPython.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const first = useNotebookStore.getState().runCell(cell.id);
  const oldHost = python.hosts[0]!;
  useNotebookStore.getState().disposeRuntime();
  const second = useNotebookStore.getState().runCell(cell.id);
  oldHost.onStdout?.('stale');
  python.hosts[1]!.onStdout?.('current');
  old.resolve(result);
  await first;
  expect(useNotebookStore.getState().runningCellId).toBe(cell.id);
  latest.resolve(result);
  await second;
  expect(useProjectStore.getState().project?.state.notebook?.cells[0]?.outputs).toEqual([{ kind: 'stdout', text: 'current' }]);
  expect(saveRun).toHaveBeenCalledOnce();
});

it('does not attach old results to source edited during execution', async () => {
  const { project, cell } = notebook('A');
  await open(project);
  const computation = deferred<Result>();
  python.runPython.mockReturnValueOnce(computation.promise);
  const running = useNotebookStore.getState().runCell(cell.id);
  useNotebookStore.getState().updateCell(cell.id, { source: 'answer = 7' });
  computation.resolve(result);
  await running;
  const updated = useProjectStore.getState().project?.state.notebook?.cells[0];
  expect(updated?.source).toBe('answer = 7');
  expect(updated?.ok).toBeUndefined();
  expect(vi.mocked(saveRun).mock.lastCall?.[0].projectId).toBe(project.id);
});
