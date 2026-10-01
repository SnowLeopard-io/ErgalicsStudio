// Plugin runtime infrastructure: buffered logging, the plugin-scoped result
// cache, and the pluginStore lifecycle fixes (unload → deactivate, snapshot
// resilience, run history).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, configureLogger } from '@/core/logger';
import {
  createPluginCache,
  disposePluginCache,
  clearAllPluginCaches,
  setPluginCacheCap,
} from '@/core/pluginCache';
import { downloadBlob } from '@/core/download';
import { on, emit } from '@/core/events';
import type { ParamDefinition, Plugin, PluginApi, PluginManifest } from '@/types/plugin';

// The project store needs IndexedDB; the plugin store only reads/writes
// parameters through it.
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      project: null,
      setDirty: () => undefined,
    }),
    setState: () => undefined,
  },
}));

const { usePluginStore, setHostContainers } = await import('@/stores/pluginStore');

// ---- helpers --------------------------------------------------------------

function manifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    author: 'test',
    description: 'test plugin',
    entry: id,
  };
}

interface Probe {
  events: string[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A minimal plugin that records lifecycle calls. */
function makePlugin(id: string, probe: Probe, overrides: Partial<Plugin> = {}): Plugin {
  return {
    manifest: manifest(id),
    init: () => {
      probe.events.push('init');
    },
    destroy: () => {
      probe.events.push('destroy');
    },
    activate: () => {
      probe.events.push('activate');
    },
    deactivate: () => {
      probe.events.push('deactivate');
    },
    getParams: (): ParamDefinition[] => [
      { key: 'size', label: 'Size', type: 'number', value: 3 },
    ],
    ...overrides,
  } as Plugin;
}

const fakeHost = {
  dom: {} as HTMLDivElement,
  canvas2d: {} as HTMLCanvasElement,
  reportDataScale: () => undefined,
};

beforeEach(async () => {
  clearAllPluginCaches();
  logger.clear();
  configureLogger({ level: 'debug', bufferSize: 500 });
  setHostContainers(fakeHost);
  await usePluginStore.getState().deactivate();
  for (const entry of usePluginStore.getState().registry) {
    await usePluginStore.getState().unload(entry.id);
  }
  usePluginStore.setState({ registry: [], activeId: null, runHistory: [], loadingIds: [] });
});

// ---- logger ---------------------------------------------------------------

describe('logger buffer', () => {
  it('records scoped entries and exports them as text and JSON', () => {
    logger.info('plugin:example.a', 'loaded', { rows: 10 });
    logger.error('plugin:example.b', 'boom', new Error('nope'));

    const entries = logger.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.scope).toBe('plugin:example.a');
    // Errors must keep their message instead of stringifying to "{}".
    expect(entries[1]?.message).toContain('nope');

    expect(logger.exportText()).toContain('[plugin:example.a]');
    const parsed = JSON.parse(logger.exportJson()) as Array<{ level: string }>;
    expect(parsed.map((r) => r.level)).toEqual(['info', 'error']);
  });

  it('trims to the configured buffer size (bounded ring)', () => {
    configureLogger({ bufferSize: 3 });
    for (let i = 0; i < 10; i += 1) logger.info('t', `line ${i}`);
    expect(logger.entries()).toHaveLength(3);
    expect(logger.entries()[2]?.message).toBe('line 9');
    configureLogger({ bufferSize: 500 });
  });

  it('can be disabled entirely', () => {
    configureLogger({ bufferSize: 0 });
    logger.info('t', 'invisible');
    expect(logger.entries()).toHaveLength(0);
    configureLogger({ bufferSize: 500 });
  });
});

// ---- plugin cache ---------------------------------------------------------

describe('plugin cache', () => {
  it('stores, reads and deletes values', async () => {
    const cache = createPluginCache('p1');
    await cache.set('grid', [1, 2, 3]);
    expect(await cache.get<number[]>('grid')).toEqual([1, 2, 3]);
    expect(await cache.keys()).toEqual(['grid']);
    expect(await cache.delete('grid')).toBe(true);
    expect(await cache.get('grid')).toBeUndefined();
    expect(await cache.delete('grid')).toBe(false);
  });

  it('isolates plugins and supports clear()', async () => {
    const a = createPluginCache('a');
    const b = createPluginCache('b');
    await a.set('k', 1);
    expect(await b.get('k')).toBeUndefined();
    await a.clear();
    expect(await a.keys()).toEqual([]);
  });

  it('expires entries after their TTL', async () => {
    const cache = createPluginCache('ttl');
    await cache.set('k', 'v', 10);
    expect(await cache.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 25));
    expect(await cache.get('k')).toBeUndefined();
    // Expired entries must not be reported as live keys either.
    expect(await cache.keys()).toEqual([]);
  });

  it('evicts the least recently used entry at the cap', async () => {
    setPluginCacheCap('lru', 2);
    const cache = createPluginCache('lru');
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.get('a'); // refresh `a`
    await cache.set('c', 3);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
  });

  it('releases the store on dispose', async () => {
    const cache = createPluginCache('gone');
    await cache.set('k', 1);
    disposePluginCache('gone');
    expect(await cache.get('k')).toBeUndefined();
  });
});

