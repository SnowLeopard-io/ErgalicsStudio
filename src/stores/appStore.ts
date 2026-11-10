import { create } from 'zustand';
import { logger } from '@/core/logger';
import { COMPACT_VIEWPORT_QUERY } from '@/core/orientation';
import { t } from '@/i18n';
import { flushEditorFile } from './editorFlush';
import type { PluginHostStatus } from '@/types/plugin';
import type { WorkbenchMode } from '@/types/editor';

export interface Banner {
  id: number;
  kind: 'info' | 'warning' | 'error';
  messageKey: string;
  /** Interpolation values for `messageKey` (e.g. a list of file extensions). */
  params?: Record<string, string | number>;
  dismissible?: boolean;
  /** Plugin id this banner refers to, when applicable. */
  pluginId?: string;
}

export interface Notification {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  /**
   * Optional call-to-action rendered as a button on the toast (e.g. a
   * background compute offering "view results"). Clicking it runs `run` and
   * dismisses the toast.
   */
  action?: { label: string; run: () => void };
}

export interface PerfMetrics {
  fps: number;
  frameMs: number;
  gpuMs: number;
  memoryMb: number;
  dataScale: number;
  /** JS heap usage (usedJSHeapSize), MiB. 0 when unsupported. */
  jsHeapMb: number;
  /** Coarse device RAM heuristic (navigator.deviceMemory), MiB. 0 when unknown. */
  deviceMemoryMb: number;
  /** Total rendered frames since the monitor started. */
  totalFrames: number;
  /** Average FPS since the monitor started. */
  avgFps: number;
  /** Worst frame time seen in the current sampling window, ms. */
  maxFrameMs: number;
  /** Seconds since the monitor started. */
  uptimeSec: number;
  warnings: {
    fps: boolean;
    memory: boolean;
    compute: boolean;
  };
}

const DEFAULT_PERF: PerfMetrics = {
  fps: 0,
  frameMs: 0,
  gpuMs: 0,
  memoryMb: 0,
  dataScale: 0,
  jsHeapMb: 0,
  deviceMemoryMb: 0,
  totalFrames: 0,
  avgFps: 0,
  maxFrameMs: 0,
  uptimeSec: 0,
  warnings: { fps: false, memory: false, compute: false },
};

/** Which view the standard-mode sidebar shows (driven by the activity bar). */
export type SidebarView = 'files' | 'plugins' | 'git' | 'tools' | 'research';

/** Kind of the central file preview — decides which view CentralArea renders. */
export type FilePreviewKind =
  | 'text'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'unknown';

/** A file opened for preview in the central canvas area. */
export interface FilePreviewState {
  /** Display name (file name with extension). */
  name: string;
  /** Full path within the project tree (shown as tooltip). */
  path: string;
  /** Preview kind — decides which view CentralArea renders. */
  kind: FilePreviewKind;
  /** Detected MIME type for the file. */
  mimeType: string;
  /** Text-like content (kind=text/markdown). */
  content?: string;
  /** Binary blob URL (kind=image/pdf/video/audio; created by the opener,
   *  revoked by the closer). */
  blobUrl?: string;
  /** File size in bytes. */
  size: number;
}

/** Which editor a file opens with inside an editor tab (design doc P1).
 *  `code` → Monaco (py/js/r), `block` → Blockly (ergalics-block JSON),
 *  `flow` → DAG canvas (ergalics-flow JSON). */
export type FileEditorKind = 'code' | 'block' | 'flow';

/** Live buffer state for one open editor tab. The store owns the payload so
 *  "save & close" (from the tab strip) can write without reaching into the
 *  editor component; editors push their debounced buffer via
 *  `updateEditorFile`. */
export interface EditorFileState {
  name: string;
  path: string;
  editor: FileEditorKind;
  /** Code text (code editor) or serialized JSON payload (block/flow). */
  payload: string;
  dirty: boolean;
  /** True when the content failed to parse as its editor format — the tab
   *  degrades to a read-only source view with a warning banner. */
  broken?: boolean;
}

/** One tab in the canvas tab strip: a file preview, an editable file, an
 *  embedded research suite or the settings page. `key` is the stable identity
 *  used for activation and closing. */
export type CanvasTab =
  | { kind: 'file'; key: string; path: string }
  | { kind: 'editor'; key: string; path: string; editor: FileEditorKind }
  /** A workbench surface (flow / block / code) embedded in the canvas. The
   *  four modes are tabs now, not full-page swaps: the explorer and side
   *  panels stay put while the surface occupies the editor area. `path` is
   *  the file the surface is currently editing (its tab label), so the strip
   *  always points at a real file instead of a generic "代码" label. */
  | { kind: 'surface'; key: string; mode: WorkbenchMode; path?: string }
  | { kind: 'tool'; key: string; id: string }
  | { kind: 'settings'; key: string };

