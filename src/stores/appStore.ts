import { create } from 'zustand';
import { logger } from '@/core/logger';
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
const PANEL_DEFAULTS = { sidebarOpen: true, rightPanelOpen: true, modePanelOpen: true } as const;

function loadPanelPrefs(): typeof PANEL_DEFAULTS {
  try {
    const raw = localStorage.getItem(PANEL_PREFS_KEY);
    if (!raw) return { ...PANEL_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<typeof PANEL_DEFAULTS>;
    return {
      sidebarOpen: parsed.sidebarOpen ?? PANEL_DEFAULTS.sidebarOpen,
      rightPanelOpen: parsed.rightPanelOpen ?? PANEL_DEFAULTS.rightPanelOpen,
      modePanelOpen: parsed.modePanelOpen ?? PANEL_DEFAULTS.modePanelOpen,
    };
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

const persistPanelPrefs = (s: { sidebarOpen: boolean; rightPanelOpen: boolean; modePanelOpen: boolean }) => {
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
  };
});