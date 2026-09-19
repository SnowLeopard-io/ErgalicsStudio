import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@/types/project';
import { getProject, listProjects, saveProject } from '@/core/storage';
import { listProjectFiles, setProjectFiles } from '@/core/dataFiles';
import { useProjectStore } from '@/stores/projectStore';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function slowFile(name: string, content: Promise<string>): File {
  const file = new File([], name, { type: 'text/plain' });
  vi.spyOn(file, 'text').mockReturnValue(content);
  return file;
}

async function open(project: Project) {
  vi.mocked(getProject).mockResolvedValueOnce(project);
  await useProjectStore.getState().openProject(project.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(saveProject).mockResolvedValue(undefined);
  vi.mocked(listProjects).mockResolvedValue([]);
  plugins.getAllParams.mockResolvedValue({});
  useProjectStore.setState({ project: null, dirty: false, status: 'ready', statusText: null });
  setProjectFiles([]);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('project save concurrency', () => {
  it('preserves edits made while storage commits and leaves them dirty for the next save', async () => {
    await open(createEmptyProject('before'));
    const commit = deferred<void>();
    const started = deferred<void>();
    vi.mocked(saveProject).mockImplementationOnce(() => { started.resolve(); return commit.promise; });
    const saving = useProjectStore.getState().save();
    await started.promise;
    useProjectStore.getState().rename('after');
    commit.resolve();
    await saving;
    expect(useProjectStore.getState().project?.name).toBe('after');
    expect(useProjectStore.getState().dirty).toBe(true);
    await useProjectStore.getState().save();
    expect(vi.mocked(saveProject).mock.lastCall?.[0].name).toBe('after');
    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('keeps runtime-only edits dirty even when the project object is unchanged', async () => {
    await open(createEmptyProject('A'));
    useProjectStore.getState().setDirty(true);
    const commit = deferred<void>();
    const started = deferred<void>();
    vi.mocked(saveProject).mockImplementationOnce(() => { started.resolve(); return commit.promise; });
    const saving = useProjectStore.getState().save();
    await started.promise;
    useProjectStore.getState().setDirty(true);
    commit.resolve();
    await saving;
    expect(useProjectStore.getState().dirty).toBe(true);
  });

  it('does not copy old plugin parameters into a newly opened project', async () => {
    await open(createEmptyProject('A'));
    const params = deferred<Record<string, Record<string, unknown>>>();
    plugins.getAllParams.mockReturnValueOnce(params.promise);
    const saving = useProjectStore.getState().save();
    const next = createEmptyProject('B');
    await open(next);
    params.resolve({ oldPlugin: { value: 42 } });
    await saving;
    expect(useProjectStore.getState().project).toEqual(next);
    expect(useProjectStore.getState().status).toBe('ready');
    expect(saveProject).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores stale storage %s after switching projects', async (outcome) => {
    await open(createEmptyProject('A'));
    const commit = deferred<void>();
    const started = deferred<void>();
    vi.mocked(saveProject).mockImplementationOnce(() => { started.resolve(); return commit.promise; });
    const saving = useProjectStore.getState().save();
    await started.promise;
    const next = createEmptyProject('B');
    await open(next);
    if (outcome === 'resolve') commit.resolve();
    else commit.reject(new Error('quota exceeded'));
    await saving;
    expect(useProjectStore.getState().project).toEqual(next);
    expect(useProjectStore.getState().status).toBe('ready');
    expect(plugins.notifyProjectLifecycle).not.toHaveBeenCalled();
  });

  it('treats reopening the same project as a new session', async () => {
    const project = createEmptyProject('A');
    await open(project);
    const params = deferred<Record<string, Record<string, unknown>>>();
    plugins.getAllParams.mockReturnValueOnce(params.promise);
    const saving = useProjectStore.getState().save();
    await open(project);
    params.resolve({ stale: { value: 42 } });
    await saving;
    expect(useProjectStore.getState().project).toEqual(project);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('does not start duplicate saves in the same session', async () => {
    await open(createEmptyProject('A'));
    const params = deferred<Record<string, Record<string, unknown>>>();
    plugins.getAllParams.mockReturnValueOnce(params.promise);
    const saving = useProjectStore.getState().save();
    await useProjectStore.getState().save();
    params.resolve({});
    await saving;
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('allows the new project to save while the old commit is still pending', async () => {
    await open(createEmptyProject('A'));
    const commit = deferred<void>();
    const started = deferred<void>();
    vi.mocked(saveProject).mockImplementationOnce(() => { started.resolve(); return commit.promise; });
    const oldSave = useProjectStore.getState().save();
    await started.promise;
    await open(createEmptyProject('B'));
    await useProjectStore.getState().save();
    const saved = useProjectStore.getState().project;
    commit.resolve();
    await oldSave;
    expect(saveProject).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().project).toBe(saved);
    expect(useProjectStore.getState().status).toBe('saved');
    expect(plugins.notifyProjectLifecycle).toHaveBeenCalledTimes(1);
  });

  it('does not let an earlier save timer reset a later save status', async () => {
    await open(createEmptyProject('A'));
    await useProjectStore.getState().save();
    vi.advanceTimersByTime(1000);
    await useProjectStore.getState().save();
    vi.advanceTimersByTime(500);
    expect(useProjectStore.getState().status).toBe('saved');
    vi.advanceTimersByTime(1000);
    expect(useProjectStore.getState().status).toBe('ready');
  });

  it('preserves edits during parameter collection for a later snapshot', async () => {
    await open(createEmptyProject('A'));
    const params = deferred<Record<string, Record<string, unknown>>>();
    plugins.getAllParams.mockReturnValueOnce(params.promise);
    const saving = useProjectStore.getState().save();
    useProjectStore.getState().rename('renamed');
    useProjectStore.getState().setDirty(true);
    params.resolve({});
    await saving;
    expect(useProjectStore.getState().project?.name).toBe('renamed');
    expect(useProjectStore.getState().dirty).toBe(true);
  });
});

describe('project opening and file imports', () => {
  it('does not let a slow create overwrite a later open', async () => {
    const commit = deferred<void>();
    vi.mocked(saveProject).mockReturnValueOnce(commit.promise);
    const creating = useProjectStore.getState().createProject('slow');
    const latest = createEmptyProject('latest');
    await open(latest);
    commit.resolve();
    await creating;
    expect(useProjectStore.getState().project).toEqual(latest);
  });

  it('does not let a slow file read overwrite a later open', async () => {
    const content = deferred<string>();
    const importing = useProjectStore.getState().openFromFile(slowFile('old.clproj', content.promise));
    const latest = createEmptyProject('latest');
    await open(latest);
    content.resolve(JSON.stringify(createEmptyProject('old')));
    await importing;
    expect(useProjectStore.getState().project).toEqual(latest);
  });

  it.each([false, true])('discards data read for a previous project session (reopen=%s)', async (reopen) => {
    const project = createEmptyProject('A');
    await open(project);
    const content = deferred<string>();
    const importing = useProjectStore.getState().addDataFile(slowFile('old.csv', content.promise));
    await open(createEmptyProject('B'));
    if (reopen) await open(project);
    content.resolve('x,y\n1,2');
    expect(await importing).toBeNull();
    expect(useProjectStore.getState().project?.data.files).toEqual([]);
    expect(listProjectFiles()).toEqual([]);
  });

  it('persists and opens an imported project when it is the latest request', async () => {
    const project = createEmptyProject('imported');
    const imported = await useProjectStore.getState().openFromFile(
      new File([JSON.stringify(project)], 'project.clproj'),
    );
    expect(saveProject).toHaveBeenCalledWith(imported);
    expect(useProjectStore.getState().project).toEqual(imported);
    expect(useProjectStore.getState().status).toBe('ready');
  });

  it('retains concurrent imports and renames in the same project', async () => {
    await open(createEmptyProject('A'));
    const content = deferred<string>();
    const importing = useProjectStore.getState().addDataFile(slowFile('slow.csv', content.promise));
    await useProjectStore.getState().addDataFile(new File(['x\n1'], 'fast.csv'));
    useProjectStore.getState().rename('renamed');
    content.resolve('x\n2');
    expect(await importing).not.toBeNull();
    expect(useProjectStore.getState().project?.name).toBe('renamed');
    expect(listProjectFiles()).toEqual(['fast.csv', 'slow.csv']);
  });

  it('replaces (not duplicates) a data file uploaded under the same name', async () => {
    await open(createEmptyProject('A'));
    const first = await useProjectStore.getState().addDataFile(new File(['x\n1'], 'data.csv'));
    const second = await useProjectStore.getState().addDataFile(new File(['x\n2'], 'data.csv'));
    expect(second).toBe(first);
    const files = useProjectStore.getState().project?.data.files ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe('x\n2');
    expect(listProjectFiles()).toEqual(['data.csv']);
  });
});
