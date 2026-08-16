// ==========================================================================
// Plugin sandbox (spec §6.2 — independent execution context)
// ==========================================================================
//
// Third-party .cspkg entry code is executed inside a Web Worker instead of
// the host page. A worker has its own global scope, no DOM, and no access
// to the app's window/document/localStorage/stores — this is the security
// boundary. The host and the worker talk over a postMessage RPC bridge:
//
//   host → worker : { id, method, args }                 (invoke lifecycle)
//   worker → host : { id, ok, result | error }           (reply)
//   worker → host : { event: 'api', callId, method, args }  (api call)
//   worker → host : { event: 'fn', callId, args }        (callback invoke)
//   worker → host : { event: 'log', level, message }     (worker logging)
//
// Callbacks (e.g. compute onProgress) cannot be structured-cloned, so they
// are replaced by `{ __fn: id }` tokens (see encodeArgs/decodeArgs) and
// dispatched back via the `fn` event. The api object handed to the plugin
// inside the worker is a proxy that forwards every call to the host side.
//
// Rendering: sandboxed plugins draw on a canvas2d. The host creates a fresh
// <canvas>, transfers it as an OffscreenCanvas into the worker
// (`transferControlToOffscreen`), and the worker's draw calls are composited
// back onto the visible element automatically. `dom` and `three` handles
// are intentionally unavailable inside the sandbox.
//
// When Web Workers are unavailable (or the worker fails to boot), execution
// falls back to a best-effort strict-mode `new Function` with dangerous
// globals shadowed — an approximation, NOT a security boundary. The caller
// is notified so the user can make an informed decision.

import { logger } from './logger';
import { dictionaries } from '@/i18n';
import type {
  ContainerCapabilities,
  ComputeResult,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  SupportedFormat,
} from '@/types/plugin';

/**
 * Monotonic token id allocator. Deriving ids from `callbacks.size + 1` let
 * two interleaved `compute()` calls (host does not serialize them) reuse ids
 * after cleanup pruned the tail, silently overwriting a live callback.
 */
let nextFnId = 1;

// ---- RPC protocol helpers (pure, unit-testable) ----

/** Functions replaced by this token during structured-clone serialization. */
export interface FnToken {
  __fn: number;
}

function isFnToken(value: unknown): value is FnToken {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as FnToken).__fn === 'number'
  );
}

/**
 * Replace callable values with `{ __fn: id }` tokens so arguments survive
 * postMessage structured clone. Registered callbacks are keyed by id.
 */
export function encodeArgs(
  args: unknown[],
  callbacks: Map<number, (...a: unknown[]) => void>,
  created?: Set<number>,
): unknown[] {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'function') {
      const id = nextFnId++;
      callbacks.set(id, value as (...a: unknown[]) => void);
      created?.add(id);
      return { __fn: id } satisfies FnToken;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      // Structured-cloneable host objects must pass through untouched:
      // rebuilding them as plain objects drops getContext()/.text()/etc.
      // and — worse — an OffscreenCanvas rebuilt this way is no longer in
      // the message while it is still in the transfer list, which makes
      // postMessage throw DataCloneError.
      // Typed arrays / DataView must also pass through: Object.entries() on a
      // Float64Array flattens it into `{0,1,2,...}`, silently converting a
      // 4-byte-per-element buffer into thousands of boxed number entries.
      if (
        ArrayBuffer.isView(value) ||
        (typeof File !== 'undefined' && value instanceof File) ||
        (typeof Blob !== 'undefined' && value instanceof Blob) ||
        (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
      ) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };
  return args.map(walk);
}

/**
 * Restore fn tokens into callable proxies inside the worker. Each proxy
 * forwards its invocation to the host via the `fn` event.
 */
export function decodeArgs(
  args: unknown[],
  send: (event: string, callId: number, args: unknown[]) => void,
): unknown[] {
  const walk = (value: unknown): unknown => {
    if (isFnToken(value)) {
      const callId = value.__fn;
      return (...callArgs: unknown[]) => send('fn', callId, callArgs);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      // File/Blob/OffscreenCanvas survive structured clone and must pass
      // through untouched: rebuilding them as plain objects would drop
      // .text()/.arrayBuffer()/.slice()/getContext() and break sandboxed
      // loadData / api.readText round trips and canvas rendering. Typed
      // arrays likewise (see encodeArgs).
      if (ArrayBuffer.isView(value)) return value;
      if (typeof File !== 'undefined' && value instanceof File) return value;
      if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
      if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };
  return args.map(walk);
}

// ---- Best-effort fallback (no Worker available) ----

/** Globals shadowed to `undefined` in the legacy fallback factory. */
const SHADOWED_GLOBALS = [
  'window',
  'document',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'importScripts',
  'localStorage',
  'sessionStorage',
  'indexedDB',
] as const;

/**
 * Evaluate a plugin entry (a function body receiving `api`) in a hardened
 * strict-mode function scope. This is a best-effort approximation — a
 * determined attacker can escape (e.g. via constructor chains). Prefer the
 * worker sandbox; this path exists only as a fallback.
 *
 * Note: the shadowed globals are declared as plain parameters (no default
 * values) because a `"use strict"` directive is illegal in a function with
 * a non-simple parameter list; the caller passes `undefined` explicitly.
 */
export function evaluatePluginLegacy(entrySource: string, api: PluginApi): Plugin {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'api',
    ...SHADOWED_GLOBALS,
    `"use strict";\n${entrySource}`,
  ) as (api: PluginApi, ...shadowed: unknown[]) => Plugin;
  const plugin = factory(api, ...SHADOWED_GLOBALS.map(() => undefined));
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('plugin entry did not return a plugin object');
  }
  return plugin;
}

