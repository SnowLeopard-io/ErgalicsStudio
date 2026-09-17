import { create } from 'zustand';
import type {
  ParameterSnapshot,
  Plugin,
  PluginApi,
  PluginManifest,
  PluginRegistryEntry,
  PluginRunRecord,
  SupportedFormat,
  PluginRenderContext,
  Scene3DHandle,
} from '@/types/plugin';
import { getLocale, t, subscribeLocale } from '@/i18n';
import { on, emit, type BusSubscription } from '@/core/events';
import { logger } from '@/core/logger';
import { getGpuCompute } from '@/core/compute';
import { createPluginCache, disposePluginCache } from '@/core/pluginCache';
import { downloadBlob } from '@/core/download';
import { useProjectStore } from './projectStore';
import { useAppStore } from './appStore';

export interface BeginRunInput {
  pluginId: string;
  kind: PluginRunRecord['kind'];
  label?: string;
  detail?: Record<string, unknown>;
}

interface PluginStore {
  registry: PluginRegistryEntry[];
  activeId: string | null;
  loadingIds: string[];
  initialized: boolean;
  /** Append-only experiment trace (imports, compute runs, custom steps). */
  runHistory: PluginRunRecord[];

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
  /** Open a run record; returns its id for `finishRun`. */
  beginRun: (input: BeginRunInput) => string;
  /** Close a run record as succeeded or failed. */
  finishRun: (id: string, ok: boolean, error?: string) => void;
  /**
   * Snapshot every loaded plugin's live parameters next to its version, so a
   * result can be attributed to the exact configuration that produced it.
   */
  exportParameterSnapshot: () => Promise<ParameterSnapshot>;
  /** Full traceability bundle: parameters + runs + buffered logs. */
  exportDiagnostics: () => Promise<string>;
  /** Fan `onProjectSave` / `onProjectLoad` out to every loaded plugin. */
  notifyProjectLifecycle: (phase: 'save' | 'load') => void;
}

/** Per-plugin param subscriptions so unloading one plugin cannot break the
 *  currently-active plugin's handler (see unload/deactivate). */
const paramSubscriptions = new Map<string, BusSubscription[]>();
/** Per-plugin locale subscriptions so they can be released on unload. */
const localeSubscriptions = new Map<string, Array<() => void>>();
/** Sandboxed plugins receive locale pushes over the worker bridge. */
const sandboxLocaleUpdaters = new Map<string, (locale: string) => void>();
/**
 * Serializes every lifecycle transition (activate / deactivate / unload).
 * One chain guarantees their *bodies* never interleave; an `activationGen`
 * generation token additionally lets a transition superseded while awaiting
 * an RPC bail out before it publishes state (e.g. activate(A) interrupted by
 * deactivate() on mode switch must not resurrect activeId afterwards).
 */
let lifecycleChain: Promise<void> = Promise.resolve();
let activationGen = 0;

function enqueueLifecycle(task: () => Promise<void> | void): Promise<void> {
  lifecycleChain = lifecycleChain.then(task, task);
  return lifecycleChain;
}
/**
 * In-flight `ensureBuiltinsLoaded()` promise, shared by concurrent callers.
 * Cleared on rejection so a transient failure can be retried instead of
 * poisoning every later call with a permanently-rejected promise.
 */
