// ==========================================================================
// Sandboxed plugin runtime — executes inside a Web Worker (spec §6.2).
//
// This module runs in a completely separate global scope from the host
// page. It evaluates the .cspkg entry, holds the plugin instance, and
// exposes every host interaction through the postMessage RPC bridge
// defined in `sandbox.ts`. Nothing here touches the host's DOM or globals.
//
// `createPluginWorkerRuntime` is exported for unit testing: the tests drive
// the exact same message handler with a fake Worker instead of a real one.
// ==========================================================================

import { decodeArgs } from './sandbox';
import type {
  ComputeProgress,
  Plugin,
  PluginApi,
  PluginManifest,
  SupportedFormat,
} from '@/types/plugin';

interface RpcRequest {
  id: number;
  method: string;
  args: unknown[];
}

interface ApiReply {
  event: 'api-reply';
  callId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** The host-facing bridge of a running plugin worker. */
export interface PluginWorkerRuntime {
  /** Handle a message received from the host. */
  handleMessage(msg: unknown): Promise<void>;
}

/**
 * Create the worker-side runtime. `postToHost` delivers messages back to
 * the host (postMessage in a real worker; a test harness in unit tests).
 */
export function createPluginWorkerRuntime(
  postToHost: (message: unknown) => void,
): PluginWorkerRuntime {
  const pendingApi = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let apiCallId = 1;
  let plugin: Plugin | null = null;
  let api: PluginApi | null = null;
  let dispatchChain: Promise<void> = Promise.resolve();

  const postReply = (id: number, ok: boolean, payload: unknown) => {
    postToHost({
      id,
      ok,
      result: ok ? payload : undefined,
      error: ok ? undefined : String(payload),
    });
  };

  const callApi = <T = unknown>(method: string, args: unknown[] = []): Promise<T> => {
    const callId = apiCallId++;
    return new Promise<T>((resolve, reject) => {
      pendingApi.set(callId, { resolve: (v) => resolve(v as T), reject });
      postToHost({ event: 'api', callId, method, args });
    });
  };

  /** Proxy over the host PluginApi; every call is forwarded over the bridge. */
  const createApiProxy = (initialLocale: string): PluginApi => ({
    get locale() {
      return initialLocale;
    },
    t: (key, params) => callApi<string>('t', [key, params]) as unknown as string,
    onLocaleChange: (listener) => {
      // Locale push is not yet wired over the bridge; returns a no-op
      // unsubscribe. Plugins should prefer reading `api.locale` fresh.
      void listener;
      return () => undefined;
    },
    setStatus: (status) => callApi('setStatus', [status]),
    reportGpuTime: (ms) => callApi('reportGpuTime', [ms]),
    reportDataScale: (n) => callApi('reportDataScale', [n]),
    notify: (kind, message) => callApi('notify', [kind, message]),
    openFile: () => callApi<File | null>('openFile'),
    readText: (file) => callApi<string>('readText', [file]) as unknown as Promise<string>,
    readBinary: (file) =>
      callApi<ArrayBuffer>('readBinary', [file]) as unknown as Promise<ArrayBuffer>,
    getParam: (key) => callApi('getParam', [key]),
    setParam: (key, value) => callApi('setParam', [key, value]),
  });

  async function dispatch(method: string, args: unknown[]): Promise<unknown> {
    if (!plugin) throw new Error('plugin not booted');

    switch (method) {
      case 'init':
        await plugin.init(api as unknown as PluginApi);
        return undefined;
      case 'destroy':
        await plugin.destroy?.();
        return undefined;
      case 'activate': {
        const container = args[0] as Record<string, unknown>;
        await plugin.activate?.({
          container: {
            canvas2d: container.canvas2d as unknown as HTMLCanvasElement | undefined,
            dom: undefined,
            three: undefined,
            reportDataScale: container.reportDataScale as (n: number) => void,
          },
          api: api as unknown as PluginApi,
        });
        return undefined;
      }
      case 'render': {
        const container = args[0] as Record<string, unknown>;
        await plugin.render?.({
          canvas2d: container.canvas2d as unknown as HTMLCanvasElement | undefined,
          dom: undefined,
          three: undefined,
          reportDataScale: container.reportDataScale as (n: number) => void,
        });
        return undefined;
      }
      case 'deactivate':
        await plugin.deactivate?.();
        return undefined;
      case 'updateParams':
        await plugin.updateParams(args[0] as Record<string, unknown>);
        return undefined;
      case 'getParams':
        return plugin.getParams();
      case 'loadData':
        await plugin.loadData?.(args[0] as File);
        return undefined;
      case 'getSupportedFormats':
        return plugin.getSupportedFormats?.() ?? ([] as SupportedFormat[]);
      case 'compute': {
        const [input, onProgress] = args as [unknown, ((p: ComputeProgress) => void) | undefined];
        const result = await plugin.compute?.(input, onProgress);
        return result ?? { ok: false, error: 'plugin has no compute()' };
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  return {
    async handleMessage(msg: unknown) {
      if ((msg as ApiReply).event === 'api-reply') {
        const reply = msg as ApiReply;
        const p = pendingApi.get(reply.callId);
        if (p) {
          pendingApi.delete(reply.callId);
          if (reply.ok) p.resolve(reply.result);
          else p.reject(new Error(reply.error ?? 'api call failed'));
        }
        return;
      }

      const req = msg as RpcRequest;
      if (typeof req?.id !== 'number' || !req.method) return;

      // Serialize dispatch: a plugin's methods share mutable state and are not
      // reentrant. Without a chain, concurrent calls (e.g. compute + loadData)
      // interleave on `plugin` and produce corrupted output.
      const run = async () => {
        if (req.method === 'boot') {
          const [entrySource, manifest, locale] = req.args as [string, PluginManifest, string];
          try {
            api = createApiProxy(locale ?? 'zh-CN');
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const factory = new Function('api', `"use strict";\n${entrySource}`) as (
              api: PluginApi,
            ) => Plugin;
            const instance = factory(api);
            if (!instance || typeof instance !== 'object') {
              throw new Error('entry did not return a plugin object');
            }
            instance.manifest.id = manifest.id;
            plugin = instance;
            postReply(req.id, true, 'ready');
          } catch (err) {
            postReply(req.id, false, `boot failed: ${String(err)}`);
          }
          return;
        }

        try {
          const sendFn = (event: string, callId: number, fnArgs: unknown[]) => {
            postToHost({ event, callId, args: fnArgs });
          };
          const result = await dispatch(req.method, decodeArgs(req.args ?? [], sendFn));
          postReply(req.id, true, result);
        } catch (err) {
          postReply(req.id, false, err instanceof Error ? err.message : String(err));
        }
      };

      dispatchChain = dispatchChain.then(run, run);
      await dispatchChain;
    },
  };
}

// Real worker bootstrap. Guarded so the module can be imported in test
// environments without a worker global (`self` undefined).
if (typeof self !== 'undefined') {
  const workerSelf = self as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((ev: MessageEvent) => void) | null;
  };
  const runtime = createPluginWorkerRuntime((message) => workerSelf.postMessage(message));
  workerSelf.onmessage = (ev: MessageEvent) => {
    void runtime.handleMessage(ev.data);
  };
}
