import { create } from 'zustand';
import type { FileEntry, Project } from '@/types/project';
import {
  createEmptyProject,
  deserializeProject,
  serializeProject,
  touchProject,
} from '@/types/project';
import { setProjectFiles } from '@/core/dataFiles';
import { isSupportedDataFileName } from '@/core/fileFormat';
import {
  saveProject,
  deleteProject,
  listProjects,
  getProject,
  deleteRunsByProject,
} from '@/core/storage';
import { logger } from '@/core/logger';
import { useSettingsStore } from './settingsStore';
import { usePluginStore } from './pluginStore';
import { BLOCK_GRAPH_CHANGED, useBlockStore } from './blockStore';
import { EDITOR_STATE_CHANGED, useEditorStore } from './editorStore';
import { useAppStore } from './appStore';
import type { BlockGraphState } from '@/types/block';
import type { WorkbenchMode } from '@/types/editor';
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
  /** Persist editor sessions + active mode into the project before save. */
  applyEditor: () => void;
  /** Register a data file (text content) into the project. Resolves to the
   *  new FileEntry id (null without a project / on unsupported format). */
  addDataFile: (file: File) => Promise<string | null>;
  /** Remove a data file from the current project. */
  removeDataFile: (id: string) => void;
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Generation token for project open/create/import. IndexedDB responses can
 * resolve out of issuance order (quick clicks on two recent projects); a
 * late response for an older request must not overwrite the project the user
 * ended up on. Every new open/create/import bumps this token.
 */
let openSeq = 0;

// An active session changes only when a project is installed or removed.
// Unlike an id, it also distinguishes closing and reopening the same project.
let projectSession = 0;
let editRevision = 0;
let saveSeq = 0;

function isCurrentSession(session: number, projectId: string): boolean {
  return session === projectSession && useProjectStore.getState().project?.id === projectId;
}

async function importProjectText(raw: string, seq: number): Promise<Project> {
  const project = deserializeProject(raw);
  // File reads participate in opening order before their first await.
  if (seq !== openSeq) return project;
  await saveProject(project);
  if (seq === openSeq) applyOpenedProject(project);
  return project;
}

/** Derive a data-file "format" tag from a filename extension. */
function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return 'txt';
  return name.slice(idx + 1).toLowerCase();
}

/** Re-sync the shared file registry whenever the current project changes. */
function syncProjectFiles(project: Project | null): void {
  setProjectFiles(project?.data.files ?? []);
}

