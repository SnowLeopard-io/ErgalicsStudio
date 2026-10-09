import { create } from 'zustand';
import type { FileEntry, Project } from '@/types/project';
import {
  createEmptyProject,
  DEFAULT_PROJECT_NAME,
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
  deleteFileChunks,
  deleteCoursePartition,
} from '@/core/storage';
import { OpfsChunkStore } from '@/core/opfs';
import { logger } from '@/core/logger';
import { useSettingsStore } from './settingsStore';
import { usePluginStore } from './pluginStore';
import { BLOCK_GRAPH_CHANGED, useBlockStore } from './blockStore';
import { EDITOR_STATE_CHANGED, useEditorStore } from './editorStore';
import { useAppStore } from './appStore';
import type { BlockGraphState } from '@/types/block';
import type { WorkbenchMode } from '@/types/editor';
import { on } from '@/core/events';
import { t } from '@/i18n';
import { getGitAdapter } from '@/core/git';
import { commitWorkingTree, generateCommitMessage } from '@/core/git/autoCommit';
import type { AutoCommitType } from '@/core/git/autoCommit';
import type { GitStatus, GitCommit, GitBranch, DiffResult } from '@/core/git/types';
import type { RunRecord } from '@/core/experiment/record';

// Re-exported for existing consumers (GitPanel).
export { generateCommitMessage };

export type ProjectStatus =
  | 'ready'
  | 'saving'
  | 'saved'
  | 'computing'
  | 'loading'
  | 'error';

export interface GitRepoInfo {
  isRepo: boolean;
  status: GitStatus | null;
  branches: GitBranch[];
  currentBranch: string;
  remotes: string[];
}

interface ProjectStore {
  project: Project | null;
  recent: Project[];
  dirty: boolean;
  status: ProjectStatus;
  statusText: string | null;

  // Git integration
  gitRepo: GitRepoInfo | null;
  gitCommits: GitCommit[];
  gitLoading: boolean;

  createProject: (name: string) => Promise<Project>;
  openProject: (id: string) => Promise<void>;
  loadProjectFromText: (raw: string) => Promise<Project>;
  /** Import a folder picked by the user (webkitdirectory input) as a project:
   *  a folder containing `project.clproj` imports as a native project with
   *  its runtime state, any other folder becomes a fresh project named after
   *  the folder. All files are mirrored into the git working tree. */
  importFolder: (files: File[]) => Promise<Project>;
  /** Persist the project. `opts.gitCommit` (manual Ctrl+S) additionally
   *  auto-commits §3.4-style (`save: <name>`); plain save() (autosave,
   *  debounced flush) only mirrors the snapshot into the working tree. */
  save: (opts?: { gitCommit?: boolean }) => Promise<void>;
  saveAs: (fileName?: string) => Promise<void>;
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

