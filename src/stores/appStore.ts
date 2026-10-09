import { create } from 'zustand';
import { logger } from '@/core/logger';
import { t } from '@/i18n';
import type { PluginHostStatus } from '@/types/plugin';
import type { WorkbenchMode } from '@/types/editor';

export interface Banner {
  id: number;
  kind: 'info' | 'warning' | 'error';
  messageKey: string;
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
export type SidebarView = 'files' | 'plugins' | 'git';

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
  | { kind: 'tool'; key: string; id: string }
  | { kind: 'settings'; key: string };

/** Tab key for a file preview tab. */
export const fileTabKey = (path: string): string => `file:${path}`;

/** Tab key for a file editor tab. */
export const editorTabKey = (path: string): string => `editor:${path}`;

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
  /**
   * Mode-specific side panel visibility for Flow/Block/Code. Standard mode
   * uses `sidebarOpen`; the other modes own panels (flow palette+legend,
   * block preview, code variables) toggled by the same top-bar ☰ button,
   * so ☰ is meaningful in every mode.
   */
  modePanelOpen: boolean;
  /** Active workbench mode (Standard | Flow | Block | Code). */
  mode: WorkbenchMode;
  /** Current sidebar view (activity bar selection in Standard mode). */
  sidebarView: SidebarView;
  /**
   * Canvas tab strip (VS Code editor-area style): files opened from the
   * explorer and research suites embedded from the launcher share one tab
   * list. Every open tab stays mounted — switching tabs only toggles
   * visibility, so scroll position / edit buffer / tool state survive.
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
  setBanner: (messageKey: string) => void;
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
  toggleModePanel: () => void;
  setMode: (mode: WorkbenchMode) => void;
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
  /** Activate a tab by key (no-op if the tab is not open). */
  activateTab: (key: string) => void;
  /** Show the plugin canvas: clears the active tab without closing any tab —
   *  open file/suite tabs stay in the strip and can be switched back to. */
  showPluginCanvas: () => void;
  /** Last plugin id auto-deactivated when a canvas tab covered the canvas —
   *  used by `showPluginCanvas` to restore it. */
  lastActivePluginId: string | null;
  /** Close one tab (file or suite); activates the nearest remaining tab. */
  closeTab: (key: string) => void;
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
  modePanelOpen: true,
  sidebarView: 'plugins' as SidebarView,
};

const SIDEBAR_VIEWS: readonly SidebarView[] = ['files', 'plugins', 'git'];

