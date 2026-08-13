/* @ts-self-types="./ergalics_core.d.ts" */

/**
 * A compiled compute kernel bound to a GPU device.
 */
export class ComputeKernel {
    static __wrap(ptr) {
        const obj = Object.create(ComputeKernel.prototype);
        obj.__wbg_ptr = ptr;
        ComputeKernelFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ComputeKernelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_computekernel_free(ptr, 0);
    }
    /**
     * Compile a kernel from a descriptor using the given device.
     * @param {GPUDevice} device
     * @param {KernelDescriptor} descriptor
     * @returns {ComputeKernel}
     */
    static compile(device, descriptor) {
        _assertClass(descriptor, KernelDescriptor);
        var ptr0 = descriptor.__destroy_into_raw();
        const ret = wasm.computekernel_compile(device, ptr0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ComputeKernel.__wrap(ret[0]);
    }
    /**
     * @returns {string}
     */
    get label() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.computekernel_label(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {GPUComputePipeline}
     */
    get pipeline() {
        const ret = wasm.computekernel_pipeline(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) ComputeKernel.prototype[Symbol.dispose] = ComputeKernel.prototype.free;

/**
 * A command queue for dispatching kernels. Not intended for direct use
 * from JS yet — the host drives commands through the WebGPU API directly.
 */
export class ComputeQueue {
    static __wrap(ptr) {
        const obj = Object.create(ComputeQueue.prototype);
        obj.__wbg_ptr = ptr;
        ComputeQueueFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ComputeQueueFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_computequeue_free(ptr, 0);
    }
    /**
     * @param {GPUQueue} queue
     * @returns {ComputeQueue}
     */
    static new(queue) {
        const ret = wasm.computequeue_new(queue);
        return ComputeQueue.__wrap(ret);
    }
    /**
     * Submit an encoded command buffer.
     * @param {GPUCommandBuffer[]} buffers
     */
    submit(buffers) {
        const ptr0 = passArrayJsValueToWasm0(buffers, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.computequeue_submit(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) ComputeQueue.prototype[Symbol.dispose] = ComputeQueue.prototype.free;

/**
 * Result of a file-kind detection.
 * @enum {0 | 1 | 2}
 */
export const FileKind = Object.freeze({
    /**
     * Detected by its magic-number header.
     */
    Magic: 0, "0": "Magic",
    /**
     * Detected only by its file extension.
     */
    Extension: 1, "1": "Extension",
    /**
     * Could not be identified.
     */
    Unknown: 2, "2": "Unknown",
});

/**
 * Manages the lifetime of the WebGPU device.
 */
export class GpuDeviceManager {
    static __wrap(ptr) {
        const obj = Object.create(GpuDeviceManager.prototype);
        obj.__wbg_ptr = ptr;
        GpuDeviceManagerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GpuDeviceManagerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gpudevicemanager_free(ptr, 0);
    }
    /**
     * Request an adapter then a device from `navigator.gpu`.
     * `force_cpu_fallback` maps to `forceFallbackAdapter`.
     * @param {GPU} gpu
     * @param {boolean} force_cpu_fallback
     * @returns {Promise<GpuDeviceManager>}
     */
    static acquire(gpu, force_cpu_fallback) {
        const ret = wasm.gpudevicemanager_acquire(gpu, force_cpu_fallback);
        return ret;
    }
    /**
     * The underlying `GpuDevice`.
     * @returns {GPUDevice}
     */
    get device() {
        const ret = wasm.gpudevicemanager_device(this.__wbg_ptr);
        return ret;
    }
    /**
     * Adapter information snapshot.
     * @returns {GpuInfo}
     */
    get info() {
        const ret = wasm.gpudevicemanager_info(this.__wbg_ptr);
        return GpuInfo.__wrap(ret);
    }
}
if (Symbol.dispose) GpuDeviceManager.prototype[Symbol.dispose] = GpuDeviceManager.prototype.free;

/**
 * Information about the current GPU adapter.
 */
export class GpuInfo {
    static __wrap(ptr) {
        const obj = Object.create(GpuInfo.prototype);
        obj.__wbg_ptr = ptr;
        GpuInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GpuInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gpuinfo_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get backend() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.gpuinfo_backend(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.gpuinfo_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) GpuInfo.prototype[Symbol.dispose] = GpuInfo.prototype.free;

/**
 * Descriptor for a compute kernel to be compiled by the scheduler.
 */
export class KernelDescriptor {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KernelDescriptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kerneldescriptor_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get entry_point() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.kerneldescriptor_entry_point(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get label() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.kerneldescriptor_label(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} label
     * @param {string} wgsl
     * @param {string} entry_point
     * @param {Uint32Array} workgroup_size
     */
    constructor(label, wgsl, entry_point, workgroup_size) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(wgsl, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(entry_point, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(workgroup_size, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.kerneldescriptor_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        this.__wbg_ptr = ret;
        KernelDescriptorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint32Array}
     */
    get workgroup_size() {
        const ret = wasm.kerneldescriptor_workgroup_size(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) KernelDescriptor.prototype[Symbol.dispose] = KernelDescriptor.prototype.free;

/**
 * Version of the native core.
 * @returns {string}
 */
export function core_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.core_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Detect whether a byte prefix matches a known magic number.
 *
 * Returns the detected kind. A `None` means no known header matched;
 * callers may then fall back to extension-based detection.
 * @param {Uint8Array} prefix
 * @returns {FileKind | undefined}
 */
export function detect_file_kind(prefix) {
    const ptr0 = passArray8ToWasm0(prefix, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.detect_file_kind(ptr0, len0);
    return ret === 3 ? undefined : ret;
}

/**
 * Log helper writing through to the browser console.
 * @param {string} message
 */
export function log(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.log(ptr0, len0);
}

/**
 * Initialize the WASM module. Sets up panic hook so Rust panics
 * surface as console errors instead of silent corruption.
 */
export function start() {
    wasm.start();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_5e4570eb24ffa122: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_7d13f41e1a2d5140: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_6cff064c44e0d823: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_be22cc64ae6946a0: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_architecture_c4297e8b50418f7e: function(arg0, arg1) {
            const ret = arg1.architecture;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_call_35dba3c747ad7521: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_createBindGroupLayout_0a23ca9c82e29505: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createBindGroupLayout(arg1);
            return ret;
        }, arguments); },
        __wbg_createComputePipeline_334567397448ab42: function(arg0, arg1) {
            const ret = arg0.createComputePipeline(arg1);
            return ret;
        },
        __wbg_createPipelineLayout_611a91ca5b984330: function(arg0, arg1) {
            const ret = arg0.createPipelineLayout(arg1);
            return ret;
        },
        __wbg_createShaderModule_8ed627e185604732: function(arg0, arg1) {
            const ret = arg0.createShaderModule(arg1);
            return ret;
        },
        __wbg_device_7ed9b2205c759224: function(arg0, arg1) {
            const ret = arg1.device;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_gpudevicemanager_new: function(arg0) {
            const ret = GpuDeviceManager.__wrap(arg0);
            return ret;
        },
        __wbg_info_bd0db6f73104331c: function(arg0) {
            const ret = arg0.info;
            return ret;
        },
        __wbg_log_e6372b4fbfc9f81e: function(arg0) {
            console.log(arg0);
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_ebe3e0f6837f0879: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_typed_cceaf62d8d95e9f2: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_queueMicrotask_ac694eae12e92dfb: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queueMicrotask_be5fe34a8f4cad4d: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_requestAdapter_6c48aca84e817415: function(arg0, arg1) {
            const ret = arg0.requestAdapter(arg1);
            return ret;
        },
        __wbg_requestDevice_b533d80f270ef2f2: function(arg0) {
            const ret = arg0.requestDevice();
            return ret;
        },
        __wbg_resolve_020f95d838c6ef25: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_set_bind_group_layouts_4e1f4c827ee415b2: function(arg0, arg1, arg2) {
            arg0.bindGroupLayouts = getArrayJsValueViewFromWasm0(arg1, arg2);
        },
        __wbg_set_code_8faf8806d181dcf8: function(arg0, arg1, arg2) {
            arg0.code = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_compute_234d8fe30511adbc: function(arg0, arg1) {
            arg0.compute = arg1;
        },
        __wbg_set_entries_01be0844ba5d4118: function(arg0, arg1, arg2) {
            arg0.entries = getArrayJsValueViewFromWasm0(arg1, arg2);
        },
        __wbg_set_entry_point_f97c5adf6afe99a0: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_force_fallback_adapter_5d2157c001bc6a39: function(arg0, arg1) {
            arg0.forceFallbackAdapter = arg1 !== 0;
        },
        __wbg_set_layout_0276d57a8b789406: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_module_21bb45b084a53d93: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_power_preference_0571dc199e209d3f: function(arg0, arg1) {
            arg0.powerPreference = __wbindgen_enum_GpuPowerPreference[arg1];
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_466428f93b4eaa76: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_c7aea38d4de089bc: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_42d4fae05e59267a: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e0db14a0eba6a812: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_submit_bd1b779eb9cfeeb1: function(arg0, arg1, arg2) {
            arg0.submit(getArrayJsValueViewFromWasm0(arg1, arg2));
        },
        __wbg_then_7026b513a94278a8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_then_72819b8d4e081fb5: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_vendor_b780d8d3dd810f82: function(arg0, arg1) {
            const ret = arg1.vendor;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 40, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("GPUDevice")], shim_idx: 2, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("any")], shim_idx: 2, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__2);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ergalics_core_bg.js": import0,
    };
}

function wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__2(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___wasm_bindgen_88c4dfa59b813fd8___sys__JsNullable_web_sys_15a71ddd799efe3c___features__gen_GpuAdapter__GpuAdapter___core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88c4dfa59b813fd8___JsError___true__2(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_88c4dfa59b813fd8___convert__closures_____invoke___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined___js_sys_c4eaf1aca999235d___Function_fn_wasm_bindgen_88c4dfa59b813fd8___JsValue_____wasm_bindgen_88c4dfa59b813fd8___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_GpuPowerPreference = ["low-power", "high-performance"];
const ComputeKernelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_computekernel_free(ptr, 1));
const ComputeQueueFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_computequeue_free(ptr, 1));
const GpuDeviceManagerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gpudevicemanager_free(ptr, 1));
const GpuInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gpuinfo_free(ptr, 1));
const KernelDescriptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kerneldescriptor_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function getArrayJsValueViewFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('ergalics_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