// ---- download -------------------------------------------------------------

describe('downloadBlob', () => {
  it('is a no-op without a DOM instead of throwing', () => {
    expect(() => downloadBlob('x.txt', 'hello')).not.toThrow();
  });
});

// ---- param definition refresh ---------------------------------------------

describe('refreshParamDefs', () => {
  it('emits plugin:<id>:defs so an import can publish new options', async () => {
    const { refreshParamDefs } = await import('@/stores/pluginStore');
    const seen: string[] = [];
    const sub = on('plugin:example.geo:defs', () => seen.push('defs'));
    refreshParamDefs('example.geo');
    sub.unsubscribe();
    // An import (e.g. a GeoJSON file adding choropleth properties) changes
    // the parameter set itself; the panel only re-reads getParams() on this
    // event, so without it new options stayed invisible until some unrelated
    // control happened to be edited.
    expect(seen).toEqual(['defs']);
  });
});

// ---- plugin store lifecycle ----------------------------------------------

describe('pluginStore lifecycle', () => {
  it('deactivates an active plugin before unloading it', async () => {
    const probe: Probe = { events: [] };
    const plugin = makePlugin('example.lifecycle', probe);
    await usePluginStore.getState().load(plugin);
    await usePluginStore.getState().activate('example.lifecycle');
    expect(usePluginStore.getState().activeId).toBe('example.lifecycle');

    await usePluginStore.getState().unload('example.lifecycle');

    // Without the fix `deactivate` never ran: a 3-D plugin's scene stayed
    // visible and its animation loop kept running after unload.
    expect(probe.events).toEqual(['init', 'activate', 'deactivate', 'destroy']);
    expect(usePluginStore.getState().activeId).toBeNull();
    expect(usePluginStore.getState().registry).toHaveLength(0);
  });

  it('loads a plugin only once under concurrent load() calls', async () => {
    const probe: Probe = { events: [] };
    const plugin = makePlugin('example.race', probe);
    await Promise.all([
      usePluginStore.getState().load(plugin),
      usePluginStore.getState().load(plugin),
    ]);
    expect(probe.events.filter((e) => e === 'init')).toHaveLength(1);
  });

  it('keeps other plugins when one getParams() throws during a snapshot', async () => {
    await usePluginStore.getState().load(makePlugin('example.ok', { events: [] }));
    await usePluginStore.getState().load(
      makePlugin('example.broken', { events: [] }, {
        getParams: () => {
          throw new Error('boom');
        },
      }),
    );

    const snapshot = await usePluginStore.getState().getAllParams();
    expect(snapshot['example.ok']).toEqual({ size: 3 });
    // A throwing plugin is skipped instead of failing the whole project save.
    expect(snapshot['example.broken']).toBeUndefined();
  });

  it('fans project lifecycle hooks out and swallows hook failures', async () => {
    const calls: string[] = [];
    await usePluginStore.getState().load(
      makePlugin('example.hooks', { events: [] }, {
        onProjectSave: () => {
          calls.push('save');
        },
        onProjectLoad: () => {
          throw new Error('hook exploded');
        },
      }),
    );

    usePluginStore.getState().notifyProjectLifecycle('save');
    expect(() => usePluginStore.getState().notifyProjectLifecycle('load')).not.toThrow();
    await Promise.resolve();
    expect(calls).toEqual(['save']);
  });
});

// ---- run history & traceability ------------------------------------------