  // Git operations
  initGitRepo: (template?: 'standard' | 'minimal') => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  /** §3.4 auto-commit for store-level triggers (figure saved, supplement
   *  exported, …): mirrors the project into the working tree, then commits
   *  only when something actually changed. Never throws. */
  autoCommit: (type: AutoCommitType, details: string) => Promise<void>;
  /** §3.4 auto-commit on run completion: mirrors the run record into
   *  `runs/run-<id>.json` + `runs/index.json` (§3.1) and commits it. */
  autoCommitRun: (run: RunRecord) => Promise<void>;
  gitAdd: (files: string[]) => Promise<void>;
  gitCommit: (message: string) => Promise<string>;
  gitCheckout: (ref: string, create?: boolean) => Promise<void>;
  gitCreateBranch: (name: string, startPoint?: string) => Promise<void>;
  gitMerge: (branch: string) => Promise<void>;
  gitPush: (remote: string, branch: string, setUpstream?: boolean) => Promise<void>;
  gitPull: (remote: string, branch: string) => Promise<void>;
  gitFetch: (remote: string) => Promise<void>;
  gitAddRemote: (name: string, url: string) => Promise<void>;
  /** Clone a remote repo and open it as the active project (US-04:
   *  "File → Open from Git URL"). `targetPath` defaults to a fresh
   *  per-project repo path. */
  gitClone: (
    url: string,
    targetPath?: string,
    branch?: string,
    onProgress?: (phase: string, loaded: number, total: number) => void,
  ) => Promise<Project>;
  loadGitLog: (limit?: number) => Promise<void>;
  getGitDiff: (filePath?: string, staged?: boolean) => Promise<DiffResult[] | undefined>;
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

/** Distinguishes switching away and reopening even the same project id. */
export function getProjectSession(): number {
  return projectSession;
}

function isCurrentSession(session: number, projectId: string): boolean {
  return session === projectSession && useProjectStore.getState().project?.id === projectId;
}

/** Both durable saves and downloads must collect the live runtime state. */
async function collectProjectSnapshot(): Promise<Project | null> {
  const { project } = useProjectStore.getState();
  if (!project) return null;
  const session = projectSession;
  await useProjectStore.getState().applyPluginParams();
  if (!isCurrentSession(session, project.id)) return null;
  useProjectStore.getState().applyBlockGraph();
  useProjectStore.getState().applyEditor();
  return useProjectStore.getState().project;
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
  // Canvas tabs (previews + editor buffers) hold paths of the previous
  // project's repo — a fresh project must not show or edit them.
  useAppStore.setState({ canvasTabs: [], activeTab: null, filePreviews: {}, editorFiles: {} });
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

/** Short debounce after any dirty transition — the durable snapshot should
 *  lag edits by seconds, not by the (minute-scale) autosave interval. */
const DIRTY_FLUSH_DELAY_MS = 2_000;
let dirtyFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDirtyFlush() {
  if (dirtyFlushTimer) clearTimeout(dirtyFlushTimer);
  dirtyFlushTimer = setTimeout(() => {
    dirtyFlushTimer = null;
    const { project, dirty } = useProjectStore.getState();
    if (project && dirty) void useProjectStore.getState().save();
  }, DIRTY_FLUSH_DELAY_MS);
}

export function getProjectRepoPath(project: Project): string {
  // LightningFS resolves paths against its own "/" root: a RELATIVE repo path
  // makes isomorphic-git's internal dirname('x') → '.', which CacheFS cannot
  // look up ("ENOENT: ." — every git op died silently until now). Always
  // hand the adapter an absolute path.
  return `/ergalics-projects/${project.id}`;
}

async function initGitForProject(project: Project, template: 'standard' | 'minimal' = 'standard'): Promise<void> {
  const repoPath = getProjectRepoPath(project);
  const adapter = getGitAdapter();
  const isRepo = await adapter.isRepo(repoPath);
  if (!isRepo) {
    await adapter.init(repoPath, template);
  }
  await syncProjectToRepo(project);
  await refreshGitStatusForProject(project);
}

async function refreshGitStatusForProject(project: Project): Promise<void> {
  const repoPath = getProjectRepoPath(project);
  const adapter = getGitAdapter();
  const isRepo = await adapter.isRepo(repoPath);
  if (!isRepo) {
    useProjectStore.setState({ gitRepo: { isRepo: false, status: null, branches: [], currentBranch: '', remotes: [] } });
    return;
  }
  const [status, branches, remotes] = await Promise.all([
    adapter.status(repoPath),
    adapter.branches(repoPath),
    adapter.remotes(repoPath),
  ]);
  useProjectStore.setState({
    gitRepo: {
      isRepo: true,
      status,
      branches,
      currentBranch: status.currentBranch,
      remotes: remotes.map(r => r.name),
    },
  });
}

/** Build a Conventional-Commit subject (§3.4). Implementation lives in
 *  `@/core/git/autoCommit` (pure, unit-testable); re-exported above. */

/**
 * Mirror the current project snapshot into the repo working tree
 * (`project.clproj`) so the Git panel sees real, reviewable changes and
 * commits capture the full project state. Best-effort: failures never
 * block the normal IndexedDB save path.
 */
async function syncProjectToRepo(project: Project): Promise<void> {
  try {
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    if (!(await adapter.isRepo(repoPath))) return;
    await adapter.writeFile(repoPath, 'project.clproj', serializeProject(project));
  } catch (err) {
    logger.warn('project', 'git working-tree sync failed', err);
  }
}

/** Best-effort immediate save when the page is about to go away. IndexedDB
 *  commits usually survive pagehide; together with the debounced flush this
 *  closes the refresh window that lost recent edits. */
function flushDirtyOnExit() {
  if (dirtyFlushTimer) {
    clearTimeout(dirtyFlushTimer);
    dirtyFlushTimer = null;
  }
  const { project, dirty } = useProjectStore.getState();
  if (project && dirty) void useProjectStore.getState().save();
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  recent: [],
  dirty: false,
  status: 'ready',
  statusText: null,
  gitRepo: null,
  gitCommits: [],
  gitLoading: false,

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
    useAppStore.setState({ canvasTabs: [], activeTab: null, filePreviews: {}, editorFiles: {} });
    void usePluginStore.getState().deactivate();
    useAppStore.getState().setMode('standard');
    set({ project, dirty: false, status: 'ready', statusText: null });
    syncProjectFiles(project);
    ensureAutosave();
    await get().loadRecent();
    // Initialize Git repo for new project
    void get().initGitRepo('standard');
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

  /** Import a user-picked folder as a project (see interface doc). */
  importFolder: async (files) => {
    const seq = ++openSeq;
    const relOf = (f: File) =>
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name || '';
    // Project name = picked folder's name (first path segment).
    let rootName = '';
    for (const f of files) {
      const parts = relOf(f).split('/');
      const root = parts[0];
      if (root && parts.length > 1) {
        rootName = root;
        break;
      }
    }
    // Flatten to project-relative paths; skip .git internals and the project
    // JSON itself (imported separately below).
    const entries: Array<{ path: string; file: File }> = [];
    let clproj: File | null = null;
    for (const f of files) {
      const parts = relOf(f).split('/');
      if (parts.some((p) => p === '.git')) continue;
      const inner = rootName && parts[0] === rootName ? parts.slice(1).join('/') : parts.join('/');
      if (!inner) continue;
      if (parts.length <= 2 && parts[parts.length - 1] === 'project.clproj') {
        clproj = f;
        continue;
      }
      entries.push({ path: inner, file: f });
    }

    // A folder carrying project.clproj is a native project: its JSON carries
    // the runtime state (block graph, editor sessions…). Any other folder
    // simply becomes a fresh project named after the folder.
    const project = clproj
      ? deserializeProject(await clproj.text())
      : createEmptyProject(rootName || 'Imported project');
    await saveProject(project);
    if (seq !== openSeq) return project;

    // Mirror every file into the working tree, then activate the project
    // IMMEDIATELY — the user sees the imported tree right away. Git is not
    // required for browsing/editing, so repo initialization is deferred and
    // fire-and-forget: a git failure must never lose the import.
    let failed = 0;
    for (const { path, file } of entries) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await getGitAdapter().writeFileBinary(getProjectRepoPath(project), path, bytes);
      } catch (err) {
        failed += 1;
        logger.warn('project', `folder import: failed to write ${path}`, err);
      }
    }
    if (seq !== openSeq) return project;

    useAppStore.getState().setMode('standard');
    applyOpenedProject(project);
    useAppStore.getState().bumpFileOps();
    if (failed > 0) {
      useAppStore.getState().notify('error', t('project.import_partial', { count: String(failed) }));
    }
    // Deferred, non-fatal git init ('minimal': no skeleton seeding — the tree
    // mirrors the picked folder). bumpFileOps afterwards so the explorer
    // re-probes the repo and the Git panel comes alive once ready.
    void initGitForProject(project, 'minimal')
      .then(() => {
        if (seq === openSeq) useAppStore.getState().bumpFileOps();
      })
      .catch((err) => logger.warn('project', 'deferred git init failed (import)', err));
    return project;
  },

