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
import { getLocale, t, subscribeLocale } from '@/i18n';
import { on, emit, type BusSubscription } from '@/core/events';
import { logger } from '@/core/logger';
import { revokeCspkgUrls } from '@/core/cspkg';
import { getGpuCompute } from '@/core/compute';
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
  getFormats: () => { pluginId: string; formats: SupportedFormat[] }[];
  setInitialized: () => void;
}

/** Per-plugin param subscriptions so unloading one plugin cannot break the
 *  currently-active plugin's handler (see unload/deactivate). */
const paramSubscriptions = new Map<string, BusSubscription[]>();
/** Per-plugin locale subscriptions so they can be released on unload. */
const localeSubscriptions = new Map<string, Array<() => void>>();
/** Sandboxed plugins receive locale pushes over the worker bridge. */
const sandboxLocaleUpdaters = new Map<string, (locale: string) => void>();
/** Serializes activate() so two rapid calls cannot race deactivate/activate. */
let activationChain: Promise<void> = Promise.resolve();

// Push locale changes to every sandboxed plugin worker, and re-localize the
// registry display names (name/description) so the sidebar, status bar, and
// plugin views update without a reload. Host-side plugins subscribe through
// `buildPluginApi.onLocaleChange` (a subscribeLocale hook), so this global
// listener only needs to reach the workers + registry entries.
subscribeLocale(() => {
  const locale = getLocale();
  for (const updater of sandboxLocaleUpdaters.values()) {
    try {
      updater(locale);
    } catch (err) {
      logger.warn('plugin', 'locale push to sandbox failed', err);
    }
  }
  const { registry } = usePluginStore.getState();
  if (registry.length === 0) return;
  usePluginStore.setState({
    registry: registry.map((e) => ({
      ...e,
      name: e.nameI18n?.[locale] ?? e.name,
      description: e.descriptionI18n?.[locale] ?? e.description,
    })),
  });
});

// Host-supplied live DOM containers. The Workbench mounts these elements
// and registers them here so activated plugins render into real DOM.
export interface HostContainers {
  dom: HTMLDivElement;
  canvas2d: HTMLCanvasElement;
  reportDataScale: (n: number) => void;
  /** Lazily create (and cache) the host-managed Three.js scene handle. */
  getThree?: () => Scene3DHandle | undefined;
  /** Show/hide the cached 3D surface (3D-only plugins show it). */
  setThreeVisible?: (visible: boolean) => void;
  /** Clear the shared 2D canvas (prevents stale frames leaking between plugins). */
  clearCanvas2d?: () => void;
}

let hostContainers: HostContainers | null = null;

export function setHostContainers(containers: HostContainers | null): void {
  hostContainers = containers;
}

/**
 * Re-invoke the active plugin's render() against the *current* host
 * containers. Used when the CentralArea (which owns the plugin DOM/canvas)
 * remounts — e.g. after toggling block mode — so a still-active plugin is
 * drawn into the fresh DOM instead of disappearing.
 */
export function rerenderActivePlugin(): void {
  const { activeId, registry } = usePluginStore.getState();
  if (!activeId || !hostContainers) return;
  const entry = registry.find((e) => e.id === activeId);
  if (!entry?.plugin) return;
  const ctx = createContext(activeId);
  void entry.plugin.render?.(ctx.container);
}