/** Tab key for a file preview tab. */
export const fileTabKey = (path: string): string => `file:${path}`;

/** Tab key for a file editor tab. */
export const editorTabKey = (path: string): string => `editor:${path}`;

/** Tab key for an embedded workbench surface (flow / block / code). A surface
 *  bound to a file gets its own key so several sources can stay open at once
 *  (e.g. `a.py` and `b.py`), each with its own editor session. */
export const surfaceTabKey = (mode: WorkbenchMode, path?: string): string =>
  path ? `surface:${mode}:${path}` : `surface:${mode}`;

/** Stable tab key for the embedded settings page. */
export const settingsTabKey = 'settings:app';

/** Stop the active plugin, if any. Lazy import keeps appStore free of a
 *  pluginStore cycle. Fire-and-forget: callers never need the result. The
 *  plugin id is remembered (`lastActivePluginId`) so the canvas plugin tab
 *  can bring it back when the user switches to it. */
function deactivatePluginLazy(): void {
  void import('./pluginStore')
    .then((m) => {
      const ps = m.usePluginStore.getState();
      if (!ps.activeId) return;
      useAppStore.setState({ lastActivePluginId: ps.activeId });
      return ps.deactivate();
    })
    .catch((err) => logger.error('appStore', 'plugin deactivate failed', err));
}
/** Tab key for an embedded suite tab. */
export const toolTabKey = (id: string): string => `tool:${id}`;

interface AppStore {
  status: PluginHostStatus;
  banners: Banner[];
  notifications: Notification[];
  perf: PerfMetrics;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  /** Active workbench mode (Standard | Flow | Block | Code). */
  mode: WorkbenchMode;
  /** Current sidebar view (activity bar selection in Standard mode). */
  sidebarView: SidebarView;
  /**
   * Canvas tab strip (VS Code editor-area style): files opened from the
   * explorer and research suites embedded from the launcher share one tab
   * list. Tool tabs stay mounted while hidden so tool state survives; file
   * editor tabs mount only while focused, because Monaco/Blockly instances
   * are heavy and keeping every open file alive was a multi-file bottleneck.
   * Edit buffers live in `editorFiles`, so switching tabs loses nothing.
   */
  canvasTabs: CanvasTab[];
  /** Active tab key (fileTabKey / toolTabKey), or null when none is open. */
  activeTab: string | null;
  /** Per-path preview state for every open file tab (content / blobUrl…). */
  filePreviews: Record<string, FilePreviewState>;
  /** Live buffer state for every open editor tab, keyed by editorTabKey. */
  editorFiles: Record<string, EditorFileState>;
  /** Monotonic bump whenever the working tree changes from outside the
   *  FileExplorer (e.g. an MD preview save). Explorer subscribes to it to
   *  refresh its listings. */
  fileOpsVersion: number;

  setStatus: (status: PluginHostStatus) => void;
  addBanner: (kind: Banner['kind'], messageKey: string) => void;
  setBanner: (messageKey: string, params?: Record<string, string | number>) => void;
  removeBanner: (id: number) => void;
  setError: (pluginId: string) => void;
  notify: (kind: Notification['kind'], message: string, action?: Notification['action']) => void;
  dismissNotification: (id: number) => void;