function loadPanelPrefs(): typeof PANEL_DEFAULTS {
  try {
    const raw = localStorage.getItem(PANEL_PREFS_KEY);
    if (!raw) return { ...PANEL_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<typeof PANEL_DEFAULTS>;
    return {
      sidebarOpen: parsed.sidebarOpen ?? PANEL_DEFAULTS.sidebarOpen,
      rightPanelOpen: parsed.rightPanelOpen ?? PANEL_DEFAULTS.rightPanelOpen,
      modePanelOpen: parsed.modePanelOpen ?? PANEL_DEFAULTS.modePanelOpen,
      sidebarView: SIDEBAR_VIEWS.includes(parsed.sidebarView as SidebarView)
        ? (parsed.sidebarView as SidebarView)
        : PANEL_DEFAULTS.sidebarView,
    };
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

const persistPanelPrefs = (s: {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  modePanelOpen: boolean;
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
  modePanelOpen: panelPrefs.modePanelOpen,
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
  setBanner: (messageKey) => {
    const existing = get().banners.some((b) => b.messageKey === messageKey);
    if (existing) return;
    set((s) => ({
      banners: [...s.banners, { id: ++bannerId, kind: 'error', messageKey, dismissible: true }],
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
  toggleModePanel: () =>
    set((s) => {
      const next = { ...s, modePanelOpen: !s.modePanelOpen };
      persistPanelPrefs(next);
      return next;
    }),
  setMode: (mode) => {
    if (mode === get().mode) return;
    set({ mode });
    // Plugins render into the Standard mode's CentralArea; leaving Standard
    // unmounts that surface, so a still-active plugin must be deactivated —
    // otherwise it keeps rendering into detached DOM and holding GPU work.
    if (mode !== 'standard') {
      // Lazy import keeps appStore free of a pluginStore cycle.
      void import('./pluginStore')
        .then((m) => m.usePluginStore.getState().deactivate())
        .catch((err) => logger.error('appStore', 'deactivate on mode switch failed', err));
    }
  },

  /** Activity-bar click: switch the sidebar view and open the sidebar.
   *  Clicking the already-active view while open collapses the sidebar
   *  (VS Code behaviour) — a second click re-opens it. */
  setSidebarView: (view) => {
    const s = get();
    if (view === s.sidebarView && s.sidebarOpen) {
      s.toggleSidebar();
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

  /** Push the editor's live buffer into the store + mark dirty. No-op when
   *  the tab was closed while the debounce was pending. */
  updateEditorFile: (path, payload) => {
    const key = editorTabKey(path);
    set((s) => {
      const cur = s.editorFiles[key];
      if (!cur) return s;
      return { editorFiles: { ...s.editorFiles, [key]: { ...cur, payload, dirty: true } } };
    });
  },

  /** Write the buffered payload to the working tree. Uses lazy imports (the
   *  git adapter's repo path helper lives in projectStore, which imports this
   *  store — a static import would close a cycle). Resolves to false on
   *  failure (a notification is emitted; callers just skip their close). */
  saveEditorFile: async (path) => {
    const key = editorTabKey(path);
    const cur = useAppStore.getState().editorFiles[key];
    if (!cur) return false;
    try {
      const [{ useProjectStore, getProjectRepoPath }, { getGitAdapter }] = await Promise.all([
        import('./projectStore'),
        import('@/core/git'),
      ]);
      const project = useProjectStore.getState().project;
      if (!project) throw new Error('no project open');
      await getGitAdapter().writeFile(getProjectRepoPath(project), cur.path, cur.payload);
      set((s) => {
        const f = s.editorFiles[key];
        if (!f) return s;
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

  /** Activate a tab by key. Activating a suite tab deactivates the active
   *  plugin (it would otherwise keep rendering into the hidden canvas and
   *  burning GPU/CPU — same as a mode switch). */
  activateTab: (key) => {
    if (!get().canvasTabs.some((tab) => tab.key === key)) return;
    set({ activeTab: key });
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
      return {
        canvasTabs: next,
        filePreviews,
        editorFiles,
        activeTab:
          s.activeTab === key
            ? next.length
              ? (next[Math.max(0, s.canvasTabs.findIndex((tab) => tab.key === key) - 1)]?.key ??
                null)
              : null
            : s.activeTab,
      };
    });
  },

  /** Update a file tab's path/name after an explorer rename, preserving its
   *  open state and content. Covers both preview tabs and editor tabs (the
   *  buffer migrates so dirty state survives the rename). */
  renameFileTab: (oldPath, name, newPath) => {
    const oldKey = fileTabKey(oldPath);
    const newKey = fileTabKey(newPath);
    const oldEditorKey = editorTabKey(oldPath);
    const newEditorKey = editorTabKey(newPath);
    set((s) => {
      const prev = s.filePreviews[oldKey];
      const editor = s.editorFiles[oldEditorKey];
      if (!prev && !editor) return s;
      const filePreviews = { ...s.filePreviews };
      const editorFiles = { ...s.editorFiles };
      if (prev) {
        filePreviews[newKey] = { ...prev, name, path: newPath };
        delete filePreviews[oldKey];
      }
      if (editor) {
        editorFiles[newEditorKey] = { ...editor, name, path: newPath };
        delete editorFiles[oldEditorKey];
      }
      return {
        filePreviews,
        editorFiles,
        canvasTabs: s.canvasTabs.map((tab) => {
          if (tab.key === oldKey && tab.kind === 'file')
            return { kind: 'file' as const, key: newKey, path: newPath };
          if (tab.key === oldEditorKey && tab.kind === 'editor')
            return { kind: 'editor' as const, key: newEditorKey, path: newPath, editor: tab.editor };
          return tab;
        }),
        activeTab:
          s.activeTab === oldKey ? newKey : s.activeTab === oldEditorKey ? newEditorKey : s.activeTab,
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