function buildPluginApi(pluginId: string): PluginApi {
  return {
    get locale() {
      return getLocale();
    },
    t,
    onLocaleChange: (listener) => {
      // subscribeLocale fires on every setLocale; track the subscription so
      // unloading the plugin cannot leak handlers on the global i18n bus.
      const unsub = subscribeLocale(() => listener(getLocale()));
      const subs = localeSubscriptions.get(pluginId) ?? [];
      localeSubscriptions.set(pluginId, [...subs, unsub]);
      return unsub;
    },
    setStatus: (status) => {
      useAppStore.getState().setStatus(status);
    },
    reportGpuTime: (ms) => useAppStore.getState().setGpuMs(ms),
    reportDataScale: (n) => useAppStore.getState().setDataScale(n),
    get gpu() {
      return getGpuCompute() ?? undefined;
    },
    notify: (kind, message) => useAppStore.getState().notify(kind, message),
    openFile: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null);
        // Dismissing the native dialog never fires `change` — without this
        // the awaiting plugin would hang forever on a cancelled picker.
        input.oncancel = () => resolve(null);
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
      // Plugin-side param writes must mark the project dirty, otherwise
      // autosave never persists them.
      useProjectStore.getState().setDirty(true);
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
      // Sandboxed (.cspkg) plugins expose setLocale so locale pushes can
      // reach their worker; register it so the global listener can reach it.
      const updater = (plugin as unknown as { setLocale?: (l: string) => void }).setLocale;
      if (updater) sandboxLocaleUpdaters.set(id, updater);
      const formats =
        (await plugin.getSupportedFormats?.()) ?? plugin.manifest.formats ?? [];
      const locale = getLocale();
      const nameI18n = plugin.manifest.nameI18n;
      const descriptionI18n = plugin.manifest.descriptionI18n;
      const entry: PluginRegistryEntry = {
        id,
        name: nameI18n?.[locale] ?? plugin.manifest.name,
        version: plugin.manifest.version,
        author: plugin.manifest.author,
        description: descriptionI18n?.[locale] ?? plugin.manifest.description,
        icon: plugin.manifest.icon,
        nameI18n,
        descriptionI18n,
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
    sandboxLocaleUpdaters.delete(id);
    // Only unsubscribe this plugin's own handlers. Previously every unload
    // cleared the shared list, silently breaking the active plugin's param
    // subscription when some other plugin was unloaded.
    for (const sub of paramSubscriptions.get(id) ?? []) sub.unsubscribe();
    paramSubscriptions.delete(id);
    for (const unsub of localeSubscriptions.get(id) ?? []) unsub();
    localeSubscriptions.delete(id);
    set((s) => ({
      registry: s.registry.filter((e) => e.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  activate: async (id) => {
    const entry = get().registry.find((e) => e.id === id);
    const plugin = entry?.plugin;
    if (!plugin) {
      logger.warn('plugin', `cannot activate unloaded plugin ${id}`);
      return;
    }
    if (get().activeId === id) return;
    // Serialize activations: two rapid activate() calls (or an activate while
    // another is mid-flight) previously both passed the guard and ran
    // deactivate/activate concurrently.
    const run = async () => {
      if (get().activeId === id) return;
      await get().deactivate();
      const ctx = createContext(id);
      try {
        // Surface visibility is a host concern, decided here centrally: a 3D
        // coordinate system must never bleed into a 2D viewport and vice
        // versa. Only plugins that declare renderToScene get the 3D surface.
        const is3D = typeof plugin.renderToScene === 'function';
        if (is3D) {
          hostContainers?.getThree?.();
          hostContainers?.setThreeVisible?.(true);
          // Clear any stale 2D frame that would otherwise cover the scene.
          hostContainers?.clearCanvas2d?.();
        } else {
          hostContainers?.setThreeVisible?.(false);
        }
        await plugin.activate(ctx);
        await plugin.render?.(ctx.container);
      } catch (err) {
        logger.error('plugin', `activate failed ${id}`, err);
        useAppStore.getState().setError(`plugin:${id}`);
        return;
      }
      // Restore persisted params for this plugin from the current project so
      // re-activating a previously-inactive plugin picks up its stored values.
      const stored = useProjectStore.getState().project?.state.parameters[id];
      if (stored && Object.keys(stored).length > 0) {
        plugin.updateParams(stored);
      }
      // receive parameter updates
      const sub = on(`plugin:${id}:params`, (params: Record<string, unknown>) => {
        plugin.updateParams(params);
        emit(`plugin:${id}:defs`, undefined);
      });
      const existing = paramSubscriptions.get(id) ?? [];
      paramSubscriptions.set(id, [...existing, sub]);
      set((s) => ({
        activeId: id,
        registry: s.registry.map((e) => (e.id === id ? { ...e, active: true } : e)),
      }));
      // notify host to render params into right panel
      try {
        const params = await plugin.getParams();
        emit('host:params:changed', { pluginId: id, params });
      } catch (err) {
        // A rejecting getParams() used to reject the whole activationChain and
        // every caller awaiting it, leaving an inconsistent activeId.
        logger.warn('plugin', `getParams failed for ${id}`, err);
      }
    };
    activationChain = activationChain.then(run, run);
    await activationChain;
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
    // Only clear the active plugin's own subscriptions.
    for (const sub of paramSubscriptions.get(activeId) ?? []) sub.unsubscribe();
    paramSubscriptions.delete(activeId);
    // Hide the 3D surface whenever no 3D plugin is active, so its
    // coordinate system never lingers over the 2D viewport.
    hostContainers?.setThreeVisible?.(false);
    hostContainers?.clearCanvas2d?.();
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
    void get()
      .ensureBuiltinsLoaded()
      .then(async () => {
        // A fun/utility plugin (autoload:false) may have been the active one
        // when the project was saved; ensureBuiltinsLoaded skips it, so load
        // it on demand here before attempting activation.
        if (activeId && !get().isLoaded(activeId)) {
          try {
            const { BUILTIN_PLUGINS } = await import('@/plugins/builtin');
            const info = BUILTIN_PLUGINS.find((p) => p.manifest.id === activeId);
            if (info) {
              const plugin = await info.load();
              await get().load(plugin);
            }
          } catch (err) {
            logger.warn('plugin', `failed to lazy-load builtin ${activeId}`, err);
          }
        }
        // Await activation BEFORE pushing stored params. The previous code
        // fired `void activate()` then emitted immediately — the emit ran
        // before activate() registered its param subscription, so restored
        // values for the active plugin were broadcast into the void.
        if (activeId && get().isLoaded(activeId)) {
          await get().activate(activeId);
        }
        // Apply stored params directly to every loaded plugin rather than via
        // the bus: non-active plugins have no subscription to receive them.
        for (const [pluginId, values] of Object.entries(params)) {
          if (!values || Object.keys(values).length === 0) continue;
          const entry = get().registry.find((e) => e.id === pluginId);
          try {
            await entry?.plugin?.updateParams?.(values);
          } catch (err) {
            logger.warn('plugin', `failed to restore params for ${pluginId}`, err);
          }
        }
      })
      // `void` + a floating promise otherwise becomes an unhandled rejection if
      // any step above throws (e.g. a rejecting updateParams).
      .catch((err) => {
        logger.error('plugin', 'restoreState failed', err);
      });
  },

  ensureBuiltinsLoaded: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      const { BUILTIN_PLUGINS } = await import('@/plugins/builtin');
      for (const info of BUILTIN_PLUGINS) {
        // Fun/utility plugins declare `autoload: false` — they are listed in
        // the built-in / marketplace panel but only loaded when the user
        // picks them, so they don't bloat the startup registry.
        if (info.autoload === false) continue;
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
