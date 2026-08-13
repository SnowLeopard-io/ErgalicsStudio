// Plugin sandbox tests (spec §6.2)
// Covers: RPC encode/decode helpers, the legacy fallback executor, and a
// full end-to-end RPC round trip through a fake Worker.
import { describe, it, expect, vi } from 'vitest';
import {
  createPluginSandbox,
  encodeArgs,
  decodeArgs,
  evaluatePluginLegacy,
} from '@/core/sandbox';
import { createPluginWorkerRuntime } from '@/core/plugin-worker';
import type { PluginApi, PluginManifest } from '@/types/plugin';

const MANIFEST: PluginManifest = {
  id: 'com.example.demo',
  name: 'Demo',
  version: '1.0.0',
  author: 'test',
  description: 'demo',
  entry: 'dist/index.js',
  sandbox: 'isolated',
};

function makeApi(): PluginApi {
  return {
    locale: 'zh-CN',
    t: vi.fn((k: string) => k),
    onLocaleChange: vi.fn(() => () => undefined),
    setStatus: vi.fn(),
    reportGpuTime: vi.fn(),
    reportDataScale: vi.fn(),
    notify: vi.fn(),
    openFile: vi.fn(async () => null),
    readText: vi.fn(async () => ''),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    getParam: vi.fn(() => undefined),
    setParam: vi.fn(),
  } as unknown as PluginApi;
}

// ---- encodeArgs / decodeArgs ----

describe('RPC encode/decode helpers', () => {
  it('replaces functions with fn tokens and back', () => {
    const callbacks = new Map<number, (...a: unknown[]) => void>();
    const sent: { event: string; callId: number; args: unknown[] }[] = [];
    const fn = (...a: unknown[]) => a;
    const encoded = encodeArgs([{ cb: fn, n: 1 }], callbacks) as [{ cb: { __fn: number }; n: number }];
    expect(typeof encoded[0].cb).toBe('object');
    expect(encoded[0].cb.__fn).toBe(1);
    expect(encoded[0].n).toBe(1);

    const decoded = decodeArgs(
      [{ cb: { __fn: 1 } }],
      (event, callId, args) => sent.push({ event, callId, args }),
    ) as [{ cb: (...a: unknown[]) => void }];
    expect(typeof decoded[0].cb).toBe('function');
    decoded[0].cb('a', 2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ event: 'fn', callId: 1, args: ['a', 2] });
  });

  it('does not touch primitives and arrays', () => {
    const callbacks = new Map<number, (...a: unknown[]) => void>();
    expect(encodeArgs([42, 'x', [1, 2], null, undefined], callbacks)).toEqual([42, 'x', [1, 2], null, undefined]);
  });
});

// ---- legacy fallback executor ----

describe('evaluatePluginLegacy', () => {
  it('passes the real host api into the entry (regression: undefined was passed)', () => {
    const api = makeApi();
    const plugin = evaluatePluginLegacy(
      `
      return {
        manifest: { id: 'x', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
        init() {}, destroy() {}, activate() {}, deactivate() {},
        getParams() { return [{ key: 'loc', label: 'loc', type: 'text', value: api.locale }]; },
      };
      `,
      api,
    );
    const params = plugin.getParams() as { value: string }[];
    expect(params[0]?.value).toBe('zh-CN');
  });

  it('shadows dangerous globals in strict mode', () => {
    const plugin = evaluatePluginLegacy(
      `
      return {
        manifest: { id: 'x', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
        init() {}, destroy() {}, activate() {}, deactivate() {},
        getParams() {
          return [
            { key: 'w', label: 'w', type: 'text', value: typeof window },
            { key: 'g', label: 'g', type: 'text', value: typeof globalThis },
            { key: 's', label: 's', type: 'text', value: typeof localStorage },
          ];
        },
      };
      `,
      makeApi(),
    );
    const values = (plugin.getParams() as { value: string }[]).map((p) => p.value);
    expect(values).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('throws when the entry returns a non-object', () => {
    expect(() => evaluatePluginLegacy('return null;', makeApi())).toThrow('plugin object');
  });
});

// ---- end-to-end RPC through a fake Worker ----

class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private runtime = createPluginWorkerRuntime((msg) => {
    queueMicrotask(() => this.onmessage?.({ data: msg }));
  });
  private chain: Promise<void> = Promise.resolve();
  terminated = false;

  constructor(_scriptURL: string | URL, _opts?: WorkerOptions) {}

  postMessage(msg: unknown, _transfer?: Transferable[]): void {
    this.chain = this.chain.then(() => this.runtime.handleMessage(msg));
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('createPluginSandbox (worker RPC)', () => {
  const ENTRY = `
    let internal;
    return {
      manifest: { id: 'x', name: 'x', version: '0', author: 'a', description: 'd', entry: 'e' },
      async init(api) { internal = api; },
      destroy() {},
      activate() {},
      deactivate() {},
      getParams() {
        return [{ key: 'count', label: 'Count', type: 'range', min: 1, max: 10, step: 1, value: 5 }];
      },
      async compute(input, onProgress) {
        onProgress({ done: 1, total: 2 });
        internal.notify('info', 'done-' + input);
        return { ok: true };
      },
    };
  `;

  it('boots the entry in the worker and round-trips lifecycle + api calls', async () => {
    const api = makeApi();
    const sandboxed = await createPluginSandbox({
      entrySource: ENTRY,
      manifest: MANIFEST,
      getApi: () => api,
      workerCtor: FakeWorker as unknown as typeof Worker,
    });
    expect(sandboxed).not.toBeNull();
    const { plugin } = sandboxed!;

    await plugin.init(makeApi());

    const params = await plugin.getParams();
    expect((params[0] as { value: number }).value).toBe(5);

    expect(plugin.compute).toBeDefined();
    const onProgress = vi.fn();
    const result = await plugin.compute!('hello', onProgress);
    expect(result.ok).toBe(true);
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 2 });
    expect(api.notify).toHaveBeenCalledWith('info', 'done-hello');

    await plugin.destroy();
  });

  it('resolves null when the entry fails to boot', async () => {
    const sandboxed = await createPluginSandbox({
      entrySource: 'throw new Error("boom");',
      manifest: MANIFEST,
      getApi: () => makeApi(),
      workerCtor: FakeWorker as unknown as typeof Worker,
    });
    expect(sandboxed).toBeNull();
  });

  it('resolves null when workers are unavailable', async () => {
    const sandboxed = await createPluginSandbox({
      entrySource: ENTRY,
      manifest: MANIFEST,
      getApi: () => makeApi(),
      workerCtor: undefined,
    });
    expect(sandboxed).toBeNull();
  });
});
