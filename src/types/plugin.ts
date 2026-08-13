// ==========================================================================
// Ergalics Studio — Plugin interface contracts (spec §6)
// ==========================================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license?: string;
  icon?: string;
  entry: string;
  homepage?: string;
  dependencies?: Record<string, string>;
  formats?: SupportedFormat[];
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
  | 'button';

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

export type ParamDefinition =
  | RangeParam
  | SelectParam
  | NumberParam
  | CheckboxParam
  | TextParam
  | FileParam
  | ButtonParam;

// ---- Container capabilities (spec §3.2.3) ----

export interface Scene3DHandle {
  scene: unknown;
  camera: unknown;
  controls: unknown;
  renderer: unknown;
  dispose(): void;
  render(): void;
  snapshot(): unknown;
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

  /** Load a file through the host data loader. */
  openFile(): Promise<File | null>;
  /** Read a file's text content. */
  readText(file: File): Promise<string>;
  /** Read a file's ArrayBuffer. */
  readBinary(file: File): Promise<ArrayBuffer>;

  /** Persist a value scoped to this plugin in the current project. */
  getParam(key: string): unknown;
  setParam(key: string, value: unknown): void;
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
 * and must implement the required lifecycle methods.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  /** Required lifecycle methods (spec §6.4). */
  init(api: PluginApi): Promise<void> | void;
  destroy(): Promise<void> | void;
  activate(context: PluginRenderContext): Promise<void> | void;
  deactivate(): Promise<void> | void;
  /** Render into the provided container. */
  render?(container: ContainerCapabilities): Promise<void> | void;
  /** Receive parameter updates. */
  updateParams(params: Record<string, unknown>): Promise<void> | void;
  /** Get current parameters (definitions + values). */
  getParams(): ParamDefinition[];
  /** Execute a computation. */
  compute?(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult>;

  /** Optional lifecycle hooks (spec §6.4). */
  loadData?(file: File): Promise<void> | void;
  getSupportedFormats?(): SupportedFormat[];
  renderToScene?(scene: unknown): Promise<void> | void;
  onProjectSave?(): Promise<void> | void;
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
  loaded: boolean;
  active: boolean;
  formats: SupportedFormat[];
  plugin: Plugin | null;
}