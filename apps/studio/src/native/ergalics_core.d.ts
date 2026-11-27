/* tslint:disable */
/* eslint-disable */

/**
 * Describes a single buffer binding of a kernel's bind group layout.
 *
 * This is what makes `ComputeKernel::compile` usable for shaders that
 * actually read/write data: each binding entry is turned into a real
 * `GPUBindGroupLayoutEntry` with the given visibility and buffer layout.
 */
export class BindingDescriptor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a compute-stage buffer binding.
     *
     * `buffer_type` must be one of:
     * - `"storage"`             — read/write storage buffer
     * - `"read-only-storage"`   — read-only storage buffer
     * - `"uniform"`             — uniform buffer
     */
    constructor(binding: number, buffer_type: string);
    set_has_dynamic_offset(has_dynamic_offset: boolean): void;
    /**
     * Minimum byte size of the bound buffer (0 = unbounded).
     */
    set_min_binding_size(min_binding_size: number): void;
    /**
     * Override the shader stage visibility bitmask (default: compute only).
     */
    set_visibility(visibility: number): void;
    readonly binding: number;
    readonly buffer_type: string;
    readonly visibility: number;
}

/**
 * A compiled compute kernel bound to a GPU device.
 */
export class ComputeKernel {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build a bind group binding the given buffers to this kernel's layout.
     *
     * Buffers are bound in order: buffer `i` becomes binding `i`. The
     * layout comes from the kernel's compile-time `BindingDescriptor`s, so
     * the buffer usage must match the declared binding type (storage vs
     * read-only-storage vs uniform).
     */
    bind_group(buffers: Array<any>): GPUBindGroup;
    /**
     * Await shader compilation info and return diagnostic messages.
     *
     * The first message is an error/warning/info line like
     * `[error] line 3:9 expected ';'`; an empty vector means the shader
     * compiled cleanly. Useful for surfacing WGSL errors to the user
     * instead of failing with a silent pipeline error.
     */
    compilation_info(): Promise<string[]>;
    /**
     * Compile a kernel from a descriptor using the given device.
     *
     * The bind group layout is built from the descriptor's binding entries
     * (visibility + buffer layout), so shaders that read/write storage
     * buffers or uniforms can be compiled and bound.
     */
    static compile(device: GPUDevice, descriptor: KernelDescriptor): ComputeKernel;
    /**
     * Encode a single dispatch of this kernel and submit it to the queue.
     *
     * `bind_group` is bound at index 0; the workgroup counts default to the
     * kernel's workgroup size when not overridden by the JS caller.
     */
    dispatch(queue: GPUQueue, bind_group: GPUBindGroup, workgroup_count_x: number, workgroup_count_y: number, workgroup_count_z: number): void;
    /**
     * One-shot convenience: build a bind group from `buffers`, dispatch a
     * single workload, and submit — the whole pipeline in one call.
     */
    run(queue: GPUQueue, buffers: Array<any>, workgroup_count_x: number, workgroup_count_y: number, workgroup_count_z: number): void;
    readonly label: string;
    readonly pipeline: GPUComputePipeline;
    readonly workgroup_size: Uint32Array;
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
 * A WebGPU buffer owned by the native core.
 *
 * Holds the underlying `GPUBuffer` plus the usage flags it was created
 * with. `write` uploads a byte slice through the queue; `read` maps the
 * buffer (requiring `MAP_READ` usage) and copies the bytes back to a
 * `Uint8Array`.
 */
export class GpuBuffer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Storage buffer that can also be read back (results are copied into a
     * separate readback buffer on `read`).
     */
    static create_readable_storage(device: GPUDevice, size: number): GpuBuffer;
    /**
     * Storage buffer usable as a compute shader read/write target.
     *
     * `COPY_SRC` is included so results can be copied into a separate
     * `MAP_READ | COPY_DST` readback buffer (WebGPU forbids combining
     * `MAP_READ` with `STORAGE`).
     */
    static create_storage(device: GPUDevice, size: number): GpuBuffer;
    /**
     * Uniform buffer for per-dispatch parameters (16-byte aligned structs).
     *
     * `COPY_DST` is included so `write` (which goes through
     * `queue.writeBuffer`) can upload the parameter bytes; `writeBuffer`
     * validation requires the destination buffer to expose `COPY_DST`.
     */
    static create_uniform(device: GPUDevice, size: number): GpuBuffer;
    /**
     * Create a buffer of `size` bytes with an explicit usage mask.
     */
    constructor(device: GPUDevice, label: string, size: number, usage: number);
    /**
     * Asynchronously read the buffer's contents.
     *
     * WebGPU only allows `MAP_READ` to be combined with `COPY_DST`, so the
     * buffer itself cannot be mapped when it is used as compute storage.
     * This copies the buffer into a temporary `MAP_READ | COPY_DST` readback
     * buffer, maps that, and returns the bytes.
     */
    read(): Promise<Uint8Array>;
    /**
     * Upload `data` into the buffer starting at `offset` bytes.
     */
    write(queue: GPUQueue, data: Uint8Array, offset: number): void;
    /**
     * The underlying `GPUBuffer` (for use with host-managed command encoders).
     */
    readonly buffer: GPUBuffer;
    readonly size: number;
    readonly usage: number;
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
    constructor(label: string, wgsl: string, entry_point: string, workgroup_size: Uint32Array, bindings: BindingDescriptor[]);
    readonly bindings: BindingDescriptor[];
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
    readonly __wbg_gpubuffer_free: (a: number, b: number) => void;
    readonly gpubuffer_buffer: (a: number) => any;
    readonly gpubuffer_create_readable_storage: (a: any, b: number) => [number, number, number];
    readonly gpubuffer_create_storage: (a: any, b: number) => [number, number, number];
    readonly gpubuffer_create_uniform: (a: any, b: number) => [number, number, number];
    readonly gpubuffer_new: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly gpubuffer_read: (a: number) => any;
    readonly gpubuffer_size: (a: number) => number;
    readonly gpubuffer_usage: (a: number) => number;
    readonly gpubuffer_write: (a: number, b: any, c: number, d: number, e: number) => [number, number];
    readonly __wbg_bindingdescriptor_free: (a: number, b: number) => void;
    readonly __wbg_computekernel_free: (a: number, b: number) => void;
    readonly __wbg_computequeue_free: (a: number, b: number) => void;
    readonly __wbg_kerneldescriptor_free: (a: number, b: number) => void;
    readonly bindingdescriptor_binding: (a: number) => number;
    readonly bindingdescriptor_buffer_type: (a: number) => [number, number];
    readonly bindingdescriptor_new: (a: number, b: number, c: number) => number;
    readonly bindingdescriptor_set_has_dynamic_offset: (a: number, b: number) => void;
    readonly bindingdescriptor_set_min_binding_size: (a: number, b: number) => void;
    readonly bindingdescriptor_set_visibility: (a: number, b: number) => void;
    readonly bindingdescriptor_visibility: (a: number) => number;
    readonly computekernel_bind_group: (a: number, b: any) => [number, number, number];
    readonly computekernel_compilation_info: (a: number) => any;
    readonly computekernel_compile: (a: any, b: number) => [number, number, number];
    readonly computekernel_dispatch: (a: number, b: any, c: any, d: number, e: number, f: number) => [number, number];
    readonly computekernel_label: (a: number) => [number, number];
    readonly computekernel_pipeline: (a: number) => any;
    readonly computekernel_run: (a: number, b: any, c: any, d: number, e: number, f: number) => [number, number];
    readonly computekernel_workgroup_size: (a: number) => [number, number];
    readonly computequeue_submit: (a: number, b: number, c: number) => void;
    readonly kerneldescriptor_bindings: (a: number) => [number, number];
    readonly kerneldescriptor_entry_point: (a: number) => [number, number];
    readonly kerneldescriptor_label: (a: number) => [number, number];
    readonly kerneldescriptor_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly kerneldescriptor_workgroup_size: (a: number) => [number, number];
    readonly computequeue_new: (a: any) => number;
    readonly core_version: () => [number, number];
    readonly start: () => void;
    readonly detect_file_kind: (a: number, b: number) => number;
    readonly log: (a: number, b: number) => void;
    readonly __wbg_gpudevicemanager_free: (a: number, b: number) => void;
    readonly __wbg_gpuinfo_free: (a: number, b: number) => void;
    readonly gpudevicemanager_acquire: (a: any, b: number) => any;
    readonly gpudevicemanager_device: (a: number) => any;
    readonly gpudevicemanager_info: (a: number) => number;
    readonly gpuinfo_backend: (a: number) => [number, number];
    readonly gpuinfo_name: (a: number) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_b5571197bf1ad37d___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_b5571197bf1ad37d___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_b5571197bf1ad37d___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__3: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_b5571197bf1ad37d___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__4: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
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