// ---- Worker sandbox ----

export interface SandboxOptions {
  entrySource: string;
  manifest: PluginManifest;
  /** Host-side api for the plugin id, used to answer worker api calls. */
  getApi: (pluginId: string) => PluginApi;
  /**
   * Worker constructor injection point (tests use a fake). Defaults to the
   * platform Worker.
   */
  workerCtor?: new (scriptURL: string | URL, options?: WorkerOptions) => Worker;
}

export interface SandboxedPlugin {
  plugin: Plugin;
  /** Stop the worker and release the render surface. */
  dispose(): void;
  /** Push a locale change into the worker so `api.locale`/`api.t` stay live. */
  setLocale(locale: string): void;
}

/**
 * Create a plugin proxy backed by a sandboxed Web Worker.
 * Resolves to null when workers are unavailable or the entry failed to
 * boot inside the worker.
 */
export async function createPluginSandbox(
  options: SandboxOptions,
): Promise<SandboxedPlugin | null> {
  const WorkerCtor = options.workerCtor ?? (typeof Worker === 'function' ? Worker : null);
  if (!WorkerCtor) {
    logger.warn('sandbox', 'Web Worker unavailable — falling back to legacy execution');
    return null;
  }

  let worker: Worker;
  try {
    // Vite bundles plugin-worker.ts as a module worker.
    worker = new WorkerCtor(new URL('./plugin-worker.ts', import.meta.url), {
      type: 'module',
      name: `cspkg:${options.manifest.id}`,
    });
  } catch (err) {
    logger.warn('sandbox', 'worker creation failed — falling back to legacy execution', err);
    return null;
  }

  const pluginId = options.manifest.id;
  const api = options.getApi(pluginId);
  const callbacks = new Map<number, (...a: unknown[]) => void>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const surfaces: { el: HTMLCanvasElement; callbacks: Set<number> }[] = [];
  let nextCallId = 1;

  const post = (message: unknown, transfer?: Transferable[]) => {
    try {
      worker.postMessage(message, transfer ?? []);
    } catch (err) {
      // A message that fails structured clone (e.g. a host object that cannot
      // be cloned into the worker) must reject its pending call — otherwise
      // the caller awaits forever.
      logger.error('sandbox', 'postMessage failed', err);
      const msg = message as { id?: number } | null;
      if (typeof msg?.id === 'number' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        p.reject(new Error(`failed to send message to worker: ${String(err)}`));
      }
    }
  };

  /** Reply to a worker api call. If the host result cannot be structured
   *  cloned (functions, cycles, live contexts), reply with an error instead of
   *  stranding the worker's pending `await` forever. */
  const postReply = (message: Record<string, unknown>) => {
    try {
      post(message);
    } catch (err) {
      logger.warn('sandbox', 'api reply not serializable, replying with error', err);
      post({
        event: 'api-reply',
        callId: message.callId,
        ok: false,
        error: `host api result could not be serialized: ${String(err)}`,
      });
    }
  };

  const invoke = <T = unknown>(
    method: string,
    args: unknown[] = [],
    transfer: Transferable[] = [],
    cleanup: (() => void) | null = null,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextCallId++;
      pending.set(id, {
        resolve: (v) => {
          cleanup?.();
          resolve(v as T);
        },
        reject: (e) => {
          cleanup?.();
          reject(e);
        },
      });
      post({ id, method, args }, transfer);
    });

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as Record<string, unknown>;
    if (typeof msg?.id === 'number' && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(String(msg.error ?? 'plugin call failed')));
      return;
    }
    switch (msg.event) {
      case 'api': {
        const callId = msg.callId as number;
        const method = msg.method as keyof PluginApi;
        const fn = (api as unknown as Record<string, unknown>)[method];
        try {
          const result =
            typeof fn === 'function'
              ? (fn as (...a: unknown[]) => unknown)(...(msg.args as unknown[]))
              : undefined;
          Promise.resolve(result).then(
            (value) => postReply({ event: 'api-reply', callId, ok: true, result: value }),
            (err: unknown) => postReply({ event: 'api-reply', callId, ok: false, error: String(err) }),
          );
        } catch (err) {
          postReply({ event: 'api-reply', callId, ok: false, error: String(err) });
        }
        break;
      }
      case 'fn': {
        const cb = callbacks.get(msg.callId as number);
        if (cb) cb(...(msg.args as unknown[]));
        break;
      }
      case 'log': {
        const level = msg.level as 'info' | 'warn' | 'error';
        (logger[level] ?? logger.info).call(logger, `plugin:${pluginId}`, msg.message);
        break;
      }
      default:
        break;
    }
  };

  worker.onerror = (ev) => {
    logger.error('sandbox', `worker error for ${pluginId}`, ev.message);
    for (const [, p] of pending) p.reject(new Error(`worker error: ${ev.message}`));
    pending.clear();
  };

  // A worker that dies without firing `onerror` (terminate, messageerror,
  // cross-origin restrictions) must not leave callers awaiting forever.
  worker.onmessageerror = (ev) => {
    logger.error('sandbox', `worker message error for ${pluginId}`, ev);
    for (const [, p] of pending) p.reject(new Error('worker message error'));
    pending.clear();
  };

  /** Remove a transferred surface and release every callback it registered. */
  const removeSurface = (entry: { el: HTMLCanvasElement; callbacks: Set<number> }) => {
    entry.el.remove();
    for (const fid of entry.callbacks) callbacks.delete(fid);
  };

  /** Map a host container to the sandbox-facing descriptor. */
  const toRemoteContainer = (container: ContainerCapabilities): { args: unknown[]; transfer: Transferable[] } => {
    const surface = document.createElement('canvas');
    surface.className = 'sandbox-surface';
    surface.style.width = '100%';
    surface.style.height = '100%';
    const host = container.dom ?? container.canvas2d?.parentElement;
    (host ?? document.body).appendChild(surface);
    const created = new Set<number>();
    const entry = { el: surface, callbacks: created };
    let offscreen: OffscreenCanvas;
    try {
      offscreen = surface.transferControlToOffscreen();
    } catch (err) {
      // Never leave a half-attached surface in the DOM when control transfer
      // fails (e.g. the canvas is already controlled): remove it and rethrow.
      surface.remove();
      throw err;
    }
    surfaces.push(entry);
    return {
      // reportDataScale is a function and cannot be structured-cloned; encode
      // it as an `__fn` token so postMessage does not throw DataCloneError.
      // The token is pruned together with the surface (removeSurface) so the
      // callbacks map cannot grow without bound across activate/render.
      args: encodeArgs(
        [
          {
            canvas2d: offscreen,
            // dom / three are intentionally unavailable inside the sandbox.
            reportDataScale: (n: number) => container.reportDataScale(n),
          },
        ],
        callbacks,
        created,
      ),
      transfer: [offscreen],
    };
  };

  /** If an activate/render invocation fails, remove the surface it just
   *  attached so it does not linger over the next plugin's viewport. */
  const dropLastSurface = () => {
    const last = surfaces.pop();
    if (last) removeSurface(last);
  };

  try {
    // Send the current host locale + translation tables so a sandboxed
    // plugin's api.locale is accurate from boot and api.t() resolves
    // synchronously and correctly.
    await invoke('boot', [options.entrySource, options.manifest, api.locale, dictionaries]);
  } catch (err) {
    logger.error('sandbox', `plugin ${pluginId} failed to boot in worker`, err);
    worker.terminate();
    return null;
  }

  const plugin: Plugin = {
    manifest: options.manifest,
    init: () => invoke('init'),
    destroy: async () => {
      try {
        await invoke('destroy');
      } finally {
        for (const s of surfaces) removeSurface(s);
        surfaces.length = 0;
        worker.terminate();
      }
    },
    activate: async (context) => {
      const { args, transfer } = toRemoteContainer(context.container);
      try {
        await invoke('activate', args, transfer);
      } catch (err) {
        dropLastSurface();
        throw err;
      }
    },
    deactivate: () => {
      // Remove the transferred surface so a sandboxed plugin's canvas
      // never lingers over the next plugin's viewport.
      for (const s of surfaces) removeSurface(s);
      surfaces.length = 0;
      return invoke('deactivate');
    },
    render: (container) => {
      const prev = surfaces.pop();
      if (prev) removeSurface(prev);
      const { args, transfer } = toRemoteContainer(container);
      return invoke<void>('render', args, transfer).catch((err) => {
        dropLastSurface();
        throw err;
      });
    },
    updateParams: (params) => invoke('updateParams', [params]),
    getParams: () => invoke<ParamDefinition[]>('getParams'),
    loadData: (file) => invoke('loadData', [file]),
    getSupportedFormats: () => invoke<SupportedFormat[]>('getSupportedFormats'),
    compute: (input, onProgress) => {
      const created = new Set<number>();
      const args = encodeArgs([input, onProgress ?? undefined], callbacks, created);
      // Prune the registered callback closures once the call settles so the
      // callbacks map cannot grow unboundedly across compute() invocations.
      return invoke<ComputeResult>(
        'compute',
        args,
        [],
        () => {
          for (const fid of created) callbacks.delete(fid);
        },
      );
    },
  };

  return {
    plugin,
    dispose: () => void plugin.destroy?.(),
    setLocale: (nextLocale: string) => {
      post({ event: 'set-locale', locale: nextLocale });
    },
  };
}