const EMPTY_BLOCK_GRAPH: BlockGraphState = {
  instances: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function restoreBlockGraph(graph: BlockGraphState | null | undefined): void {
  useBlockStore.getState().fromJSON(graph ?? EMPTY_BLOCK_GRAPH);
}

function restoreEditor(state: {
  editorSessions?: import('@/types/editor').EditorSession[] | null;
  activeEditorSession?: string | null;
  workbenchMode?: WorkbenchMode;
}): void {
  useEditorStore.getState().fromJSON({
    sessions: state.editorSessions ?? [],
    activeSessionId: state.activeEditorSession ?? null,
  });
  // Always land on Standard when a project opens — never re-enter the
  // Flow/Block/Code mode the project was last saved in. The user switches
  // modes explicitly when they want one.
  useAppStore.getState().setMode('standard');
}

/**
 * Publish a freshly opened/created/imported project to every runtime surface
 * (store, file registry, plugin state, block graph, editor, autosave).
 * Centralized so openProject and loadProjectFromText share the exact same
 * restoration sequence and the stale-response guard.
 */
function applyOpenedProject(project: Project): void {
  projectSession += 1;
  useProjectStore.setState({ project, dirty: false, status: 'ready', statusText: null });
  syncProjectFiles(project);
  void useProjectStore.getState().loadRecent();
  usePluginStore.getState().restoreState(project);
  restoreBlockGraph(project.state.blockGraph);
  restoreEditor(project.state);
  ensureAutosave();
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
    const seq = ++openSeq;
    const project = createEmptyProject(name);
    await saveProject(project);
    if (seq !== openSeq) return project;
    projectSession += 1;
    // Clear the previous project's runtime state so a fresh project never
    // shows the old one's block graph, editor sessions or active plugin.
    useBlockStore.getState().clear();
    useEditorStore.getState().fromJSON({ sessions: [], activeSessionId: null });
    void usePluginStore.getState().deactivate();
    useAppStore.getState().setMode('standard');
    set({ project, dirty: false, status: 'ready', statusText: null });
    syncProjectFiles(project);
    ensureAutosave();
    await get().loadRecent();
    return project;
  },

  openProject: async (id) => {
    const seq = ++openSeq;
    const project = await getProject(id);
    // A newer open/create/import (or a response that beat this one) wins.
    if (seq !== openSeq) return;
    if (!project) throw new Error('project not found');
    applyOpenedProject(project);
  },

  loadProjectFromText: (raw) => importProjectText(raw, ++openSeq),

  save: async () => {
    const { project, status } = get();
    if (!project || status === 'saving') return;
    const session = projectSession;
    const revision = editRevision;
    const seq = ++saveSeq;
    // Claim the 'saving' flag synchronously — previously it was set only
    // *after* two awaits, so Ctrl+S racing an autosave both passed the guard
    // and their final set() could overwrite each other out of order.
    set({ status: 'saving', statusText: null });
    try {
      await get().applyPluginParams();
      if (!isCurrentSession(session, project.id)) return;
      get().applyBlockGraph();
      get().applyEditor();
      const current = get().project;
      if (!current) {
        set({ status: 'ready' });
        return;
      }
      const touched = touchProject(current);
      await saveProject(touched);
      if (!isCurrentSession(session, project.id)) return;
      // Storage committed this snapshot, not edits made during its await.
      // Runtime-only edits (plugins/editor/flow) may not replace the project
      // object, so track dirty notifications as well as object identity.
      const unchanged = get().project === current && editRevision === revision;
      set(unchanged
        ? { project: touched, dirty: false, status: 'saved' }
        : { dirty: true, status: 'ready' });
      // Let plugins persist their own state alongside the project now that
      // the project itself is durably stored.
      usePluginStore.getState().notifyProjectLifecycle('save');
    } catch (err) {
      logger.error('project', 'save failed', err);
      if (isCurrentSession(session, project.id)) set({ status: 'error' });
    }
    setTimeout(() => {
      if (seq === saveSeq && isCurrentSession(session, project.id) && get().status === 'saved') {
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
    const seq = ++openSeq;
    const raw = await file.text();
    return importProjectText(raw, seq);
  },

  rename: (name) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, name }, dirty: true });
  },

  remove: async (id) => {
    await deleteProject(id);
    // Cascade: run records live in their own store, not inside the project.
    await deleteRunsByProject(id).catch(() => undefined);
    await get().loadRecent();
    if (get().project?.id === id) {
      projectSession += 1;
      set({ project: null, dirty: false, status: 'ready', statusText: null });
      syncProjectFiles(null);
      // Clear the block graph, editor sessions and active plugin so the
      // canvas/editor never keep showing the deleted project's content.
      useBlockStore.getState().clear();
      useEditorStore.getState().fromJSON({ sessions: [], activeSessionId: null });
      void usePluginStore.getState().deactivate();
    }
  },

  loadRecent: async () => {
    const recent = await listProjects(10);
    set({ recent });
  },

  setDirty: (dirty) => {
    if (dirty) editRevision += 1;
    set({ dirty });
  },
  setStatus: (status, statusText = null) => set({ status, statusText }),

  applyPluginParams: async () => {
    const session = projectSession;
    const projectId = get().project?.id;
    if (!projectId) return;
    const params = await usePluginStore.getState().getAllParams();
    if (!isCurrentSession(session, projectId)) return;
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

  applyEditor: () => {
    const { project } = get();
    if (!project) return;
    const { sessions, activeSessionId } = useEditorStore.getState().toJSON();
    const workbenchMode = useAppStore.getState().mode;
    set({
      project: {
        ...project,
        state: {
          ...project.state,
          editorSessions: sessions,
          activeEditorSession: activeSessionId,
          workbenchMode,
        },
      },
    });
  },

  addDataFile: async (file) => {
    const { project } = get();
    if (!project) return null;
    const session = projectSession;
    // Boundary check: data files are stored/parsed as text. Binary picks must
    // go through the scientific import pipeline (useFileRouting), which
    // decodes them to CSV first.
    if (!isSupportedDataFileName(file.name)) {
      throw new Error(`unsupported data file format: ${file.name}`);
    }
    const content = await file.text();
    if (!isCurrentSession(session, project.id)) return null;
    // Re-read AFTER the await. Large/scientific imports parse for a while
    // before reaching here; using the pre-await snapshot previously replaced
    // the *whole* project object (potentially a different project the user
    // switched to mid-import) and clobbered the global file registry.
    const current = get().project;
    if (!current) return null;
    const entry: FileEntry = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || 'text/plain',
      format: fileExtension(file.name),
      content,
    };
    const files = [...current.data.files, entry];
    set({ project: { ...current, data: { ...current.data, files } }, dirty: true });
    // Keep the runtime file registry in sync so flow/block can resolve it.
    setProjectFiles(files);
    return entry.id;
  },

  removeDataFile: (id) => {
    const { project } = get();
    if (!project) return;
    const files = project.data.files.filter((f) => f.id !== id);
    set({ project: { ...project, data: { ...project.data, files } }, dirty: true });
    setProjectFiles(files);
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
  // mark the project dirty when an editor session mutates
  on(EDITOR_STATE_CHANGED, () => useProjectStore.getState().setDirty(true));
}