let builtinsPromise: Promise<void> | null = null;
/** Monotonic run-record id source (also keeps ids sortable by start). */
let runSeq = 0;

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
  // render() is an RPC for sandboxed plugins; it can reject (timeout while a
  // long compute owns the worker). A bare `void` made each pan/wheel during a
  // compute burst surface an unhandled promise rejection.
  void Promise.resolve(entry.plugin.render?.(ctx.container)).catch((err: unknown) => {
    logger.warn('plugin', 'rerender rejected', { id: activeId }, err);
  });
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
      // A plugin that is mid-compute while another one is active (the worker
      // serializes deactivate behind compute) must not overwrite the visible
      // plugin's status indicator.
      if (usePluginStore.getState().activeId === pluginId) {
        useAppStore.getState().setStatus(status);
      }
    },
    reportGpuTime: (ms) => {
      if (usePluginStore.getState().activeId === pluginId) useAppStore.getState().setGpuMs(ms);
    },
    reportDataScale: (n) => {
      if (usePluginStore.getState().activeId === pluginId) useAppStore.getState().setDataScale(n);
    },
    get gpu() {
      return getGpuCompute() ?? undefined;
    },
    notify: (kind, message) => useAppStore.getState().notify(kind, message),
    // Structured logging: the scope carries the plugin id so an exported
    // trace can be filtered per plugin without parsing message text.
    log: (level, message, details) => {
      const target = logger[level] ?? logger.info;
      if (details === undefined) target.call(logger, `plugin:${pluginId}`, message);
      else target.call(logger, `plugin:${pluginId}`, message, details);
    },
    exportFile: (fileName, data, mimeType) => {
      downloadBlob(fileName, data, mimeType);
    },
    cache: createPluginCache(pluginId),
    openFile: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      // The picker input is never attached to the document, so it would
      // otherwise stay referenced by the closure (and by the browser's
      // internal picker bookkeeping) until the page is torn down.
      const cleanup = () => {
        input.onchange = null;
        input.oncancel = null;
        input.remove();
      };
      const file = await new Promise<File | null>((resolve) => {
        const settle = (value: File | null) => {
          cleanup();
          resolve(value);
        };
        input.onchange = () => settle(input.files?.[0] ?? null);
        // Dismissing the native dialog never fires `change` — without this
        // the awaiting plugin would hang forever on a cancelled picker.
        // (Browsers without `oncancel` — Safari < 15.4 — still hang; the
        // sandbox RPC timeout is the backstop there.)
        input.oncancel = () => settle(null);
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

/**
 * Tear down whatever plugin is currently active.
 *
 * Runs *inside* the lifecycle chain (never concurrently with an activate).
 * Reads the active id at execution time, so a deactivate enqueued while an
 * activation was still in flight cleans up whichever plugin actually won.
 */
async function deactivateCurrentPlugin(): Promise<void> {
  const { activeId, registry } = usePluginStore.getState();
  if (!activeId) return;
  const entry = registry.find((e) => e.id === activeId);
  if (entry?.plugin) {
    try {
      await entry.plugin.deactivate?.();
    } catch (err) {
      logger.error('plugin', 'plugin deactivate failed', { id: activeId }, err);
    }
  }
  // Only clear the active plugin's own subscriptions.
  for (const sub of paramSubscriptions.get(activeId) ?? []) sub.unsubscribe();
  paramSubscriptions.delete(activeId);
  // Hide the 3D surface whenever no 3D plugin is active, so its
  // coordinate system never lingers over the 2D viewport.
  hostContainers?.setThreeVisible?.(false);
  hostContainers?.clearCanvas2d?.();
  usePluginStore.setState((s) => ({
    activeId: null,
    registry: s.registry.map((e) => (e.id === activeId ? { ...e, active: false } : e)),
  }));
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  registry: [],
  activeId: null,
  loadingIds: [],
  initialized: false,
  runHistory: [],

  load: async (plugin) => {
    const id = plugin.manifest.id;
    if (get().isLoaded(id)) return;
    // `loadingIds` doubles as the in-flight guard. Checking only `isLoaded`
    // let two synchronous callers both pass (the entry is only added to the
    // registry after `init` resolves), which ran `init` twice on one plugin.
    if (get().loadingIds.includes(id)) return;
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
      logger.info('plugin', 'plugin loaded', { id, version: plugin.manifest.version });
    } catch (err) {
      logger.error('plugin', 'plugin load failed', { id }, err);
      useAppStore.getState().setError(`plugin:${id}`);
    } finally {
      set((s) => ({ loadingIds: s.loadingIds.filter((x) => x !== id) }));
    }
  },

  unload: async (id) => {
    // Supersede an in-flight activation of this (or any) plugin: its tail
    // must not publish activeId/subscriptions after the registry entry is
    // removed. Everything still serializes through the lifecycle chain.
    activationGen += 1;
    await enqueueLifecycle(async () => {
      const entry = usePluginStore.getState().registry.find((e) => e.id === id);
      if (!entry?.plugin) return;
      // Unloading the *active* plugin used to skip `deactivate()` entirely, so
      // a 3-D plugin's scene stayed visible over an empty viewport and any
      // animation loop it started in `activate()` kept running.
      if (usePluginStore.getState().activeId === id) {
        await deactivateCurrentPlugin();
      }
      try {
        await entry.plugin.destroy?.();
      } catch (err) {
        logger.error('plugin', 'plugin destroy failed', { id }, err);
      }
      // Drop the plugin's intermediate-result cache; without this every
      // unloaded plugin's scratch space lived until the page was reloaded.
      disposePluginCache(id);
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
    });
  },

  activate: async (id) => {
    const entry = get().registry.find((e) => e.id === id);
    const plugin = entry?.plugin;
    if (!plugin) {
      logger.warn('plugin', 'cannot activate unloaded plugin', { id });
      return;
    }
    if (get().activeId === id) return;
    // This generation uniquely identifies this activation attempt. Every
    // checkpoint below bails when a newer transition (another activate, a
    // deactivate from mode switching, an unload) bumped the generation, so an
    // RPC that resolves late can never publish a superseded activeId.
    const gen = ++activationGen;
    const run = async () => {
      if (gen !== activationGen) return;
      if (usePluginStore.getState().activeId === id) return;
      await deactivateCurrentPlugin();
      if (gen !== activationGen) return;
      // Once plugin.activate() has resolved, the plugin owns live resources
      // (RAF loops, canvas listeners, 3-D surfaces). If this attempt is
      // superseded *after* that point, the queued newer transition cannot
      // tear them down (activeId was never published), so we must compensate
      // with an explicit deactivate() here.
      let acquired = false;
      const bailIfStale = async (): Promise<boolean> => {
        if (gen === activationGen) return false;
        if (acquired) {
          try {
            await plugin.deactivate?.();
          } catch (err) {
            logger.warn('plugin', 'compensating deactivate failed', { id }, err);
          }
          hostContainers?.setThreeVisible?.(false);
          hostContainers?.clearCanvas2d?.();
        }
        return true;
      };
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
        await plugin.activate?.(ctx);
        acquired = true;
        if (await bailIfStale()) return;
        await plugin.render?.(ctx.container);
      } catch (err) {
        logger.error('plugin', 'plugin activate failed', { id }, err);
        useAppStore.getState().setError(`plugin:${id}`);
        return;
      }
      if (await bailIfStale()) return;
      // The plugin may have been unloaded while its activate RPC was in
      // flight — never re-publish it or subscribe on a dead registry entry.
      if (!usePluginStore.getState().registry.some((e) => e.id === id)) return;
      // Restore persisted params for this plugin from the current project so
      // re-activating a previously-inactive plugin picks up its stored values.
      // `updateParams` may be async (sandboxed plugins answer over RPC) — an
      // unchecked rejection here surfaced as an unhandled promise rejection.
      const stored = useProjectStore.getState().project?.state.parameters[id];
      if (stored && Object.keys(stored).length > 0) {
        try {
          await plugin.updateParams?.(stored);
        } catch (err) {
          logger.warn('plugin', 'failed to restore params', { id }, err);
        }
      }
      if (await bailIfStale()) return;
      if (!usePluginStore.getState().registry.some((e) => e.id === id)) return;
      // receive parameter updates
      const sub = on(`plugin:${id}:params`, (params: Record<string, unknown>) => {
        void Promise.resolve()
          .then(() => plugin.updateParams?.(params))
          .catch((err: unknown) => logger.warn('plugin', 'updateParams failed', { id }, err))
          // Re-read the definitions only *after* the plugin has applied the
          // change. Emitting before (the old order) made the panel re-read
          // `getParams()` while `updateParams` was still queued, so a toggle
          // reported its pre-click value — the label lagged one click behind
          // the action and every Start/Stop appeared to need two clicks.
          // `finally` keeps the panel in sync even when updateParams rejects.
          .finally(() => emit(`plugin:${id}:defs`, undefined));
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
        if (gen !== activationGen) return;
        emit('host:params:changed', { pluginId: id, params });
      } catch (err) {
        // A rejecting getParams() used to reject the whole lifecycle chain and
        // every caller awaiting it, leaving an inconsistent activeId.
        logger.warn('plugin', 'getParams failed', { id }, err);
      }
    };
    await enqueueLifecycle(run);
  },

  deactivate: async () => {
    // Joining the same lifecycle chain as activate (rather than acting
    // immediately on the current snapshot) closes the window in which an
    // activate() still awaiting its RPCs would finish afterwards and
    // re-publish activeId — previously the plugin kept animating on detached
    // DOM after a mode switch and could never be re-activated.
    const gen = ++activationGen;
    await enqueueLifecycle(async () => {
      if (gen !== activationGen) return;
      await deactivateCurrentPlugin();
    });
  },

  isLoaded: (id) => get().registry.some((e) => e.id === id && e.loaded),
  getActive: () => {
    const id = get().activeId;
    return get().registry.find((e) => e.id === id)?.plugin ?? null;
  },
  getAllParams: async () => {
    const params: Record<string, Record<string, unknown>> = {};
    for (const entry of get().registry) {
      // One misbehaving plugin must not abort the whole snapshot: this runs
      // on every project save, so a throwing `getParams` previously made the
      // project unsaveable with no indication of which plugin was at fault.
      let defs: Awaited<ReturnType<Plugin['getParams']>> = [];
      try {
        defs = (await entry.plugin?.getParams()) ?? [];
      } catch (err) {
        logger.warn('plugin', 'getParams failed during snapshot', { id: entry.id }, err);
        continue;
      }
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
            logger.warn('plugin', 'failed to lazy-load builtin', { id: activeId }, err);
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
            logger.warn('plugin', 'failed to restore params', { id: pluginId }, err);
          }
        }
        // Only now is the project fully restored for plugins.
        get().notifyProjectLifecycle('load');
      })
      // `void` + a floating promise otherwise becomes an unhandled rejection if
      // any step above throws (e.g. a rejecting updateParams).
      .catch((err) => {
        logger.error('plugin', 'restoreState failed', err);
      });
  },

  ensureBuiltinsLoaded: async () => {
    // Caching the in-flight promise (instead of only an `initialized` flag)
    // makes concurrent callers await the same load: previously the flag was
    // set before the first `await`, so a second caller returned immediately
    // with a half-populated registry and silently skipped the built-ins.
    if (builtinsPromise) return builtinsPromise;
    builtinsPromise = (async () => {
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
            logger.warn('plugin', 'failed to load builtin', { id: info.manifest.id }, err);
          }
        }
        // Mark ready only once the registry is actually populated.
        set({ initialized: true });
      } catch (err) {
        logger.error('plugin', 'failed to resolve builtin plugins', err);
        // Release the cached promise so a later call retries instead of the
        // registry staying permanently empty for the rest of the session.
        builtinsPromise = null;
      }
    })();
    return builtinsPromise;
  },

  getFormats: () =>
    get().registry.map((e) => ({ pluginId: e.id, formats: e.formats })),

  setInitialized: () => set({ initialized: true }),

  beginRun: (input) => {
    runSeq += 1;
    const entry = usePluginStore.getState().registry.find((e) => e.id === input.pluginId);
    const record: PluginRunRecord = {
      id: `run-${runSeq}`,
      pluginId: input.pluginId,
      pluginVersion: entry?.version,
      kind: input.kind,
      label: input.label,
      startedAt: Date.now(),
      detail: input.detail,
    };
    set((s) => ({ runHistory: [...s.runHistory, record] }));
    return record.id;
  },

  finishRun: (id, ok, error) => {
    set((s) => ({
      runHistory: s.runHistory.map((r) => {
        if (r.id !== id) return r;
        const endedAt = Date.now();
        return {
          ...r,
          endedAt,
          durationMs: endedAt - r.startedAt,
          ok,
          error: ok ? undefined : error,
        };
      }),
    }));
  },

  exportParameterSnapshot: async () => {
    // Live values from the plugin instances: project state only holds what
    // the last save happened to capture, which is not what a run actually
    // used. `getAllParams` already skips plugins whose getParams() throws.
    const values = await get().getAllParams();
    const plugins: ParameterSnapshot['plugins'] = {};
    for (const entry of get().registry) {
      plugins[entry.id] = { version: entry.version, params: values[entry.id] ?? {} };
    }
    return { generatedAt: new Date().toISOString(), plugins };
  },

  exportDiagnostics: async () => {
    const snapshot = await get().exportParameterSnapshot();
    return JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        plugins: get().registry.map((e) => ({ id: e.id, version: e.version, active: e.active })),
        parameters: snapshot.plugins,
        runs: get().runHistory,
        logs: logger.entries(),
      },
      null,
      2,
    );
  },

  notifyProjectLifecycle: (phase) => {
    const method = phase === 'save' ? 'onProjectSave' : 'onProjectLoad';
    for (const entry of get().registry) {
      const hook = entry.plugin?.[method];
      if (typeof hook !== 'function') continue;
      // Best-effort: a plugin failing to react must never abort the save or
      // the load that triggered it.
      void Promise.resolve()
        .then(() => (hook as () => unknown).call(entry.plugin))
        .catch((err: unknown) => logger.warn('plugin', `${method} failed`, { id: entry.id }, err));
    }
  },
}));

