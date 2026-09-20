// ==========================================================================
// Ergalics Studio — Plugin interface contracts (spec §6)
// ==========================================================================

import type { Scene, PerspectiveCamera, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * ed25519 package signature embedded in a `.cspkg` manifest (FR-05).
 *
 * Absence of this field means "unsigned" — older packages keep parsing
 * unchanged, and the install pipeline decides policy on that signal.
 */
export interface PluginSignature {
  alg: 'ed25519';
  /** `ed25519:<hex16>` — first 16 bytes of SHA-256(publicKey), hex. */
  fingerprint: string;
  /** Hex-encoded 64-byte ed25519 signature over the canonical payload. */
  sig: string;
  /** Human-readable signer / publisher name. */
  signer: string;
  /** ISO-8601 timestamp chosen by the signer at signing time. */
  signedAt: string;
  /** Declared capability scope shown in the install confirmation dialog. */
  permissions?: string[];
  /**
   * Optional hex-encoded 32-byte public key. When present the verifier
   * cross-checks it against `fingerprint` (catching a manifest that claims
   * a trusted fingerprint while embedding a different key).
   */
  pub?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license?: string;
  icon?: string;
  /** Package signature (FR-05). Absent = unsigned. */
  signature?: PluginSignature;
  /**
   * Entry descriptor. Semantics depend on the distribution channel:
   * - **Bundled built-ins**: a symbolic id (e.g. `"example.scatter"`). The
   *   module is resolved by `src/plugins/builtin/index.ts`, never by path.
   * - **`.cspkg` packages**: a *package-relative* path into the ZIP
   *   (e.g. `"dist/index.js"`). Absolute paths, drive letters and `..` are
   *   rejected by `validateManifest`.
   */
  entry: string;
  homepage?: string;
  dependencies?: Record<string, string>;
  formats?: SupportedFormat[];
  /**
   * Marketplace grouping. Core analytical visualizers are `'scientific'`,
   * novelty/decorative toys are `'fun'`, and small helpers are `'utility'`.
   * Used by the plugin market tab for filtering/sectioning.
   */
  category?: 'scientific' | 'fun' | 'utility';
  /**
   * Execution context for third-party packages (spec §6.2):
   * - `"isolated"` (default): runs inside a Web Worker sandbox with an
   *   RPC bridge. Cannot touch the host page's globals/DOM; canvas
   *   rendering works via a transferred OffscreenCanvas.
   * - `"trusted"`: executes directly in the host context (full DOM
   *   capability). Only use for packages you control.
   */
  sandbox?: 'isolated' | 'trusted';
  /** Locale-specific display names. */
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
}

export interface SupportedFormat {
  extension: string; // e.g. ".xyz"
  mimeTypes: string[]; // e.g. ["chemical/x-xyz"]
  magic?: number[]; // byte prefix
  description?: string;
}

// ---- Parameter controls (spec §3.2.4) ----

export type ParamControlType =
  | 'range'
  | 'select'
  | 'number'
  | 'checkbox'
  | 'text'
  | 'file'
  | 'button'
  | 'toggle';

export interface BaseParam {
  key: string;
  label: string;
  labelI18n?: Record<string, string>;
  type: ParamControlType;
  hint?: string;
}

export interface RangeParam extends BaseParam {
  type: 'range';
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface SelectOption {
  value: string;
  label: string;
  labelI18n?: Record<string, string>;
}

export interface SelectParam extends BaseParam {
  type: 'select';
  options: SelectOption[];
  value: string;
}

export interface NumberParam extends BaseParam {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  value: number;
}

export interface CheckboxParam extends BaseParam {
  type: 'checkbox';
  value: boolean;
}

export interface TextParam extends BaseParam {
  type: 'text';
  value: string;
  placeholder?: string;
}

export interface FileParam extends BaseParam {
  type: 'file';
  accept: string;
  value: string | null;
}

export interface ButtonParam extends BaseParam {
  type: 'button';
  variant?: 'primary' | 'danger' | 'default';
  action?: string;
}

export interface ToggleParam extends BaseParam {
  type: 'toggle';
  value: boolean;
  /** Label shown when the toggle is off (e.g. "Start"). */
  offLabel?: string;
  /** Label shown when the toggle is on (e.g. "Stop"). */
  onLabel?: string;
  offLabelI18n?: Record<string, string>;
  onLabelI18n?: Record<string, string>;
}

export type ParamDefinition =
  | RangeParam
  | SelectParam
  | NumberParam
  | CheckboxParam
  | TextParam
  | FileParam
  | ButtonParam
  | ToggleParam;

// ---- Container capabilities (spec §3.2.3) ----

/**
 * Live handle to the host-managed Three.js scene. Members are the actual
 * Three.js objects, so plugins can add meshes, lights, and drive the
 * render loop through `render()`.
 */
export interface Scene3DHandle {
  /** Root scene node. Add your meshes/lights here. */
  scene: Scene;
  /** Perspective camera, pre-positioned by the host. */
  camera: PerspectiveCamera;
  /** Orbit controls attached to the host canvas. */
  controls: OrbitControls;
  /** WebGL renderer bound to the host canvas. */
  renderer: WebGLRenderer;
  /**
   * Show/hide the 3D surface. The host hides it automatically when a
   * non-3D plugin is activated, so a 3D coordinate system never bleeds
   * into a 2D viewport.
   */
  setVisible(visible: boolean): void;
  /** Whether the 3D surface is currently shown (a 3D plugin is active). */
  isVisible(): boolean;
  /** Release GPU resources and stop the render loop. */
  dispose(): void;
  /** Render one frame immediately. */
  render(): void;
  /** Export the current frame as a PNG data URL. */
  snapshot(): string;
}

export interface ContainerCapabilities {
  /** Render 3D content via the provided Three.js-compatible scene. */
  three?: Scene3DHandle;
  /** 2D canvas element ready for rendering. */
  canvas2d?: HTMLCanvasElement;
  /** Generic DOM container. */
  dom?: HTMLDivElement;
  /** Report data scale (particles / nodes / voxels) to the perf panel. */
  reportDataScale(n: number): void;
}

// ---- Progress & compute results ----

export interface ComputeProgress {
  done: number;
  total: number;
  label?: string;
}

export interface ComputeResult {
  ok: boolean;
  output?: unknown;
  metrics?: {
    gpuMs?: number;
    bytes?: number;
  };
  error?: string;
}

// ---- GPU compute (spec §3.2.6, §8.3) ----

/** A single particle in the interleaved `[x, y, vx, vy]` layout. */
export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Opaque handle to a GPU buffer. `write` uploads bytes through the queue;
 * `read` maps the buffer back (requires `MAP_READ` usage) and resolves to
 * the buffer contents. Buffers live on the host's GPU device.
 */
export interface ComputeBufferHandle {
  /** Byte size of the buffer. */
  readonly size: number;
  /** `GPUBufferUsage` bit mask the buffer was created with. */
  readonly usage: number;
  /** Upload a typed array starting at `offset` bytes. */
  write(data: ArrayBufferView, offset?: number): void;
  /** Map the buffer and resolve with a copy of its bytes. */
  read(): Promise<ArrayBuffer>;
  /**
   * Release the underlying GPU buffer. Plugins must call this when the
   * buffer is no longer needed — without it every compute pass leaks device
   * memory until the whole device is destroyed.
   */
  destroy(): void;
}

/** Descriptor for compiling a WGSL compute kernel on the host. */
export interface GpuKernelDescriptor {
  label: string;
  wgsl: string;
  entryPoint?: string;
  workgroupSize?: [number, number, number];
  /** Buffer bindings of the kernel's single bind group (group 0). */
  bindings: Array<{
    binding: number;
    bufferType: 'storage' | 'read-only-storage' | 'uniform';
  }>;
}

/** A compiled WGSL compute kernel. */
export interface GpuKernelHandle {
  readonly label: string;
  /** Resolve with WGSL compile diagnostics (empty when clean). */
  compilationInfo(): Promise<string[]>;
}

/**
 * GPU compute surface exposed to plugins through `PluginApi.gpu`.
 *
 * Provided only when a WebGPU device is available. Plugins must check
 * `available` and fall back to CPU when it is false. The implementation
 * routes through the Rust/WASM core when loaded, otherwise through the raw
 * WebGPU API — plugins never touch raw GPU objects directly.
 */
export interface GpuComputeApi {
  readonly available: boolean;
  /** `"wasm"` when the native core drives compute, `"webgpu"` otherwise. */
  readonly backend: 'wasm' | 'webgpu' | 'none';
  /**
   * Create a GPU buffer of `size` bytes with a `GPUBufferUsage` bit mask.
   * Returns `null` when creation fails.
   */
  createBuffer(size: number, usage: number, label?: string): ComputeBufferHandle | null;
  /**
   * Compile a WGSL kernel. Returns `null` when compilation fails; use
   * `kernel.compilationInfo()` for diagnostics.
   */
  compileKernel(descriptor: GpuKernelDescriptor): GpuKernelHandle | null;
  /**
   * Build a bind group from `buffers` (buffer i → binding i) and dispatch
   * one workload of `x × y × z` workgroups, then submit. Returns false if
   * the kernel or buffers are foreign to this service.
   */
  run(
    kernel: GpuKernelHandle,
    buffers: ComputeBufferHandle[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number,
  ): boolean;
}

// ---- Observability & scratch space ----

/** Log severities a plugin may emit through `PluginApi.log`. */
export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Plugin-scoped scratch space for intermediate results.
 *
 * Every method is asynchronous: inside the isolated sandbox the cache lives
 * on the host and is reached over the RPC bridge, so a synchronous `get`
 * would be impossible to honour. Host plugins pay only a microtask.
 *
 * The cache is **not** persisted — treat it as a memoization layer and keep
 * anything that must survive a reload in `setParam` / project state.
 */
export interface PluginCacheApi {
  /** Resolve a cached value, or `undefined` when missing/expired. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Store a value, optionally expiring after `ttlMs`. */
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  /** Drop one entry. Returns whether it existed. */
  delete(key: string): Promise<boolean>;
  /** Drop every entry owned by this plugin. */
  clear(): Promise<void>;
  /** Live keys (expired entries are pruned first). */
  keys(): Promise<string[]>;
}

/**
 * One recorded step of an experiment — a data import, a compute run, or a
 * plugin-defined custom step. Kept so a result can always be traced back to
 * the plugin version and parameters that produced it.
 */
export interface PluginRunRecord {
  /** Monotonic run id, also used to correlate `beginRun`/`finishRun`. */
  id: string;
  pluginId: string;
  /** Plugin version at the time of the run (reproducibility anchor). */
  pluginVersion?: string;
  kind: 'data-import' | 'compute' | 'custom';
  /** Human-readable label (usually a file name or a compute label). */
  label?: string;
  /** Epoch ms when the run started. */
  startedAt: number;
  /** Epoch ms when the run settled; absent while still in flight. */
  endedAt?: number;
  durationMs?: number;
  /** `undefined` while in flight. */
  ok?: boolean;
  /** Failure message when `ok === false`. */
  error?: string;
  /** Free-form structured detail (byte counts, shapes, metric summaries). */
  detail?: Record<string, unknown>;
}

/** A plugin's parameters frozen at snapshot time, with its version. */
export interface ParameterSnapshotEntry {
  version: string;
  params: Record<string, unknown>;
}

/** Versioned parameter snapshot for every loaded plugin. */
export interface ParameterSnapshot {
  generatedAt: string;
  plugins: Record<string, ParameterSnapshotEntry>;
}

// ---- Host API exposed to plugins (spec §6.4 / §8.4 / plugin isolation) ----

export interface PluginApi {
  /** Current locale code, e.g. 'zh-CN'. */
  readonly locale: string;
  /** Translate a key with the host's current locale. */
  t(key: string, params?: Record<string, string | number>): string;
  /** Subscribe to locale changes. */
  onLocaleChange(listener: (locale: string) => void): () => void;

  /** Emit a system status update. */
  setStatus(status: PluginHostStatus): void;
  /** Report GPU compute time for the perf panel (ms). */
  reportGpuTime(ms: number): void;
  /** Report data scale for the perf panel. */
  reportDataScale(n: number): void;
  /** Show a toast notification to the user. */
  notify(kind: 'info' | 'success' | 'warning' | 'error', message: string): void;

  /**
   * Emit a structured log line under the `plugin:<id>` scope.
   *
   * Prefer this over `console.*`: host logs are buffered and exported with
   * the run history, so a plugin's own trace survives a reload and ships
   * with a bug report.
   */
  log(level: PluginLogLevel, message: string, details?: unknown): void;

  /**
   * Ask the host to save a file to the user's downloads.
   *
   * Accepts text, an `ArrayBuffer`, or a `Blob`; the MIME type defaults to
   * `text/plain` for strings and `application/octet-stream` otherwise.
   * No-op outside a browser context (e.g. the isolated sandbox, where the
   * request is forwarded to the host anyway).
   */
  exportFile(fileName: string, data: string | ArrayBuffer | Blob, mimeType?: string): void;

  /**
   * Plugin-scoped cache for intermediate results (see `PluginCacheApi`).
   * Released automatically when the plugin is unloaded.
   */
  readonly cache: PluginCacheApi;

  /**
   * GPU compute surface (WGSL kernels + buffers). Present only when a
   * WebGPU device is available — plugins must handle `undefined` and fall
   * back to CPU. Unavailable inside the Worker sandbox.
   */
  readonly gpu?: GpuComputeApi;

  /** Load a file through the host data loader. */
  openFile(): Promise<File | null>;
  /** Read a file's text content. */
  readText(file: File): Promise<string>;
  /** Read a file's ArrayBuffer. */
  readBinary(file: File): Promise<ArrayBuffer>;

  /**
   * Read a value scoped to this plugin in the current project.
   *
   * Sandbox caveat: inside the isolated worker this crosses the RPC bridge,
   * so it returns a `Promise` even though the host signature is synchronous.
   */
  getParam(key: string): unknown;
  /**
   * Persist a value scoped to this plugin in the current project.
   * Same sandbox caveat as `getParam`.
   */
  setParam(key: string, value: unknown): void;
  /**
   * Full self-reload: unload this plugin instance, build a fresh one from its
   * builtin factory and reactivate it. For recovering from stuck states
   * (killed workers, missed host capabilities) without a page reload.
   */
  reload?(): Promise<void>;
}

export type PluginHostStatus =
  | 'ready'
  | 'computing'
  | 'paused'
  | 'loading'
  | 'saving'
  | 'error';

export interface PluginRenderContext {
  container: ContainerCapabilities;
  api: PluginApi;
}

// ---- Plugin implementation contract ----

/**
 * A plugin module must export a factory (ESM default export is a function
 * or object) that creates a Plugin instance. It receives the host `PluginApi`
 * and implements the lifecycle methods below.
 *
 * `manifest`, `init`, `getParams` are required — without them the host cannot
 * register, wire, or configure the plugin. Every other method is optional:
 * the host (and the sandboxed runtime) probe with `?.` before calling, which
 * is what lets a minimal third-party package implement only `render`.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  /** Called once, right after the instance is created. */
  init(api: PluginApi): Promise<void> | void;
  /** Release everything the plugin owns. Called on unload. */
  destroy?(): Promise<void> | void;
  /** The plugin becomes the active one and receives its render context. */
  activate?(context: PluginRenderContext): Promise<void> | void;
  /** The plugin stops being active (stop timers/loops, keep state). */
  deactivate?(): Promise<void> | void;
  /** Render into the provided container. */
  render?(container: ContainerCapabilities): Promise<void> | void;
  /** Receive parameter updates. */
  updateParams?(params: Record<string, unknown>): Promise<void> | void;
  /** Get current parameters (definitions + values). May resolve asynchronously. */
  getParams(): ParamDefinition[] | Promise<ParamDefinition[]>;
  /** Execute a computation. */
  compute?(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult>;

  /** Optional lifecycle hooks (spec §6.4). */
  loadData?(file: File): Promise<void> | void;
  getSupportedFormats?(): SupportedFormat[] | Promise<SupportedFormat[]>;
  renderToScene?(scene: Scene3DHandle): Promise<void> | void;
  /** Fired after the project has been persisted. */
  onProjectSave?(): Promise<void> | void;
  /** Fired after a project has been loaded and its state restored. */
  onProjectLoad?(): Promise<void> | void;
}

// ---- Registry / loader records ----

export type PluginInstallState = 'installed' | 'loaded' | 'active';

export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon?: string;
  /** Locale-specific display names (kept so the name can be re-localized). */
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  loaded: boolean;
  active: boolean;
  formats: SupportedFormat[];
  plugin: Plugin | null;
}