  setFps: (fps: number, frameMs: number) => void;
  setGpuMs: (ms: number) => void;
  setMemoryMb: (mb: number) => void;
  setDataScale: (n: number) => void;
  setWarnings: (w: Partial<PerfMetrics['warnings']>) => void;
  /** Push cumulative/lifetime stats from the performance monitor. */
  setPerfTotals: (totals: { totalFrames: number; avgFps: number; maxFrameMs: number; uptimeSec: number }) => void;
  /** Push memory readings (JS heap + device RAM). */
  setPerfMemory: (jsHeapMb: number, deviceMemoryMb: number) => void;

  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  /** Select a workbench mode. Standard returns to the plugin canvas; the three
   *  editing surfaces open (or focus) their own canvas tab instead of
   *  replacing the whole page. `path` binds that surface tab to a file. */
  setMode: (mode: WorkbenchMode, path?: string) => void;
  setSidebarView: (view: SidebarView) => void;
  /** Open (or refresh) a file preview tab in the central canvas. */
  openFilePreview: (preview: FilePreviewState) => void;
  /** Open (or focus) an editable file tab (design doc P1). Replaces a plain
   *  preview tab for the same path — one representation per file. */
  openFileEditor: (state: { path: string; name: string; editor: FileEditorKind; payload: string; broken?: boolean }) => void;
  /** Push the editor's live buffer into the store and mark the tab dirty. */
  updateEditorFile: (path: string, payload: string) => void;
  /** Persist the editor buffer to the working tree (git adapter), clear the
   *  dirty flag and bump fileOps so the explorer refreshes. Resolves to
   *  false on failure (notification emitted). */
  saveEditorFile: (path: string) => Promise<boolean>;
  /** Write a live mode buffer straight to the workspace tree. Mode surfaces
   *  are bound to files without an editor tab, so they cannot use the tab
   *  buffer save path. */
  saveWorkspaceFile: (path: string, text: string) => Promise<boolean>;
  /** Persist a batch of files produced by a code run (workspace-relative
   *  paths). Refreshes the explorer once and resolves to the write count. */
  saveWorkspaceFiles: (files: Record<string, string>) => Promise<number>;
  /** Activate a tab by key (no-op if the tab is not open). */
  activateTab: (key: string) => void;
  /** Show the plugin canvas: clears the active tab without closing any tab —
   *  open file/suite tabs stay in the strip and can be switched back to. */
  showPluginCanvas: () => void;
  /** Brand-click "home": reset the central area to the boot state — every
   *  open tab closes (file blob URLs revoked, editor buffers dropped) and
   *  the plugin canvas deactivates (not remembered for restore), so the
   *  empty-canvas welcome screen shows again. */
  resetToWelcome: () => void;
  /** Last plugin id auto-deactivated when a canvas tab covered the canvas —
   *  used by `showPluginCanvas` to restore it. */
  lastActivePluginId: string | null;
  /** Close one tab (file or suite); activates the nearest remaining tab. */
  closeTab: (key: string) => void;
  /** Reorder the canvas tab strip by drag: move `fromKey` to sit at
   *  `toKey`'s position. No-op unless both tabs exist. */
  reorderTabs: (fromKey: string, toKey: string) => void;
  /** Update a file tab's path/name after an explorer rename, preserving
   *  content so the open preview survives the rename. */
  renameFileTab: (oldPath: string, name: string, newPath: string) => void;
  /** Embed (or close, with null) a research suite in the central canvas. */
  setEmbeddedTool: (id: string | null) => void;
  /** Open (or focus) the settings page as an embedded canvas tab instead of
   *  a standalone route — same contract as file/suite tabs. */
  openSettingsTab: () => void;
  bumpFileOps: () => void;
}

let bannerId = 0;
let notifId = 0;
/** Track notification auto-dismiss timers so an early dismiss cancels them. */
const notifTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Warn when GPU memory exceeds 80% of this assumed budget (spec §7.3). */
const MEMORY_WARN_MB = 0.8 * 512;

/** Panel visibility persists across reloads so a deliberately closed sidebar
 *  (or code/flow panel) stays closed next launch. */
const PANEL_PREFS_KEY = 'ergalics:panel-prefs';
const PANEL_DEFAULTS = {
  sidebarOpen: true,
  rightPanelOpen: true,
  sidebarView: 'plugins' as SidebarView,
};

const SIDEBAR_VIEWS: readonly SidebarView[] = ['files', 'plugins', 'git', 'tools', 'research'];

/** Phone-sized touch viewport (landscape phones match this query — see
 *  core/orientation.ts COMPACT_VIEWPORT_QUERY, which the CSS compact tier
 *  mirrors). Desktop windows never match, so their panel defaults are
 *  untouched. */
function compactTouchViewport(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return (
      window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia(COMPACT_VIEWPORT_QUERY).matches
    );
  } catch {
    return false;
  }
}

/** First-paint defaults: a phone has no room for both side panels docked —
 *  they float over the canvas on that tier (app.css compact block), so they
 *  start collapsed and are one tap away. A persisted user choice always
 *  wins over this. */
function defaultPanelPrefs(): typeof PANEL_DEFAULTS {
  const defaults = { ...PANEL_DEFAULTS };
  if (compactTouchViewport()) {
    defaults.sidebarOpen = false;
    defaults.rightPanelOpen = false;
  }
  return defaults;
}

function loadPanelPrefs(): typeof PANEL_DEFAULTS {
  try {
    const raw = localStorage.getItem(PANEL_PREFS_KEY);
    if (!raw) return defaultPanelPrefs();
    const parsed = JSON.parse(raw) as Partial<typeof PANEL_DEFAULTS>;
    return {
      sidebarOpen: parsed.sidebarOpen ?? PANEL_DEFAULTS.sidebarOpen,
      rightPanelOpen: parsed.rightPanelOpen ?? PANEL_DEFAULTS.rightPanelOpen,
      sidebarView: SIDEBAR_VIEWS.includes(parsed.sidebarView as SidebarView)
        ? (parsed.sidebarView as SidebarView)
        : PANEL_DEFAULTS.sidebarView,
    };
  } catch {
    return defaultPanelPrefs();
  }
}

