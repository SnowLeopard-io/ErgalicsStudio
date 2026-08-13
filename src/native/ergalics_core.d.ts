/* tslint:disable */
/* eslint-disable */

/**
 * A compiled compute kernel bound to a GPU device.
 */
export class ComputeKernel {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compile a kernel from a descriptor using the given device.
     */
    static compile(device: GPUDevice, descriptor: KernelDescriptor): ComputeKernel;
    readonly label: string;
    readonly pipeline: GPUComputePipeline;
}

/**
 * A command queue for dispatching kernels. Not intended for direct use
 * from JS yet — the host drives commands through the WebGPU API directly.
 */
export class ComputeQueue {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static new(queue: GPUQueue): ComputeQueue;
    /**
     * Submit an encoded command buffer.
     */
    submit(buffers: GPUCommandBuffer[]): void;
}

/**
 * Result of a file-kind detection.
 */
export enum FileKind {
    /**
     * Detected by its magic-number header.
     */
    Magic = 0,
    /**
     * Detected only by its file extension.
     */
    Extension = 1,
    /**
     * Could not be identified.
     */
    Unknown = 2,
}

/**
 * Manages the lifetime of the WebGPU device.
 */
export class GpuDeviceManager {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Request an adapter then a device from `navigator.gpu`.
     * `force_cpu_fallback` maps to `forceFallbackAdapter`.
     */
    static acquire(gpu: GPU, force_cpu_fallback: boolean): Promise<GpuDeviceManager>;
    /**
     * The underlying `GpuDevice`.
     */
    readonly device: GPUDevice;
    /**
     * Adapter information snapshot.
     */
    readonly info: GpuInfo;
}

/**
 * Information about the current GPU adapter.
 */
export class GpuInfo {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly backend: string;
    readonly name: string;
}

/**
 * Descriptor for a compute kernel to be compiled by the scheduler.
 */
export class KernelDescriptor {
    free(): void;
    [Symbol.dispose](): void;
    constructor(label: string, wgsl: string, entry_point: string, workgroup_size: Uint32Array);
    readonly entry_point: string;
    readonly label: string;
    readonly workgroup_size: Uint32Array;
}

/**
 * Version of the native core.
 */
export function core_version(): string;

/**
 * Detect whether a byte prefix matches a known magic number.
 *
 * Returns the detected kind. A `None` means no known header matched;
 * callers may then fall back to extension-based detection.
 */
export function detect_file_kind(prefix: Uint8Array): FileKind | undefined;

/**
 * Log helper writing through to the browser console.
 */
export function log(message: string): void;

/**
 * Initialize the WASM module. Sets up panic hook so Rust panics
 * surface as console errors instead of silent corruption.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_computekernel_free: (a: number, b: number) => void;
    readonly __wbg_computequeue_free: (a: number, b: number) => void;
    readonly __wbg_kerneldescriptor_free: (a: number, b: number) => void;
    readonly computekernel_compile: (a: any, b: number) => [number, number, number];
    readonly computekernel_label: (a: number) => [number, number];
    readonly computekernel_pipeline: (a: number) => any;
    readonly computequeue_submit: (a: number, b: number, c: number) => void;
    readonly kerneldescriptor_entry_point: (a: number) => [number, number];
    readonly kerneldescriptor_label: (a: number) => [number, number];
    readonly kerneldescriptor_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly kerneldescriptor_workgroup_size: (a: number) => [number, number];
    readonly computequeue_new: (a: any) => number;
    readonly __wbg_gpudevicemanager_free: (a: number, b: number) => void;
    readonly __wbg_gpuinfo_free: (a: number, b: number) => void;
    readonly core_version: () => [number, number];
    readonly detect_file_kind: (a: number, b: number) => number;
    readonly gpudevicemanager_acquire: (a: any, b: number) => any;
    readonly gpudevicemanager_device: (a: number) => any;
    readonly gpudevicemanager_info: (a: number) => number;
    readonly gpuinfo_backend: (a: number) => [number, number];
    readonly gpuinfo_name: (a: number) => [number, number];
    readonly log: (a: number, b: number) => void;
    readonly start: () => void;
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