/**
 * Load a plugin from an instance or a factory.
 *
 * The factory is built with `plugin.manifest.id` when it is an object, so
 * params written during `init` land under the real plugin id instead of a
 * placeholder that no later lookup can find.
 */
export async function loadPluginFromModule(factory: Plugin | ((api: PluginApi) => Plugin)): Promise<void> {
  if (typeof factory !== 'function') {
    await usePluginStore.getState().load(factory);
    return;
  }
  const probe = (factory as (api: PluginApi) => Plugin)(buildPluginApi('__init__'));
  await usePluginStore.getState().load(probe);
}

/**
 * Run an action as a tracked experiment step.
 *
 * Wraps the host's data-import path so every import is recorded with its
 * plugin version, byte count, duration and outcome — and so a throwing
 * `loadData()` reports to the user instead of surfacing as an unhandled
 * rejection inside a React event handler.
 */
export async function runTracked<T>(
  input: BeginRunInput,
  action: () => Promise<T>,
): Promise<T> {
  const store = usePluginStore.getState();
  const runId = store.beginRun(input);
  try {
    const value = await action();
    usePluginStore.getState().finishRun(runId, true);
    return value;
  } catch (err) {
    usePluginStore.getState().finishRun(runId, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function isPluginActive(id: string): boolean {
  return usePluginStore.getState().activeId === id;
}

/**
 * Ask the host UI to re-read a plugin's parameter definitions.
 *
 * `loadData()` routinely discovers options that did not exist before the
 * import — a GeoJSON file contributes the numeric property list behind the
 * choropleth selector, a network file changes the achievable node count.
 * The param panel only refreshes on `plugin:<id>:defs`, which used to fire
 * solely when the *user* edited a control, so freshly-imported options
 * stayed invisible until an unrelated edit happened to poke it (the classic
 * "the property only shows up after I switch the projection" report).
 */
export function refreshParamDefs(pluginId: string): void {
  emit(`plugin:${pluginId}:defs`, undefined);
}

export function pluginName(id: string): string {
  const entry = usePluginStore.getState().registry.find((e) => e.id === id);
  return entry?.name ?? id;
}

export { buildPluginApi };
export type { PluginManifest };
