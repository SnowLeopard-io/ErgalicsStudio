# Plugin Development

## The Plugin interface

Every plugin implements the `Plugin` contract (`src/types/plugin.ts`):

```ts
interface Plugin {
  readonly manifest: PluginManifest;
  init(api: PluginApi): Promise<void> | void;
  destroy(): Promise<void> | void;
  activate(context: PluginRenderContext): Promise<void> | void;
  deactivate(): Promise<void> | void;
  render?(container: ContainerCapabilities): Promise<void> | void;
  updateParams(params: Record<string, unknown>): Promise<void> | void;
  getParams(): ParamDefinition[] | Promise<ParamDefinition[]>;
  compute?(input, onProgress?): Promise<ComputeResult>;
  loadData?(file: File): Promise<void> | void;
  getSupportedFormats?(): SupportedFormat[] | Promise<SupportedFormat[]>;
  renderToScene?(scene: Scene3DHandle): Promise<void> | void;
}
```

The host drives the lifecycle:

1. **load** — the module factory runs, then `init(api)` is called with the
   host `PluginApi`.
2. **activate** — the plugin receives `{ container, api }` and renders into
   the container (2D canvas, DOM, or the Three.js scene).
3. **params** — `getParams()` is resolved (possibly asynchronously — e.g. a
   sandboxed plugin answers over RPC) and shown in the right panel;
   user edits arrive via `updateParams`.
4. **deactivate / destroy** — the plugin releases its resources.

## Manifest

```jsonc
{
  "id": "com.example.analyzer",
  "name": "Analyzer",
  "version": "1.2.0",
  "author": "Example Corp",
  "description": "…",
  "license": "MIT",
  "entry": "dist/index.js",
  "sandbox": "isolated",            // "isolated" (default) | "trusted"
  "formats": [{ "extension": ".dat", "mimeTypes": ["application/octet-stream"] }],
  "nameI18n": { "zh-CN": "分析器" }
}
```

The `sandbox` field decides where the entry code executes (see below).
Built-in plugins always run in the host context.

## Container capabilities

```ts
interface ContainerCapabilities {
  three?: Scene3DHandle;        // host-managed Three.js scene (3D plugins)
  canvas2d?: HTMLCanvasElement; // shared 2D canvas
  dom?: HTMLDivElement;         // generic DOM container
  reportDataScale(n: number): void; // feed the perf panel
}
```

Declaring `renderToScene` makes the host materialize the Three.js scene for
your plugin — the 2D canvas and the scene are mutually exclusive by design,
and the host toggles visibility for you.

## PluginApi

Plugins interact with the host through a small, capability-limited API:
locale (`locale`, `t`, `onLocaleChange`), status/perf (`setStatus`,
`reportGpuTime`, `reportDataScale`), notifications (`notify`), files
(`openFile`, `readText`, `readBinary`), project-scoped persistence
(`getParam`, `setParam`), and — when a WebGPU device is available — GPU
compute (`gpu`, see [Native Core & WebGPU](native-core)).

### GPU compute

`api.gpu` is present only when WebGPU is available (and inside the Worker
sandbox it is always absent), so always guard with `available`:

```ts
const gpu = api.gpu;
if (!gpu?.available) {
  // CPU fallback — same math, no GPU.
}

const data = gpu.createBuffer(bytes, GPUBufferUsage.STORAGE | 8 | 1, 'data');
const kernel = gpu.compileKernel({
  label: 'my.kernel',
  wgsl: myWgsl,                    // or a template from src/core/wgsl.ts
  workgroupSize: [64, 1, 1],
  bindings: [{ binding: 0, bufferType: 'storage' }],
});
data.write(particles);
gpu.run(kernel, [data], workgroups, 1, 1);   // bind group + dispatch + submit
const result = await data.read();            // mapAsync → copy
```

## Building a `.cspkg` package

A package is a ZIP with `manifest.json` + entry + assets:

```
my-plugin.cspkg
├── manifest.json
└── dist/
    └── index.js        # module whose default export is the plugin factory
```

The entry source is a function body that receives the (sandboxed) `api` and
returns a `Plugin` object.

## Sandboxing

- **`isolated` (default)** — the entry runs inside a **Web Worker** with a
  postMessage RPC bridge (`src/core/sandbox.ts`). It has no access to the
  host page's globals, DOM, `window`, or stores. Canvas rendering works via
  an `OffscreenCanvas` transferred into the worker; `dom`/`three` handles
  are intentionally unavailable.
- **`trusted`** — executes directly in the host context with full DOM
  access. Use only for packages you control.

If Workers are unavailable, the loader falls back to a best-effort strict
`new Function` with shadowed globals and **warns the user** that this is not
a security boundary.

> **Honest limits**: workers share the origin's IndexedDB, so a malicious
> package could still read app data through it. Treat the sandbox as
> isolation from the page context, not from the origin's storage.
