import { create } from 'zustand';
import type {
  Plugin,
  PluginApi,
  PluginManifest,
  PluginRegistryEntry,
  SupportedFormat,
  PluginRenderContext,
  Scene3DHandle,
} from '@/types/plugin';
import { getLocale, t } from '@/i18n';
import { pluginChannel, on, emit, type BusSubscription } from '@/core/events';
import { logger } from '@/core/logger';
import { revokeCspkgUrls } from '@/core/cspkg';
import { useProjectStore } from './projectStore';
import { useAppStore } from './appStore';

interface PluginStore {
  registry: PluginRegistryEntry[];
  activeId: string | null;
  loadingIds: string[];
  initialized: boolean;

  /** Load a plugin module (from builtin or installed package). */
  load: (plugin: Plugin) => Promise<void>;
  unload: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  deactivate: () => Promise<void>;
  isLoaded: (id: string) => boolean;
  getActive: () => Plugin | null;
  getAllParams: () => Promise<Record<string, Record<string, unknown>>>;
  /** Load all built-in example plugins once (spec §3.3.1). */
  ensureBuiltinsLoaded: () => Promise<void>;
  /** Restore project state: activate plugin, restore params. */
  restoreState: (projectState: { state?: { activePlugin?: string | null; parameters?: Record<string, Record<string, unknown>> } }) => void;
  dispatchFile: (file: File) => Promise<boolean>;
  getFormats: () => { pluginId: string; formats: SupportedFormat[] }[];
  setInitialized: () => void;
}

let activeSubscriptions: BusSubscription[] = [];

// Host-supplied live DOM containers. The Workbench mounts these elements
// and registers them here so activated plugins render into real DOM.
export interface HostContainers {
  dom: HTMLDivElement;
  canvas2d: HTMLCanvasElement;
  reportDataScale: (n: number) => void;
  /** Lazily create (and cache) the host-managed Three.js scene handle. */
  getThree?: () => Scene3DHandle | undefined;
}

let hostContainers: HostContainers | null = null;

export function setHostContainers(containers: HostContainers | null): void {
  hostContainers = containers;
}

function buildPluginApi(pluginId: string): PluginApi {
  return {
    get locale() {
      return getLocale();
    },
    t,
    onLocaleChange: (listener) => {
      const sub = on(pluginChannel(pluginId, 'locale'), () => listener(getLocale()));
      return sub.unsubscribe;
    },
    setStatus: (status) => {
      useAppStore.getState().setStatus(status);
    },
    reportGpuTime: (ms) => useAppStore.getState().setGpuMs(ms),
    reportDataScale: (n) => useAppStore.getState().setDataScale(n),
    notify: (kind, message) => useAppStore.getState().notify(kind, message),
    openFile: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      });
      return file;
    },
    readText: async (file) => file.text(),
    readBinary: async (file) => file.arrayBuffer(),
    getParam: (key) => {
      const { project } = useProjectStore.getState();
      return project?.state.parameters[pluginId]?.[key];
    },
    setParam: (key, value) => {
      useProjectStore.setState((s) => {
        if (!s.project) return s;
        return {
          project: {
            ...s.project,
            state: {
              ...s.project.state,
              parameters: {
                ...s.project.state.parameters,
                [pluginId]: {
                  ...s.project.state.parameters[pluginId],
                  [key]: value,
                },
              },
            },
          },
        };
      });
    },
  };
}