  save: async (opts) => {
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
      const current = await collectProjectSnapshot();
      if (!isCurrentSession(session, project.id)) return;
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
      // Mirror the snapshot into the Git working tree (fire-and-forget) so
      // the Git panel shows reviewable changes right after any save. A
      // manual save (Ctrl+S, opts.gitCommit) additionally commits §3.4-style;
      // autosave/debounced flush never commit.
      void syncProjectToRepo(touched).then(() => {
        if (opts?.gitCommit) {
          void get().autoCommit('save', touched.name || touched.id);
        }
      });
    } catch (err) {
      logger.error('project', 'save failed', err);
      if (isCurrentSession(session, project.id)) set({ status: 'error' });
      // EG3-111: the status flag alone left the failure invisible (the status
      // bar showed the host status). Surface it in the toast layer as well.
      useAppStore.getState().notify('error', t('project.save_failed'));
    }
    setTimeout(() => {
      if (seq === saveSeq && isCurrentSession(session, project.id) && get().status === 'saved') {
        set({ status: 'ready' });
      }
    }, 1500);
  },

  saveAs: async (fileName) => {
    try {
      const project = await collectProjectSnapshot();
      if (!project) return;
      const json = serializeProject(project);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName ?? project.name ?? 'project'}.clproj`;
      a.click();
      // Allow the browser to begin fetching the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      logger.error('project', 'export failed', err);
      useAppStore.getState().notify('error', t('project.save_failed'));
    }
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
    // Same cascade for the auxiliary stores keyed by projectId: legacy IDB
    // file chunks (FR-17), the course-mode partition (FR-13) and the OPFS
    // chunk copies. Without these, deleting a project silently leaks its
    // largest stored data until the user manually clears the whole cache.
    await deleteFileChunks(id).catch(() => undefined);
    await deleteCoursePartition(id).catch(() => undefined);
    await new OpfsChunkStore().removeProject(id).catch(() => undefined);
    await get().loadRecent();
    if (get().project?.id === id) {
      projectSession += 1;
      set({ project: null, dirty: false, status: 'ready', statusText: null });
      syncProjectFiles(null);
      // Clear the block graph, editor sessions and active plugin so the
      // canvas/editor never keep showing the deleted project's content.
      useBlockStore.getState().clear();
      useEditorStore.getState().fromJSON({ sessions: [], activeSessionId: null });
      useAppStore.setState({ canvasTabs: [], activeTab: null, filePreviews: {}, editorFiles: {} });
      void usePluginStore.getState().deactivate();
    }
  },

  loadRecent: async () => {
    const recent = await listProjects(10);
    set({ recent });
  },

  setDirty: (dirty) => {
    if (dirty) {
      editRevision += 1;
      // The autosave interval can be up to a minute away; a refresh inside
      // that window silently discards the last edits (e.g. a deleted figure
      // panel "reappearing" after reload). Follow the dirty flag with a short
      // debounce so the durable snapshot lags edits by seconds, not minutes.
      scheduleDirtyFlush();
    }
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
          activePlugin: usePluginStore.getState().activeId,
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
    // Same-name uploads replace the existing entry (id kept stable) so
    // re-importing a file never grows duplicate rows in the data area.
    const existing = current.data.files.find((f) => f.name === file.name);
    const entry: FileEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || 'text/plain',
      format: fileExtension(file.name),
      content,
    };
    const files = existing
      ? current.data.files.map((f) => (f.id === existing.id ? entry : f))
      : [...current.data.files, entry];
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
    // Legacy chunked-storage cleanup (FR-17): a file ingested by an older
    // build keeps IDB chunks + an OPFS copy that inline-entry removal cannot
    // reach, so the bytes would stay parked in storage forever.
    void deleteFileChunks(project.id, id).catch(() => undefined);
    void new OpfsChunkStore().removeFile(project.id, id).catch(() => undefined);
  },

  // Git operations
  initGitRepo: async (template = 'standard') => {
    const { project } = get();
    if (!project) return;
    await initGitForProject(project, template);
  },

  refreshGitStatus: async () => {
    const { project } = get();
    if (!project) return;
    await refreshGitStatusForProject(project);
  },

  autoCommit: async (type, details) => {
    const { project } = get();
    if (!project) return;
    try {
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      if (!(await adapter.isRepo(repoPath))) return;
      // Capture the live project state before diffing so the commit carries
      // the change that triggered it, not just the last durable snapshot.
      await syncProjectToRepo(project);
      const hash = await commitWorkingTree(adapter, repoPath, generateCommitMessage(type, details), () =>
        refreshGitStatusForProject(project),
      );
      if (hash) void get().loadGitLog();
    } catch (err) {
      // §3.4 is best-effort: an auto-commit failure must never break the
      // feature that triggered it (the run/figure/export already succeeded).
      logger.warn('project', `auto-commit (${type}) failed`, err);
    }
  },

  autoCommitRun: async (run) => {
    const { project } = get();
    if (!project) return;
    try {
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      if (!(await adapter.isRepo(repoPath))) return;
      // §3.1: every run becomes runs/run-<id>.json plus an index entry
      // (runId → {label, source, createdAt, hash}).
      await adapter.writeFile(repoPath, `runs/${run.id}.json`, JSON.stringify(run, null, 2));
      let index: Record<string, unknown> = {};
      try {
        index = JSON.parse(await adapter.readFile(repoPath, 'runs/index.json')) as Record<string, unknown>;
      } catch {
        // First run — start a fresh index.
      }
      index[run.id] = {
        label: run.label,
        source: run.source,
        createdAt: run.createdAt,
        hash: run.inputsHash ?? null,
      };
      await adapter.writeFile(repoPath, 'runs/index.json', JSON.stringify(index, null, 2));
      await syncProjectToRepo(project);
      const hash = await commitWorkingTree(
        adapter,
        repoPath,
        generateCommitMessage('run', `${run.label ?? run.source} (source=${run.source})`),
        () => refreshGitStatusForProject(project),
      );
      if (hash) void get().loadGitLog();
    } catch (err) {
      logger.warn('project', 'run auto-commit failed', err);
    }
  },

  gitAdd: async (files: string[]) => {
    const { project } = get();
    if (!project) return;
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.add(repoPath, files);
    await refreshGitStatusForProject(project);
  },

  gitCommit: async (message: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    // Capture the live project state, not whatever the last save left.
    await syncProjectToRepo(project);
    const hash = await adapter.commit(repoPath, message);
    await refreshGitStatusForProject(project);
    await get().loadGitLog();
    return hash;
  },

  gitCheckout: async (ref: string, create = false) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.checkout(repoPath, ref, create);
    await refreshGitStatusForProject(project);
  },

  gitCreateBranch: async (name: string, startPoint?: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.branch(repoPath, name, startPoint);
    await refreshGitStatusForProject(project);
  },

  gitMerge: async (branch: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    const result = await adapter.merge(repoPath, branch);
    if (!result.success && result.conflicts && result.conflicts.length > 0) {
      throw new Error(`Merge conflicts in: ${result.conflicts.join(', ')}`);
    }
    await refreshGitStatusForProject(project);
  },

  gitPush: async (remote: string, branch: string, setUpstream = false) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.push(repoPath, { remote, branch, setUpstream });
    await refreshGitStatusForProject(project);
  },

  gitPull: async (remote: string, branch: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.pull(repoPath, { remote, branch });
    await refreshGitStatusForProject(project);
  },

  gitFetch: async (remote: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.fetch(repoPath, remote);
    await refreshGitStatusForProject(project);
  },

  gitAddRemote: async (name: string, url: string) => {
    const { project } = get();
    if (!project) throw new Error('No project open');
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    await adapter.addRemote(repoPath, name, url);
    await refreshGitStatusForProject(project);
  },

  gitClone: async (url, targetPath, branch, onProgress) => {
    const adapter = getGitAdapter();
    // Clone into a fresh per-project repo path (US-04: one click, then the
    // cloned project opens directly in the workbench).
    const seed = createEmptyProject('Cloned Project');
    const repoPath = targetPath || getProjectRepoPath(seed);
    await adapter.clone(url, repoPath, { branch, onProgress });

    // A git-backed project must carry a project.clproj at its root (§3.1).
    const raw = await adapter.readFile(repoPath, 'project.clproj');
    const project = deserializeProject(raw);
    // Detach from the source project's identity: this installation owns its
    // own IndexedDB record and repo path.
    project.id = seed.id;
    if (!project.name || project.name === DEFAULT_PROJECT_NAME) project.name = 'Cloned Project';

    const seq = ++openSeq;
    await saveProject(project);
    if (seq !== openSeq) return project;
    applyOpenedProject(project);
    await refreshGitStatusForProject(project);
    return project;
  },

  loadGitLog: async (limit = 50) => {
    const { project } = get();
    if (!project) {
      set({ gitCommits: [] });
      return;
    }
    set({ gitLoading: true });
    try {
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      const commits = await adapter.log(repoPath, { limit });
      set({ gitCommits: commits, gitLoading: false });
    } catch {
      set({ gitCommits: [], gitLoading: false });
    }
  },

  getGitDiff: async (filePath?: string, staged = false) => {
    const { project } = get();
    if (!project) return;
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    const diffs = await adapter.diff(repoPath, { filePath, staged });
    // Store diffs in state if needed
    // For now, just return them
    return diffs;
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
  // Flush pending edits when the page is hidden or unloaded (refresh inside
  // the autosave interval would otherwise discard them).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDirtyOnExit();
  });
  window.addEventListener('pagehide', flushDirtyOnExit);
}