const persistPanelPrefs = (s: {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  sidebarView: SidebarView;
}) => {
  try {
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — prefs simply do not persist */
  }
};

export const useAppStore = create<AppStore>((set, get) => {
  const panelPrefs = loadPanelPrefs();
  return {
  status: 'ready',
  banners: [],
  notifications: [],
  perf: DEFAULT_PERF,
  sidebarOpen: panelPrefs.sidebarOpen,
  rightPanelOpen: panelPrefs.rightPanelOpen,
  sidebarView: panelPrefs.sidebarView,
  canvasTabs: [],
  activeTab: null,
  filePreviews: {},
  editorFiles: {},
  lastActivePluginId: null,
  fileOpsVersion: 0,
  mode: 'standard',

  setStatus: (status) => set({ status }),

  addBanner: (kind, messageKey) => {
    const existing = get().banners.some((b) => b.messageKey === messageKey);
    if (existing) return;
    set((s) => ({
      banners: [...s.banners, { id: ++bannerId, kind, messageKey, dismissible: true }],
    }));
  },
  setBanner: (messageKey, params) => {
    const existing = get().banners.some((b) => b.messageKey === messageKey);
    if (existing) return;
    set((s) => ({
      banners: [
        ...s.banners,
        { id: ++bannerId, kind: 'error', messageKey, params, dismissible: true },
      ],
    }));
  },
  removeBanner: (id) =>
    set((s) => ({ banners: s.banners.filter((b) => b.id !== id) })),
  setError: (pluginId) => {
    // pluginStore passes ids prefixed with `plugin:`; strip for display.
    const raw = pluginId.startsWith('plugin:') ? pluginId.slice('plugin:'.length) : pluginId;
    // Dedup like addBanner/setBanner: repeated failures for the same plugin
    // used to stack an unbounded list of identical crash banners.
    const existing = get().banners.some(
      (b) => b.messageKey === 'error.plugin_crash' && b.pluginId === raw,
    );
    if (existing) return;
    set((s) => ({
      banners: [...s.banners, { id: ++bannerId, kind: 'error', messageKey: 'error.plugin_crash', dismissible: true, pluginId: raw }],
    }));
  },
  notify: (kind, message, action) => {
    const id = ++notifId;
    set((s) => ({ notifications: [...s.notifications, { id, kind, message, action }] }));
    // Ambience: a quiet cue per toast kind. Lazy import keeps the core store
    // free of the audio module; a failure must never affect the toast itself.
    void import('@/core/ambience/audio')
      .then(({ playCue }) => {
        if (kind === 'success') playCue('success');
        else if (kind === 'error') playCue('error');
        else playCue('notify');
      })
      .catch(() => undefined);
    // Action toasts stay up longer so the user can actually click through.
    const ttl = action ? 8000 : 4000;
    const timer = setTimeout(() => {
      notifTimers.delete(id);
      get().dismissNotification(id);
    }, ttl);
    notifTimers.set(id, timer);
  },
  dismissNotification: (id) => {
    // Cancelling the pending auto-dismiss keeps a dismissed notification from
    // being re-filtered later and stops the timer from firing after unmount.
    const timer = notifTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      notifTimers.delete(id);
    }
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  setFps: (fps, frameMs) =>
    set((s) => ({ perf: { ...s.perf, fps, frameMs, warnings: { ...s.perf.warnings, fps: fps < 30 && fps > 0 } } })),
  setGpuMs: (ms) =>
    set((s) => ({ perf: { ...s.perf, gpuMs: ms, warnings: { ...s.perf.warnings, compute: ms > 50 } } })),
  setMemoryMb: (memoryMb) =>
    set((s) => ({
      perf: {
        ...s.perf,
        memoryMb,
        warnings: { ...s.perf.warnings, memory: memoryMb > MEMORY_WARN_MB },
      },
    })),
  setDataScale: (n) => set((s) => ({ perf: { ...s.perf, dataScale: n } })),
  setWarnings: (w) => set((s) => ({ perf: { ...s.perf, warnings: { ...s.perf.warnings, ...w } } })),
  setPerfTotals: (totals) =>
    set((s) => ({ perf: { ...s.perf, ...totals } })),
  setPerfMemory: (jsHeapMb, deviceMemoryMb) =>
    set((s) => ({ perf: { ...s.perf, jsHeapMb, deviceMemoryMb } })),

  toggleSidebar: () =>
    set((s) => {
      const next = { ...s, sidebarOpen: !s.sidebarOpen };
      persistPanelPrefs(next);
      return next;
    }),
  toggleRightPanel: () =>
    set((s) => {
      const next = { ...s, rightPanelOpen: !s.rightPanelOpen };
      persistPanelPrefs(next);
      return next;
    }),
  setMode: (mode, path) => {
    // Standard is the canvas baseline (plugin host), not a tab: returning to
    // it clears the active tab and brings the plugin canvas back.
    if (mode === 'standard') {
      set({ mode });
      get().showPluginCanvas();
      return;
    }
    const key = surfaceTabKey(mode, path);
    set((s) => {
      // Mode button without a file: focus an already-open surface of that
      // mode instead of spawning a second generic one.
      if (!path) {
        const existing = s.canvasTabs.find((tab) => tab.kind === 'surface' && tab.mode === mode);
        if (existing) return { mode, activeTab: existing.key };
      }
      const exists = s.canvasTabs.some((tab) => tab.key === key);
      return {
        mode,
        canvasTabs: exists
          ? s.canvasTabs.map((tab) =>
              tab.key === key && tab.kind === 'surface' && path !== undefined
                ? { ...tab, path }
                : tab,
            )
          : [...s.canvasTabs, { kind: 'surface' as const, key, mode, path }],
        activeTab: key,
      };
    });
    // The surface tab covers the plugin canvas; stop its rendering loop.
    deactivatePluginLazy();
  },

  /** Activity-bar click: switch the sidebar view and open the sidebar.
   *  Clicking the already-active view while open collapses the sidebar
   *  (VS Code behaviour) — a second click re-opens it. */
  setSidebarView: (view) => {
    const s = get();
    if (view === s.sidebarView && s.sidebarOpen) {
      // Don't flip sidebarOpen here: the Sidebar component listens for this
      // event and plays its panel-collapse exit animation before toggling,
      // so collapsing via the activity bar animates like the edge button.
      window.dispatchEvent(new CustomEvent('ergalics:collapse-sidebar'));
      return;
    }
    set((st) => {
      const next = { ...st, sidebarView: view, sidebarOpen: true };
      persistPanelPrefs(next);
      return next;
    });
  },

  /** Open (or refresh) a file preview tab in the canvas area. Re-opening the
   *  same path replaces its state (revoking a replaced binary blob URL so
   *  memory is not leaked) and activates its tab; other tabs stay open and
   *  mounted — switching tabs never discards their state. */
  openFilePreview: (preview) => {
    const key = fileTabKey(preview.path);
    set((s) => {
      const old = s.filePreviews[key];
      if (old?.blobUrl && preview.blobUrl !== old.blobUrl) {
        try {
          URL.revokeObjectURL(old.blobUrl);
        } catch {
          /* already revoked / not a usable URL */
        }
      }
      return {
        filePreviews: { ...s.filePreviews, [key]: preview },
        canvasTabs: s.canvasTabs.some((tab) => tab.key === key)
          ? s.canvasTabs
          : [...s.canvasTabs, { kind: 'file' as const, key, path: preview.path }],
        activeTab: key,
      };
    });
    // The file preview overlays the plugin canvas — an active plugin would
    // keep painting underneath (and visually hide the preview) otherwise.
    deactivatePluginLazy();
  },

  /** Open (or focus) an editable file tab. A plain preview tab for the same
   *  path is replaced (one representation per file); an already-open editor
   *  tab for the path keeps its live buffer and is merely re-activated. */
  openFileEditor: (state) => {
    const key = editorTabKey(state.path);
    const fileKey = fileTabKey(state.path);
    set((s) => {
      const existing = s.editorFiles[key];
      const canvasTabs = s.canvasTabs.filter((tab) => {
        // Drop the preview tab shadowing this path (the editor takes over).
        if (tab.key === fileKey) return false;
        return true;
      });
      const nextTabs = canvasTabs.some((tab) => tab.key === key)
        ? canvasTabs.map((tab) =>
            tab.key === key && tab.kind === 'editor' ? { ...tab, editor: state.editor } : tab,
          )
        : [...canvasTabs, { kind: 'editor' as const, key, path: state.path, editor: state.editor }];
      return {
        canvasTabs: nextTabs,
        filePreviews: Object.fromEntries(
          Object.entries(s.filePreviews).filter(([k]) => k !== fileKey),
        ),
        editorFiles: existing
          ? existing.dirty
            ? // A dirty buffer always wins — never clobber unsaved edits.
              s.editorFiles
            : // Clean buffer: re-read from disk (picks up external changes and
              // clears a stale `broken` flag once the file parses again).
              {
                ...s.editorFiles,
                [key]: state.broken
                  ? { ...existing, name: state.name, editor: state.editor, payload: state.payload, dirty: false, broken: true }
                  : { name: state.name, path: state.path, editor: state.editor, payload: state.payload, dirty: false },
              }
          : {
              ...s.editorFiles,
              [key]: {
                name: state.name,
                path: state.path,
                editor: state.editor,
                payload: state.payload,
                dirty: false,
                ...(state.broken ? { broken: true } : {}),
              },
            },
        activeTab: key,
      };
    });
    deactivatePluginLazy();
  },

  /** Push the editor's live buffer into the store and mark the tab dirty.
   *  Deliberately does NOT mark the whole project dirty: file-tab buffers are
   *  not part of the project snapshot (they live in `editorFiles` and are
   *  written to the workspace by `saveEditorFile`). Marking the project dirty
   *  made every 300 ms keystroke debounce schedule a full project save —
   *  serializing the complete project (data tables included) every couple of
   *  seconds while typing, a major source of editor lag. The tab's own dirty
   *  flag still drives the dot and the save/discard prompt. */
  updateEditorFile: (path, payload) => {
    const key = editorTabKey(path);
    set((s) => {
      const cur = s.editorFiles[key];
      if (!cur) return s;
      return { editorFiles: { ...s.editorFiles, [key]: { ...cur, payload, dirty: true } } };
    });
  },

  /** Write the buffered payload to the workspace tree. Uses lazy imports (the
   *  workspace root helper lives in projectStore, which imports this store —
   *  a static import would close a cycle). Resolves to false on failure
   *  (a notification is emitted; callers just skip their close). */
  saveEditorFile: async (path) => {
    const key = editorTabKey(path);
    // Pull the live editor content into the store first — the debounced push
    // may be up to 300ms behind the visible buffer.
    flushEditorFile(key);
    const cur = useAppStore.getState().editorFiles[key];
    if (!cur) return false;
    try {
      const [{ useProjectStore, getProjectRepoPath }, { getVfs }] = await Promise.all([
        import('./projectStore'),
        import('@/core/vfs'),
      ]);
      const project = useProjectStore.getState().project;
      if (!project) throw new Error('no project open');
      await getVfs().writeFile(getProjectRepoPath(project), cur.path, cur.payload);
      set((s) => {
        const f = s.editorFiles[key];
        if (!f) return s;
        // Only clear the dirty flag if the buffer still holds what we wrote.
        // If the user kept typing while the two awaits above were in flight,
        // `f.payload !== cur.payload` and clearing dirty would falsely mark
        // those newer edits as saved. (The project itself is not marked dirty
        // here — the workspace write above is the durable copy; the editor
        // buffer is a separate in-memory session.)
        if (f.payload !== cur.payload) return s;
        return { editorFiles: { ...s.editorFiles, [key]: { ...f, dirty: false } } };
      });
      useAppStore.getState().bumpFileOps();
      useAppStore.getState().notify('success', t('workbench.editor.saved'));
      return true;
    } catch (err) {
      logger.error('appStore', 'editor file save failed', err);
      useAppStore.getState().notify('error', t('workbench.editor.save_failed'));
      return false;
    }
  },

  /** Write a live mode buffer straight to the workspace tree. Mode surfaces
   *  bind to files without an editor tab, so they cannot use the tab buffer
   *  save path. Keeps a matching tab buffer in sync when one exists. */
  saveWorkspaceFile: async (path, text) => {
    try {
      const [{ useProjectStore, getProjectRepoPath }, { getVfs }] = await Promise.all([
        import('./projectStore'),
        import('@/core/vfs'),
      ]);
      const project = useProjectStore.getState().project;
      if (!project) throw new Error('no project open');
      await getVfs().writeFile(getProjectRepoPath(project), path, text);
      set((s) => {
        const key = editorTabKey(path);
        const cur = s.editorFiles[key];
        if (!cur) return s;
        return { editorFiles: { ...s.editorFiles, [key]: { ...cur, payload: text, dirty: false } } };
      });
      useAppStore.getState().bumpFileOps();
      useAppStore.getState().notify('success', t('workbench.editor.saved'));
      return true;
    } catch (err) {
      logger.error('appStore', 'workspace file save failed', err);
      useAppStore.getState().notify('error', t('workbench.editor.save_failed'));
      return false;
    }
  },

  /** Persist a batch of files produced by a code run. Writes every path and
   *  refreshes file browsers once, so a script dumping several outputs does
   *  not spam one toast per file. */
  saveWorkspaceFiles: async (files) => {
    const entries = Object.entries(files);
    if (!entries.length) return 0;
    try {
      const [{ useProjectStore, getProjectRepoPath }, { getVfs }] = await Promise.all([
        import('./projectStore'),
        import('@/core/vfs'),
      ]);
      const project = useProjectStore.getState().project;
      if (!project) throw new Error('no project open');
      const vfs = getVfs();
      const root = getProjectRepoPath(project);
      let written = 0;
      for (const [path, text] of entries) {
        await vfs.writeFile(root, path, text);
        written += 1;
        set((s) => {
          const key = editorTabKey(path);
          const cur = s.editorFiles[key];
          if (!cur) return s;
          return {
            editorFiles: { ...s.editorFiles, [key]: { ...cur, payload: text, dirty: false } },
          };
        });
      }
      useAppStore.getState().bumpFileOps();
      useAppStore.getState().notify(
        'success',
        t('workbench.editor.outputs_saved', { count: written }),
      );
      return written;
    } catch (err) {
      logger.error('appStore', 'workspace output save failed', err);
      useAppStore.getState().notify('error', t('workbench.editor.save_failed'));
      return 0;
    }
  },

  /** Activate a tab by key. Activating a suite tab deactivates the active
   *  plugin (it would otherwise keep rendering into the hidden canvas and
   *  burning GPU/CPU — same as a mode switch). */
  activateTab: (key) => {
    const tab = get().canvasTabs.find((t) => t.key === key);
    if (!tab) return;
    set(tab.kind === 'surface' ? { activeTab: key, mode: tab.mode } : { activeTab: key });
    // Tool embeds AND file previews both replace the plugin canvas — the
    // active plugin must stop painting (GPU/CPU + visibility) either way.
    deactivatePluginLazy();
  },

  /** Show the plugin canvas: clear the active tab without closing tabs —
   *  open file/suite tabs stay in the strip and can be switched back to. If
   *  the plugin was auto-deactivated while a tab covered it, the last active
   *  plugin is re-activated so the tab actually shows it again. */
  showPluginCanvas: () => {
    set({ activeTab: null });
    void import('./pluginStore')
      .then((m) => {
        const ps = m.usePluginStore.getState();
        if (ps.activeId) return;
        const id = get().lastActivePluginId;
        if (!id || !ps.registry.some((e) => e.id === id)) return;
        return ps.activate(id);
      })
      .catch((err) => logger.error('appStore', 'plugin reactivate failed', err));
  },

  /** Brand-click home: close every open tab (revoking file blob URLs and
   *  dropping editor buffers) and deactivate the plugin without remembering
   *  it — the central area returns to the empty-canvas welcome state. */
  resetToWelcome: () => {
    set((s) => {
      const filePreviews = { ...s.filePreviews };
      for (const key of Object.keys(filePreviews)) {
        const blobUrl = filePreviews[key]?.blobUrl;
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* already revoked */
          }
        }
      }
      return { canvasTabs: [], activeTab: null, filePreviews: {}, editorFiles: {}, mode: 'standard' as WorkbenchMode };
    });
    void import('./pluginStore')
      .then((m) => {
        const ps = m.usePluginStore.getState();
        if (ps.activeId) void ps.deactivate();
        useAppStore.setState({ lastActivePluginId: null });
      })
      .catch((err) => logger.error('appStore', 'plugin deactivate failed', err));
  },

  /** Close one tab (file preview, editor or embedded suite); the nearest
   *  remaining tab becomes active. A closed file tab's blob URL is revoked
   *  and a closed editor tab's buffer is dropped. */
  closeTab: (key) => {
    set((s) => {
      const closed = s.canvasTabs.find((tab) => tab.key === key);
      if (!closed) return s;
      const next = s.canvasTabs.filter((tab) => tab.key !== key);
      const filePreviews = { ...s.filePreviews };
      const editorFiles = { ...s.editorFiles };
      if (closed.kind === 'file') {
        const blobUrl = filePreviews[key]?.blobUrl;
        delete filePreviews[key];
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* already revoked */
          }
        }
      }
      if (closed.kind === 'editor') {
        delete editorFiles[key];
      }
      const nextActive =
        s.activeTab === key
          ? next.length
            ? (next[Math.max(0, s.canvasTabs.findIndex((tab) => tab.key === key) - 1)]?.key ??
              null)
            : null
          : s.activeTab;
      // Closing the active surface tab falls back to whatever is now in front:
      // another surface tab keeps its mode, the plain canvas resets to standard.
      const nextSurface =
        closed.kind === 'surface' && s.activeTab === key
          ? next.find((tab) => tab.key === nextActive && tab.kind === 'surface')
          : undefined;
      const nextMode: WorkbenchMode | undefined =
        closed.kind === 'surface' && s.activeTab === key
          ? nextSurface && nextSurface.kind === 'surface'
            ? nextSurface.mode
            : 'standard'
          : undefined;
      return {
        canvasTabs: next,
        filePreviews,
        editorFiles,
        activeTab: nextActive,
        ...(nextMode ? { mode: nextMode } : {}),
      };
    });
    if (get().activeTab === null) get().showPluginCanvas();
  },

  /** Reorder the tab strip: pull `fromKey` out and insert it where `toKey`
   *  currently sits. The active tab stays active — reordering is purely
   *  positional, never a selection change. */
  reorderTabs: (fromKey, toKey) => {
    if (fromKey === toKey) return;
    set((s) => {
      const from = s.canvasTabs.findIndex((tab) => tab.key === fromKey);
      const to = s.canvasTabs.findIndex((tab) => tab.key === toKey);
      if (from < 0 || to < 0) return s;
      const next = [...s.canvasTabs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return { canvasTabs: next };
    });
  },

  /** Update open tabs and buffers after an explorer rename/move. Handles
   *  preview, editor and file-bound `surface` tabs, plus every descendant when
   *  a directory is relocated, so a renaming code/flow/block file keeps its
   *  tab label and its buffer instead of leaving a stale path behind. */
  renameFileTab: (oldPath, name, newPath) => {
    /** Map a path inside the renamed subtree to its new location. */
    const remapPath = (path: string): string | null => {
      if (path === oldPath) return newPath;
      if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
      return null;
    };
    set((s) => {
      const keyMap = new Map<string, string>();
      const filePreviews = { ...s.filePreviews };
      const editorFiles = { ...s.editorFiles };
      let changed = false;

      for (const [key, preview] of Object.entries(s.filePreviews)) {
        const nextPath = remapPath(preview.path);
        if (!nextPath) continue;
        const nextKey = fileTabKey(nextPath);
        filePreviews[nextKey] = {
          ...preview,
          path: nextPath,
          ...(preview.path === oldPath ? { name } : {}),
        };
        delete filePreviews[key];
        keyMap.set(key, nextKey);
        changed = true;
      }
      for (const [key, file] of Object.entries(s.editorFiles)) {
        const nextPath = remapPath(file.path);
        if (!nextPath) continue;
        const nextKey = editorTabKey(nextPath);
        editorFiles[nextKey] = {
          ...file,
          path: nextPath,
          ...(file.path === oldPath ? { name } : {}),
        };
        delete editorFiles[key];
        keyMap.set(key, nextKey);
        changed = true;
      }

      const canvasTabs = s.canvasTabs.map((tab) => {
        if (tab.kind === 'file' || tab.kind === 'editor') {
          const nextPath = remapPath(tab.path);
          if (!nextPath) return tab;
          const nextKey = tab.kind === 'file' ? fileTabKey(nextPath) : editorTabKey(nextPath);
          keyMap.set(tab.key, nextKey);
          changed = true;
          return tab.kind === 'file'
            ? { kind: 'file' as const, key: nextKey, path: nextPath }
            : { kind: 'editor' as const, key: nextKey, path: nextPath, editor: tab.editor };
        }
        if (tab.kind === 'surface' && tab.path) {
          const nextPath = remapPath(tab.path);
          if (!nextPath) return tab;
          const nextKey = surfaceTabKey(tab.mode, nextPath);
          keyMap.set(tab.key, nextKey);
          changed = true;
          return { kind: 'surface' as const, key: nextKey, mode: tab.mode, path: nextPath };
        }
        return tab;
      });

      if (!changed) return s;
      return {
        filePreviews,
        editorFiles,
        canvasTabs,
        activeTab: s.activeTab ? keyMap.get(s.activeTab) ?? s.activeTab : s.activeTab,
      };
    });
  },

  /** Embed (or close) a research suite in the central canvas. Opening one
   *  adds/activates its tool tab (the tab strip switches between suites and
   *  open files); `null` closes the active tab if it is a suite. Opening a
   *  suite also deactivates the active plugin. */
  setEmbeddedTool: (id) => {
    if (id === null) {
      const s = get();
      if (s.activeTab?.startsWith('tool:')) s.closeTab(s.activeTab);
      return;
    }
    const key = toolTabKey(id);
    const s = get();
    if (!s.canvasTabs.some((tab) => tab.key === key)) {
      set((st) => ({
        canvasTabs: [...st.canvasTabs, { kind: 'tool' as const, key, id }],
      }));
    }
    s.activateTab(key);
  },

  /** Open (or focus) the settings page as an embedded canvas tab. Opening it
   *  deactivates the active plugin — the tab covers the canvas exactly like a
   *  file/suite tab, and closing it (closeTab) restores the plugin view. */
  openSettingsTab: () => {
    const s = get();
    if (!s.canvasTabs.some((tab) => tab.key === settingsTabKey)) {
      set((st) => ({
        canvasTabs: [...st.canvasTabs, { kind: 'settings' as const, key: settingsTabKey }],
      }));
    }
    s.activateTab(settingsTabKey);
  },

  bumpFileOps: () => set((s) => ({ fileOpsVersion: s.fileOpsVersion + 1 })),
  };
});