function createContext(pluginId: string): PluginRenderContext {
  // Only materialize the WebGL scene for plugins that declare 3D rendering
  // (renderToScene); 2D plugins must not pay for a WebGL context.
  const entry = usePluginStore.getState().registry.find((e) => e.id === pluginId);
  const three = entry?.plugin?.renderToScene ? hostContainers?.getThree?.() : undefined;
  if (hostContainers) {
    return {
      container: {
        canvas2d: hostContainers.canvas2d,
        dom: hostContainers.dom,
        three,
        reportDataScale: (n) => hostContainers!.reportDataScale(n),
      },
      api: buildPluginApi(pluginId),
    };
  }
  const canvas2d = document.createElement('canvas');
  const dom = document.createElement('div');
  return {
    container: {
      canvas2d,
      dom,
      three,
      reportDataScale: (n) => useAppStore.getState().setDataScale(n),
    },
    api: buildPluginApi(pluginId),
  };
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  registry: [],
  activeId: null,
  loadingIds: [],
  initialized: false,

  load: async (plugin) => {
    const id = plugin.manifest.id;
    if (get().isLoaded(id)) return;
    set((s) => ({ loadingIds: [...s.loadingIds, id] }));
    try {
      await plugin.init(buildPluginApi(id));
      const formats =
        (await plugin.getSupportedFormats?.()) ?? plugin.manifest.formats ?? [];
      const entry: PluginRegistryEntry = {
        id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        author: plugin.manifest.author,
        description: plugin.manifest.description,
        icon: plugin.manifest.icon,
        loaded: true,
        active: false,
        formats,
        plugin,
      };
      set((s) => ({ registry: [...s.registry.filter((e) => e.id !== id), entry] }));
      logger.info('plugin', `loaded ${id}@${plugin.manifest.version}`);
    } catch (err) {
      logger.error('plugin', `failed to load ${id}`, err);
      useAppStore.getState().setError(`plugin:${id}`);
    } finally {
      set((s) => ({ loadingIds: s.loadingIds.filter((x) => x !== id) }));
    }
  },

  unload: async (id) => {
    const entry = get().registry.find((e) => e.id === id);
    if (!entry?.plugin) return;
    try {
      await entry.plugin.destroy();
    } catch (err) {
      logger.error('plugin', `destroy failed ${id}`, err);
    }
    // Release blob URLs held for installed packages (cspkg assets).
    revokeCspkgUrls(id);
    for (const sub of activeSubscriptions) sub.unsubscribe();
    activeSubscriptions = [];
    set((s) => ({
      registry: s.registry.filter((e) => e.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  activate: async (id) => {
    const entry = get().registry.find((e) => e.id === id);
    if (!entry?.plugin) {
      logger.warn('plugin', `cannot activate unloaded plugin ${id}`);
      return;
    }
    if (get().activeId === id) return;
    await get().deactivate();
    const ctx = createContext(id);
    try {
      await entry.plugin.activate(ctx);
      await entry.plugin.render?.(ctx.container);
    } catch (err) {
      logger.error('plugin', `activate failed ${id}`, err);
      useAppStore.getState().setError(`plugin:${id}`);
      return;
    }
    // receive parameter updates
    activeSubscriptions.push(
      on(`plugin:${id}:params`, (params: Record<string, unknown>) => {
        entry.plugin?.updateParams(params);
        emit(`plugin:${id}:defs`, undefined);
      }),
    );
    set((s) => ({
      activeId: id,
      registry: s.registry.map((e) => (e.id === id ? { ...e, active: true } : e)),
    }));
    // notify host to render params into right panel
    const params = await entry.plugin.getParams();
    emit('host:params:changed', { pluginId: id, params });
  },

  deactivate: async () => {
    const { activeId, registry } = get();
    if (!activeId) return;
    const entry = registry.find((e) => e.id === activeId);
    if (entry?.plugin) {
      try {
        await entry.plugin.deactivate();
      } catch (err) {
        logger.error('plugin', `deactivate failed ${activeId}`, err);
      }
    }
    for (const sub of activeSubscriptions) sub.unsubscribe();
    activeSubscriptions = [];
    set((s) => ({
      activeId: null,
      registry: s.registry.map((e) => (e.id === activeId ? { ...e, active: false } : e)),
    }));
  },

  isLoaded: (id) => get().registry.some((e) => e.id === id && e.loaded),
  getActive: () => {
    const id = get().activeId;
    return get().registry.find((e) => e.id === id)?.plugin ?? null;
  },
  getAllParams: async () => {
    const params: Record<string, Record<string, unknown>> = {};
    for (const entry of get().registry) {
      const defs = (await entry.plugin?.getParams()) ?? [];
      const values: Record<string, unknown> = {};
      for (const def of defs) {
        const value = 'value' in def ? def.value : null;
        values[def.key] = value;
      }
      params[entry.id] = values;
    }
    return params;
  },

  restoreState: (projectState) => {
    const activeId = projectState?.state?.activePlugin ?? null;
    const params = projectState?.state?.parameters ?? {};
    // Ensure built-ins are loaded before restoring so activePlugin can activate.
    void get().ensureBuiltinsLoaded().then(() => {
      if (activeId && get().isLoaded(activeId)) {
        void get().activate(activeId);
      }
    });
    // push stored params to plugins
    for (const [pluginId, values] of Object.entries(params)) {
      emit(`plugin:${pluginId}:params`, values);
    }
  },

  ensureBuiltinsLoaded: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      const { BUILTIN_PLUGINS } = await import('@/plugins/builtin');
      for (const info of BUILTIN_PLUGINS) {
        try {
          const plugin = await info.load();
          await get().load(plugin);
        } catch (err) {
          logger.warn('plugin', `failed to load builtin ${info.manifest.id}`, err);
        }
      }
    } catch (err) {
      logger.error('plugin', 'failed to resolve builtin plugins', err);
    }
  },

  dispatchFile: async (file) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const matches: string[] = [];
    for (const entry of get().registry) {
      const fmt = entry.formats.some((f) => f.extension.toLowerCase() === ext);
      if (fmt) matches.push(entry.id);
    }
    if (matches.length === 0) {
      useAppStore.getState().setBanner('error.file_unsupported');
      return false;
    }
    if (matches.length === 1) {
      const id = matches[0] as string;
      if (get().activeId !== id) await get().activate(id);
      const plugin = get().registry.find((e) => e.id === id)?.plugin;
      await plugin?.loadData?.(file);
      return true;
    }
    // multiple plugins match → let user pick
    emit('host:file:choose-plugin', { file, pluginIds: matches });
    return true;
  },

  getFormats: () =>
    get().registry.map((e) => ({ pluginId: e.id, formats: e.formats })),

  setInitialized: () => set({ initialized: true }),
}));

/** Load a plugin from a manifest + factory. */
export async function loadPluginFromModule(factory: Plugin | ((api: PluginApi) => Plugin)): Promise<void> {
  const plugin = typeof factory === 'function' ? (factory as (api: PluginApi) => Plugin)(buildPluginApi('__init__')) : factory;
  await usePluginStore.getState().load(plugin);
}

export function isPluginActive(id: string): boolean {
  return usePluginStore.getState().activeId === id;
}

export function pluginName(id: string): string {
  const entry = usePluginStore.getState().registry.find((e) => e.id === id);
  return entry?.name ?? id;
}

export { buildPluginApi };
export type { PluginManifest };
