import { create } from 'zustand';
import type { Project } from '@/types/project';
import {
  createEmptyProject,
  deserializeProject,
  serializeProject,
  touchProject,
} from '@/types/project';
import {
  saveProject,
  deleteProject,
  listProjects,
  getProject,
} from '@/core/storage';
import { logger } from '@/core/logger';
import { useSettingsStore } from './settingsStore';
import { usePluginStore } from './pluginStore';
import { BLOCK_GRAPH_CHANGED, useBlockStore } from './blockStore';
import type { BlockGraphState } from '@/types/block';
import { on } from '@/core/events';

export type ProjectStatus =
  | 'ready'
  | 'saving'
  | 'saved'
  | 'computing'
  | 'loading'
  | 'error';

interface ProjectStore {
  project: Project | null;
  recent: Project[];
  dirty: boolean;
  status: ProjectStatus;
  statusText: string | null;

  createProject: (name: string) => Promise<Project>;
  openProject: (id: string) => Promise<void>;
  loadProjectFromText: (raw: string) => Promise<Project>;
  save: () => Promise<void>;
  saveAs: (fileName?: string) => void;
  openFromFile: (file: File) => Promise<Project>;
  rename: (name: string) => void;
  remove: (id: string) => Promise<void>;
  loadRecent: () => Promise<void>;
  setDirty: (dirty: boolean) => void;
  setStatus: (status: ProjectStatus, statusText?: string | null) => void;
  /** Hook for plugins to persist extra state before save. */
  applyPluginParams: () => Promise<void> | void;
  /** Persist the block graph into the project before save. */
  applyBlockGraph: () => void;
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

const EMPTY_BLOCK_GRAPH: BlockGraphState = {
  instances: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function restoreBlockGraph(graph: BlockGraphState | null | undefined): void {
  useBlockStore.getState().fromJSON(graph ?? EMPTY_BLOCK_GRAPH);
}

function ensureAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  const interval = useSettingsStore.getState().autoSaveInterval;
  if (interval <= 0) return;
  autosaveTimer = setInterval(() => {
    const { project, dirty, status } = useProjectStore.getState();
    if (project && dirty && status !== 'saving') {
      useProjectStore.getState().save();
    }
  }, interval);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  recent: [],
  dirty: false,
  status: 'ready',
  statusText: null,

  createProject: async (name) => {
    const project = createEmptyProject(name);
    await saveProject(project);
    set({ project, dirty: false });
    await get().loadRecent();
    return project;
  },

  openProject: async (id) => {
    const project = await getProject(id);
    if (!project) throw new Error('project not found');
    set({ project, dirty: false });
    await get().loadRecent();
    usePluginStore.getState().restoreState(project);
    restoreBlockGraph(project.state.blockGraph);
    ensureAutosave();
  },

  loadProjectFromText: async (raw) => {
    const project = deserializeProject(raw);
    await saveProject(project);
    set({ project, dirty: false });
    await get().loadRecent();
    usePluginStore.getState().restoreState(project);
    restoreBlockGraph(project.state.blockGraph);
    ensureAutosave();
    return project;
  },

  save: async () => {
    const { project, status } = get();
    if (!project || status === 'saving') return;
    // Claim the 'saving' flag synchronously — previously it was set only
    // *after* two awaits, so Ctrl+S racing an autosave both passed the guard
    // and their final set() could overwrite each other out of order.
    set({ status: 'saving', statusText: null });
    try {
      await get().applyPluginParams();
      get().applyBlockGraph();
      const current = get().project;
      if (!current) {
        set({ status: 'ready' });
        return;
      }
      const touched = touchProject(current);
      await saveProject(touched);
      set({ project: touched, dirty: false, status: 'saved' });
    } catch (err) {
      logger.error('project', 'save failed', err);
      set({ status: 'error' });
    }
    setTimeout(() => {
      if (useProjectStore.getState().status === 'saved') {
        set({ status: 'ready' });
      }
    }, 1500);
  },

  saveAs: (fileName) => {
    const { project } = get();
    if (!project) return;
    const json = serializeProject(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName ?? project.name ?? 'project'}.clproj`;
    a.click();
    // Defer revoking: in some browsers revoking synchronously cancels the
    // download before the browser has begun fetching the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  openFromFile: async (file) => {
    const raw = await file.text();
    return get().loadProjectFromText(raw);
  },

  rename: (name) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, name }, dirty: true });
  },

  remove: async (id) => {
    await deleteProject(id);
    await get().loadRecent();
    if (get().project?.id === id) set({ project: null, dirty: false });
  },

  loadRecent: async () => {
    const recent = await listProjects(10);
    set({ recent });
  },

  setDirty: (dirty) => set({ dirty }),
  setStatus: (status, statusText = null) => set({ status, statusText }),

  applyPluginParams: async () => {
    const params = await usePluginStore.getState().getAllParams();
    // Re-read the project *after* the await — the old snapshot could be
    // stale if a rename/setParam landed during the await, and applying it
    // would silently discard the concurrent update.
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        state: {
          ...project.state,
          parameters: params,
        },
      },
    });
  },

  applyBlockGraph: () => {
    const { project } = get();
    if (!project) return;
    const graph = useBlockStore.getState().toJSON();
    set({
      project: {
        ...project,
        state: { ...project.state, blockGraph: graph },
      },
    });
  },
}));

let projectStoreInit = false;

export function initProjectStore() {
  // Guard against double-init (StrictMode double-render / HMR re-evaluation)
  // which previously duplicated autosave timers and bus handlers.
  if (projectStoreInit) return;
  projectStoreInit = true;
  useProjectStore.getState().loadRecent();
  ensureAutosave();
  // re-arm autosave when settings change
  useSettingsStore.subscribe(() => ensureAutosave());
  // mark the project dirty when the block graph mutates
  on(BLOCK_GRAPH_CHANGED, () => useProjectStore.getState().setDirty(true));
}