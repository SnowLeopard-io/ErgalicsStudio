import { create } from 'zustand';
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
}

export interface PerfMetrics {
  fps: number;
  frameMs: number;
  gpuMs: number;
  memoryMb: number;
  dataScale: number;
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
  warnings: { fps: false, memory: false, compute: false },
};

interface AppStore {
  status: PluginHostStatus;
  banners: Banner[];
  notifications: Notification[];
  perf: PerfMetrics;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  /** Active workbench mode (Standard | Flow | Block | Code). */
  mode: WorkbenchMode;

  setStatus: (status: PluginHostStatus) => void;
  addBanner: (kind: Banner['kind'], messageKey: string) => void;
  setBanner: (messageKey: string) => void;
  removeBanner: (id: number) => void;
  setError: (pluginId: string) => void;
  notify: (kind: Notification['kind'], message: string) => void;
  dismissNotification: (id: number) => void;

  setFps: (fps: number, frameMs: number) => void;
  setGpuMs: (ms: number) => void;
  setMemoryMb: (mb: number) => void;
  setDataScale: (n: number) => void;
  setWarnings: (w: Partial<PerfMetrics['warnings']>) => void;

  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setMode: (mode: WorkbenchMode) => void;
}

let bannerId = 0;
let notifId = 0;
/** Track notification auto-dismiss timers so an early dismiss cancels them. */
const notifTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Warn when GPU memory exceeds 80% of this assumed budget (spec §7.3). */
const MEMORY_WARN_MB = 0.8 * 512;

export const useAppStore = create<AppStore>((set, get) => ({
  status: 'ready',
  banners: [],
  notifications: [],
  perf: DEFAULT_PERF,
  sidebarOpen: true,
  rightPanelOpen: true,
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
  notify: (kind, message) => {
    const id = ++notifId;
    set((s) => ({ notifications: [...s.notifications, { id, kind, message }] }));
    const timer = setTimeout(() => {
      notifTimers.delete(id);
      get().dismissNotification(id);
    }, 4000);
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

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setMode: (mode) => {
    if (mode === get().mode) return;
    set({ mode });
    // Plugins render into the Standard mode's CentralArea; leaving Standard
    // unmounts that surface, so a still-active plugin must be deactivated —
    // otherwise it keeps rendering into detached DOM and holding GPU work.
    if (mode !== 'standard') {
      // Lazy import keeps appStore free of a pluginStore cycle.
      void import('./pluginStore').then((m) => m.usePluginStore.getState().deactivate());
    }
  },
}));