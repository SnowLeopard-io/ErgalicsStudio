// ==========================================================================
// Ergalics Studio Plugin SDK v1 — ambient contract subset
//
// Copied from `src/types/plugin.ts` (the single source of truth). When the
// host contract evolves, sync this file from it.
//
// These declarations are intentionally GLOBAL (no `export`): the template
// compiles in script mode (`"module": "none"`) because the host executes the
// package entry as a plain function body (`new Function('api', source)`),
// never as an ES module. Do not add `import` / `export` to any source file.
// ==========================================================================

// ---- Manifest ----

/** ed25519 package signature embedded by the signing pipeline (FR-05). */
interface PluginSignature {
  alg: 'ed25519';
  /** `ed25519:<hex32>` — first 16 bytes of SHA-256(publicKey), hex. */
  fingerprint: string;
  /** Hex-encoded 64-byte ed25519 signature over the canonical payload. */
  sig: string;
  signer: string;
  /** ISO-8601 timestamp chosen by the signer. */
  signedAt: string;
  permissions?: string[];
  /** Optional hex-encoded 32-byte public key, cross-checked vs fingerprint. */
  pub?: string;
}

interface SupportedFormat {
  extension: string; // e.g. ".xyz"
  mimeTypes: string[];
  magic?: number[]; // byte prefix
  description?: string;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Package-relative entry path inside the .cspkg (e.g. "dist/index.js"). */
  entry: string;
  license?: string;
  icon?: string;
  /** Written by the signing tool; absent = unsigned. Never set by hand. */
  signature?: PluginSignature;
  homepage?: string;
  dependencies?: Record<string, string>;
  formats?: SupportedFormat[];
  category?: 'scientific' | 'fun' | 'utility';
  /** Default "isolated" (Web Worker sandbox). "trusted" = self-published only. */
  sandbox?: 'isolated' | 'trusted';
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
}

// ---- Parameter controls (8 kinds) ----

type ParamControlType =
  | 'range'
  | 'select'
  | 'number'
  | 'checkbox'
  | 'text'
  | 'file'
  | 'button'
  | 'toggle';

interface BaseParam {
  key: string;
  label: string;
  labelI18n?: Record<string, string>;
  type: ParamControlType;
  hint?: string;
}

interface RangeParam extends BaseParam {
  type: 'range';
  min: number;
  max: number;
  step: number;
  value: number;
}

interface SelectOption {
  value: string;
  label: string;
  labelI18n?: Record<string, string>;
}

interface SelectParam extends BaseParam {
  type: 'select';
  options: SelectOption[];
  value: string;
}

interface NumberParam extends BaseParam {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  value: number;
}

interface CheckboxParam extends BaseParam {
  type: 'checkbox';
  value: boolean;
}

interface TextParam extends BaseParam {
  type: 'text';
  value: string;
  placeholder?: string;
}

interface FileParam extends BaseParam {
  type: 'file';
  accept: string;
  value: string | null;
}

interface ButtonParam extends BaseParam {
  type: 'button';
  variant?: 'primary' | 'danger' | 'default';
  /** Delivered back through `updateParams` when clicked. */
  action?: string;
}

interface ToggleParam extends BaseParam {
  type: 'toggle';
  value: boolean;
  offLabel?: string;
  onLabel?: string;
  offLabelI18n?: Record<string, string>;
  onLabelI18n?: Record<string, string>;
}

type ParamDefinition =
  | RangeParam
  | SelectParam
  | NumberParam
  | CheckboxParam
  | TextParam
  | FileParam
  | ButtonParam
  | ToggleParam;

// ---- Container capabilities ----

/**
 * Minimal structural stand-ins for the Three.js objects the host exposes.
 * The starter deliberately does not depend on `three`; if your plugin uses
 * the 3D scene, add `three` to devDependencies and import the real types
 * (`Scene`, `PerspectiveCamera`, `WebGLRenderer`, `OrbitControls`) — the
 * host hands you those exact objects at runtime.
 */
interface Scene3DHandle {
  scene: unknown;
  camera: unknown;
  controls: unknown;
  renderer: unknown;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  render(): void;
  snapshot(): string;
  dispose(): void;
}

interface ContainerCapabilities {
  /** Present only when the plugin declares `renderToScene`. */
  three?: Scene3DHandle;
  /** Shared 2D canvas (an OffscreenCanvas inside the isolated sandbox). */
  canvas2d?: HTMLCanvasElement;
  /** Generic DOM container — unavailable inside the isolated sandbox. */
  dom?: HTMLDivElement;
  /** Report data scale (particles / nodes / voxels) to the perf panel. */
  reportDataScale(n: number): void;
}

