import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { createEmptyProject, type Project } from '@/types/project';
import { createRunRecord } from '@/core/experiment/record';
import { getProject, listRuns, saveRun, deleteRunsByProject } from '@/core/storage';
import { RUN_COMPLETED, on } from '@/core/events';

vi.mock('@/stores/pluginStore', () => ({ usePluginStore: { getState: () => ({ restoreState: vi.fn() }) } }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ autoSaveInterval: 0 }) } }));
vi.mock('@/core/storage', () => ({
  getProject: vi.fn(), listProjects: vi.fn(async () => []),
  listRuns: vi.fn(async () => []), saveRun: vi.fn(async () => {}),
  deleteRun: vi.fn(async () => {}), deleteRunsByProject: vi.fn(async () => {}),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function open(project: Project) {
  vi.mocked(getProject).mockResolvedValueOnce(project);
  await useProjectStore.getState().openProject(project.id);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useProjectStore.setState({ project: null, status: 'ready', dirty: false });
  useExperimentStore.setState({ runs: [], loading: false });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it.each([false, true])('rejects a stale history read after switching projects (reopen=%s)', async (reopen) => {
  const a = createEmptyProject('A');
  const b = createEmptyProject('B');
  const runA = createRunRecord({ projectId: a.id, source: 'code' });
  const runB = createRunRecord({ projectId: b.id, source: 'code' });
  await open(a);
  const oldRead = deferred<typeof runA[]>();
  vi.mocked(listRuns).mockReturnValueOnce(oldRead.promise);
  const loading = useExperimentStore.getState().loadRuns();
  await open(b);
  if (reopen) await open(a);
  vi.mocked(listRuns).mockResolvedValueOnce(reopen ? [] : [runB]);
  await useExperimentStore.getState().loadRuns();
  oldRead.resolve([runA]);
  await loading;
  expect(useExperimentStore.getState().runs).toEqual(reopen ? [] : [runB]);
  expect(useExperimentStore.getState().loading).toBe(false);
});

it('uses the latest request when two reads of the same project return out of order', async () => {
  const a = createEmptyProject('A');
  await open(a);
  const old = deferred<ReturnType<typeof createRunRecord>[]>();
  const latest = createRunRecord({ projectId: a.id, source: 'code' });
  vi.mocked(listRuns).mockReturnValueOnce(old.promise);
  const loading = useExperimentStore.getState().loadRuns();
  vi.mocked(listRuns).mockResolvedValueOnce([latest]);
  await useExperimentStore.getState().loadRuns();
  old.resolve([]);
  await loading;
  expect(useExperimentStore.getState().runs).toEqual([latest]);
});

it('does not let a stale read failure erase the newer project history', async () => {
  const a = createEmptyProject('A');
  const b = createEmptyProject('B');
  await open(a);
  const old = deferred<ReturnType<typeof createRunRecord>[]>();
  vi.mocked(listRuns).mockReturnValueOnce(old.promise);
  const loading = useExperimentStore.getState().loadRuns();
  await open(b);
  const latest = createRunRecord({ projectId: b.id, source: 'code' });
  vi.mocked(listRuns).mockResolvedValueOnce([latest]);
  await useExperimentStore.getState().loadRuns();
  old.reject(new Error('storage failed'));
  await loading;
  expect(useExperimentStore.getState().runs).toEqual([latest]);
});

it('keeps a late commit in its original project without publishing to the new history', async () => {
  const a = createEmptyProject('A');
  await open(a);
  const commit = deferred<void>();
  vi.mocked(saveRun).mockReturnValueOnce(commit.promise);
  const event = vi.fn();
  const sub = on(RUN_COMPLETED, event);
  try {
    const recording = useExperimentStore.getState().recordRun({ source: 'code', durationMs: 1 });
    await open(createEmptyProject('B'));
    commit.resolve();
    const run = await recording;
    expect(run?.projectId).toBe(a.id);
    expect(useExperimentStore.getState().runs).toEqual([]);
    expect(event).not.toHaveBeenCalled();
  } finally { sub.unsubscribe(); }
});

it('does not clear the new history when an older project deletion finishes', async () => {
  const a = createEmptyProject('A');
  const b = createEmptyProject('B');
  await open(a);
  const deletion = deferred<void>();
  vi.mocked(deleteRunsByProject).mockReturnValueOnce(deletion.promise);
  const clearing = useExperimentStore.getState().clearRuns();
  await open(b);
  const runB = createRunRecord({ projectId: b.id, source: 'code' });
  vi.mocked(listRuns).mockResolvedValueOnce([runB]);
  await useExperimentStore.getState().loadRuns();
  deletion.resolve();
  await clearing;
  expect(useExperimentStore.getState().runs).toEqual([runB]);
});

it('a pending read cannot repopulate history after clearing the same project', async () => {
  const a = createEmptyProject('A');
  await open(a);
  const old = deferred<ReturnType<typeof createRunRecord>[]>();
  vi.mocked(listRuns).mockReturnValueOnce(old.promise);
  const loading = useExperimentStore.getState().loadRuns();
  await useExperimentStore.getState().clearRuns();
  old.resolve([createRunRecord({ projectId: a.id, source: 'code' })]);
  await loading;
  expect(useExperimentStore.getState().runs).toEqual([]);
  expect(useExperimentStore.getState().loading).toBe(false);
});

it('clears visible history immediately on project changes', async () => {
  const a = createEmptyProject('A');
  await open(a);
  await useExperimentStore.getState().recordRun({ source: 'code', durationMs: 1 });
  expect(useExperimentStore.getState().runs).toHaveLength(1);
  await open(createEmptyProject('B'));
  expect(useExperimentStore.getState().runs).toEqual([]);
});