describe('project plugin restoration', () => {
  beforeEach(() => {
    vi.spyOn(usePluginStore.getState(), 'ensureBuiltinsLoaded').mockResolvedValue(undefined);
  });

  it('restores an active plugin and its stored parameters', async () => {
    const updateParams = vi.fn();
    await usePluginStore.getState().load(makePlugin('restore.active', { events: [] }, { updateParams }));
    await usePluginStore.getState().restoreState({ state: {
      activePlugin: 'restore.active', parameters: { 'restore.active': { size: 8 } },
    } });
    expect(usePluginStore.getState().activeId).toBe('restore.active');
    expect(updateParams).toHaveBeenLastCalledWith({ size: 8 });
  });

  it('deactivates the previous plugin when the opened project has no active plugin', async () => {
    const deactivate = vi.fn();
    await usePluginStore.getState().load(makePlugin('restore.empty', { events: [] }, { deactivate }));
    await usePluginStore.getState().activate('restore.empty');
    await usePluginStore.getState().restoreState({ state: { activePlugin: null } });
    expect(usePluginStore.getState().activeId).toBeNull();
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it('discards a restoration that resumes after a newer project has restored', async () => {
    const updateParams = vi.fn();
    await usePluginStore.getState().load(makePlugin('restore.params', { events: [] }, { updateParams }));
    const loading = deferred<void>();
    vi.mocked(usePluginStore.getState().ensureBuiltinsLoaded).mockReturnValueOnce(loading.promise);
    const lifecycle = vi.spyOn(usePluginStore.getState(), 'notifyProjectLifecycle');
    const old = usePluginStore.getState().restoreState({ state: { parameters: { 'restore.params': { size: 1 } } } });
    await usePluginStore.getState().restoreState({ state: { parameters: { 'restore.params': { size: 2 } } } });
    loading.resolve();
    await old;
    expect(updateParams).toHaveBeenCalledExactlyOnceWith({ size: 2 });
    expect(lifecycle).toHaveBeenCalledExactlyOnceWith('load');
  });

  it('invalidates a pending restore on explicit deactivation (create/remove/mode switch)', async () => {
    await usePluginStore.getState().load(makePlugin('restore.cancel', { events: [] }));
    const loading = deferred<void>();
    vi.mocked(usePluginStore.getState().ensureBuiltinsLoaded).mockReturnValueOnce(loading.promise);
    const old = usePluginStore.getState().restoreState({ state: { activePlugin: 'restore.cancel' } });
    await usePluginStore.getState().deactivate();
    loading.resolve();
    await old;
    expect(usePluginStore.getState().activeId).toBeNull();
  });

  it('applies the newer params last even when the older update RPC has already started', async () => {
    let value = 0;
    const started = deferred<void>();
    const rpc = deferred<void>();
    await usePluginStore.getState().load(makePlugin('restore.rpc', { events: [] }, {
      updateParams: async (params) => {
        if (params.size === 1) { started.resolve(); await rpc.promise; }
        value = params.size as number;
      },
    }));
    const lifecycle = vi.spyOn(usePluginStore.getState(), 'notifyProjectLifecycle');
    const old = usePluginStore.getState().restoreState({ state: { parameters: { 'restore.rpc': { size: 1 } } } });
    await started.promise;
    const latest = usePluginStore.getState().restoreState({ state: { parameters: { 'restore.rpc': { size: 2 } } } });
    rpc.resolve();
    await Promise.all([old, latest]);
    expect(value).toBe(2);
    expect(lifecycle).toHaveBeenCalledExactlyOnceWith('load');
  });

  it('cleans up an old activation superseded by opening an empty project', async () => {
    const started = deferred<void>();
    const rpc = deferred<void>();
    const deactivate = vi.fn();
    await usePluginStore.getState().load(makePlugin('restore.slow', { events: [] }, {
      activate: () => { started.resolve(); return rpc.promise; }, deactivate,
    }));
    const old = usePluginStore.getState().restoreState({ state: { activePlugin: 'restore.slow' } });
    await started.promise;
    const latest = usePluginStore.getState().restoreState({ state: { activePlugin: null } });
    rpc.resolve();
    await Promise.all([old, latest]);
    expect(usePluginStore.getState().activeId).toBeNull();
    expect(deactivate).toHaveBeenCalledOnce();
  });
});

describe('run history', () => {
  it('records duration and outcome for a tracked run', async () => {
    const store = usePluginStore.getState();
    const runId = store.beginRun({ pluginId: 'example.x', kind: 'data-import', label: 'a.csv' });
    usePluginStore.getState().finishRun(runId, true);

    const [run] = usePluginStore.getState().runHistory;
    expect(run?.kind).toBe('data-import');
    expect(run?.label).toBe('a.csv');
    expect(run?.ok).toBe(true);
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
    expect(run?.endedAt).toBeDefined();
  });

  it('records the failure message for a failed run', () => {
    const id = usePluginStore.getState().beginRun({ pluginId: 'example.x', kind: 'compute' });
    usePluginStore.getState().finishRun(id, false, 'kernel compile failed');
    expect(usePluginStore.getState().runHistory[0]?.error).toBe('kernel compile failed');
  });

  it('exports a diagnostics bundle with parameters, runs and logs', async () => {
    await usePluginStore.getState().load(makePlugin('example.diag', { events: [] }));
    const id = usePluginStore.getState().beginRun({ pluginId: 'example.diag', kind: 'compute' });
    usePluginStore.getState().finishRun(id, true);
    logger.info('plugin:example.diag', 'hello');

    const bundle = JSON.parse(await usePluginStore.getState().exportDiagnostics()) as {
      parameters: Record<string, { version: string; params: Record<string, unknown> }>;
      runs: unknown[];
      logs: unknown[];
    };
    expect(bundle.parameters['example.diag']?.version).toBe('1.0.0');
    expect(bundle.parameters['example.diag']?.params).toEqual({ size: 3 });
    expect(bundle.runs).toHaveLength(1);
    expect(bundle.logs.length).toBeGreaterThan(0);
  });

  it('snapshots plugin versions alongside parameters', async () => {
    await usePluginStore.getState().load(makePlugin('example.snap', { events: [] }));
    const snapshot = await usePluginStore.getState().exportParameterSnapshot();
    expect(snapshot.plugins['example.snap']?.version).toBe('1.0.0');
    expect(snapshot.plugins['example.snap']?.params).toEqual({ size: 3 });
  });
});

// ---- api surface ----------------------------------------------------------

describe('plugin api surface', () => {
  it('exposes log, exportFile and cache to plugins', async () => {
    // Captured through an object: a bare `let api: PluginApi | null` is
    // narrowed to `never` by control-flow analysis after the callback.
    const captured: { api: PluginApi | null } = { api: null };
    const plugin = makePlugin('example.api', { events: [] }, {
      init: (api: PluginApi) => {
        captured.api = api;
      },
    });
    await usePluginStore.getState().load(plugin);
    const api = captured.api;
    expect(api).not.toBeNull();
    expect(typeof api?.log).toBe('function');
    expect(typeof api?.exportFile).toBe('function');
    expect(typeof api?.cache?.get).toBe('function');

    // `log` must reach the host buffer under the plugin's own scope.
    api?.log('warn', 'careful');
    expect(logger.entries().some((e) => e.scope === 'plugin:example.api')).toBe(true);
  });
});

// ---- parameter round-trip ordering ---------------------------------------

describe('parameter round-trip ordering', () => {
  it('re-reads the definitions only after updateParams has been applied', async () => {
    let running = false;
    const plugin = makePlugin('example.toggle', { events: [] }, {
      getParams: (): ParamDefinition[] => [
        { key: 'start', label: 'Run', type: 'toggle', value: running },
      ],
      // Async on purpose — a sandboxed plugin answers updateParams over RPC.
      updateParams: async (params: Record<string, unknown>) => {
        await Promise.resolve();
        if (typeof params.start === 'boolean') running = params.start;
      },
    });
    await usePluginStore.getState().load(plugin);
    await usePluginStore.getState().activate('example.toggle');

    // Whatever `getParams()` reports the moment `defs` fires is exactly what
    // the param panel paints.
    const seen: { value: unknown } = { value: undefined };
    const sub = on('plugin:example.toggle:defs', () => {
      const defs = plugin.getParams() as ParamDefinition[];
      const def = defs.find((d) => d.key === 'start');
      seen.value = def && 'value' in def ? def.value : undefined;
    });

    emit('plugin:example.toggle:params', { start: true });
    await vi.waitFor(() => expect(seen.value).toBe(true));
    sub.unsubscribe();

    // The old order emitted `defs` synchronously, before the queued
    // updateParams ran, so the panel read the pre-click value: the label
    // lagged one click behind the action and every Start/Stop toggle
    // appeared to need two clicks.
    expect(seen.value).toBe(true);
    expect(running).toBe(true);
  });
});