// ---- Progress & compute results ----

interface ComputeProgress {
  done: number;
  total: number;
  label?: string;
}

interface ComputeResult {
  ok: boolean;
  output?: unknown;
  metrics?: { gpuMs?: number; bytes?: number };
  error?: string;
}

// ---- GPU compute ----

interface ComputeBufferHandle {
  readonly size: number;
  readonly usage: number;
  write(data: ArrayBufferView, offset?: number): void;
  read(): Promise<ArrayBuffer>;
  /** MUST be called when done, or device memory leaks until teardown. */
  destroy(): void;
}

interface GpuKernelDescriptor {
  label: string;
  wgsl: string;
  entryPoint?: string;
  workgroupSize?: [number, number, number];
  bindings: Array<{
    binding: number;
    bufferType: 'storage' | 'read-only-storage' | 'uniform';
  }>;
}

interface GpuKernelHandle {
  readonly label: string;
  compilationInfo(): Promise<string[]>;
}

interface GpuComputeApi {
  readonly available: boolean;
  readonly backend: 'wasm' | 'webgpu' | 'none';
  createBuffer(size: number, usage: number, label?: string): ComputeBufferHandle | null;
  compileKernel(descriptor: GpuKernelDescriptor): GpuKernelHandle | null;
  run(
    kernel: GpuKernelHandle,
    buffers: ComputeBufferHandle[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number,
  ): boolean;
}

// ---- Observability & scratch space ----

type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

type PluginHostStatus =
  | 'ready'
  | 'computing'
  | 'paused'
  | 'loading'
  | 'saving'
  | 'error';

/**
 * Plugin-scoped cache (not persisted; released on unload). Every method is
 * async — inside the isolated sandbox it lives on the host across the RPC
 * bridge, and host plugins pay only a microtask.
 */
interface PluginCacheApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

// ---- Host API exposed to plugins ----

interface PluginApi {
  readonly locale: string;
  t(key: string, params?: Record<string, string | number>): string;
  onLocaleChange(listener: (locale: string) => void): () => void;

  setStatus(status: PluginHostStatus): void;
  reportGpuTime(ms: number): void;
  reportDataScale(n: number): void;
  notify(kind: 'info' | 'success' | 'warning' | 'error', message: string): void;

  /** Prefer over `console.*` — scoped, buffered, exported with run history. */
  log(level: PluginLogLevel, message: string, details?: unknown): void;

  exportFile(fileName: string, data: string | ArrayBuffer | Blob, mimeType?: string): void;

  readonly cache: PluginCacheApi;
  /** Only when a WebGPU device exists; ALWAYS undefined in the sandbox. */
  readonly gpu?: GpuComputeApi;

  openFile(): Promise<File | null>;
  readText(file: File): Promise<string>;
  readBinary(file: File): Promise<ArrayBuffer>;

  /**
   * SANDBOX CAVEAT: in an `isolated` plugin this crosses the RPC bridge and
   * resolves as a Promise even though the host signature is synchronous.
   * Always `await` it.
   */
  getParam(key: string): unknown;
  /** Same sandbox caveat as `getParam`. */
  setParam(key: string, value: unknown): void;
}

interface PluginRenderContext {
  container: ContainerCapabilities;
  api: PluginApi;
}

// ---- Plugin implementation contract ----

/**
 * `manifest`, `init` and `getParams` are required; everything else is
 * optional (the host probes with `?.`). A minimal third-party package can
 * implement only `render`.
 *
 * NOTE: named `ErgalicsPlugin` (not `Plugin`) to avoid declaration merging
 * with lib.dom's legacy `Plugin` interface. It is the host's `Plugin`.
 */
interface ErgalicsPlugin {
  readonly manifest: PluginManifest;
  init(api: PluginApi): Promise<void> | void;
  getParams(): ParamDefinition[] | Promise<ParamDefinition[]>;
  destroy?(): Promise<void> | void;
  activate?(context: PluginRenderContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  render?(container: ContainerCapabilities): Promise<void> | void;
  updateParams?(params: Record<string, unknown>): Promise<void> | void;
  compute?(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult>;
  loadData?(file: File): Promise<void> | void;
  getSupportedFormats?(): SupportedFormat[] | Promise<SupportedFormat[]>;
  renderToScene?(scene: Scene3DHandle): Promise<void> | void;
  onProjectSave?(): Promise<void> | void;
  onProjectLoad?(): Promise<void> | void;
}
