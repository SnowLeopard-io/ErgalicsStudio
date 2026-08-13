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
import type {
  ContainerCapabilities,
  ComputeResult,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  SupportedFormat,
} from '@/types/plugin';

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
): unknown[] {
  let nextId = callbacks.size + 1;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'function') {
      const id = nextId++;
      callbacks.set(id, value as (...a: unknown[]) => void);
      return { __fn: id } satisfies FnToken;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
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
  const surfaces: HTMLCanvasElement[] = [];
  let nextCallId = 1;

  const post = (message: unknown, transfer?: Transferable[]) => {
    worker.postMessage(message, transfer ?? []);
  };

  const invoke = <T = unknown>(
    method: string,
    args: unknown[] = [],
    transfer: Transferable[] = [],
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextCallId++;
      pending.set(id, { resolve: (v) => resolve(v as T), reject });
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
            (value) => post({ event: 'api-reply', callId, ok: true, result: value }),
            (err: unknown) => post({ event: 'api-reply', callId, ok: false, error: String(err) }),
          );
        } catch (err) {
          post({ event: 'api-reply', callId, ok: false, error: String(err) });
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

  /** Map a host container to the sandbox-facing descriptor. */
  const toRemoteContainer = (container: ContainerCapabilities): { args: unknown[]; transfer: Transferable[] } => {
    const surface = document.createElement('canvas');
    surface.className = 'sandbox-surface';
    surface.style.width = '100%';
    surface.style.height = '100%';
    const host = container.dom ?? container.canvas2d?.parentElement;
    (host ?? document.body).appendChild(surface);
    surfaces.push(surface);
    const offscreen = surface.transferControlToOffscreen();
    return {
      args: [
        {
          canvas2d: offscreen,
          // dom / three are intentionally unavailable inside the sandbox.
          reportDataScale: (n: number) => container.reportDataScale(n),
        },
      ],
      transfer: [offscreen],
    };
  };

  try {
    await invoke('boot', [options.entrySource, options.manifest]);
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
        for (const s of surfaces) s.remove();
        surfaces.length = 0;
        worker.terminate();
      }
    },
    activate: async (context) => {
      const { args, transfer } = toRemoteContainer(context.container);
      await invoke('activate', args, transfer);
    },
    deactivate: () => {
      // Remove the transferred surface so a sandboxed plugin's canvas
      // never lingers over the next plugin's viewport.
      for (const s of surfaces) s.remove();
      surfaces.length = 0;
      return invoke('deactivate');
    },
    render: (container) => {
      const prev = surfaces.pop();
      if (prev) prev.remove();
      const { args, transfer } = toRemoteContainer(container);
      return invoke('render', args, transfer);
    },
    updateParams: (params) => invoke('updateParams', [params]),
    getParams: () => invoke<ParamDefinition[]>('getParams'),
    loadData: (file) => invoke('loadData', [file]),
    getSupportedFormats: () => invoke<SupportedFormat[]>('getSupportedFormats'),
    compute: (input, onProgress) => {
      const args = encodeArgs([input, onProgress ?? undefined], callbacks);
      return invoke<ComputeResult>('compute', args);
    },
  };

  return { plugin, dispose: () => void plugin.destroy?.() };
}
