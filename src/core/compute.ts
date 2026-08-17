// ==========================================================================
// GPU compute service (spec §3.2.6, §8.3).
//
// The plugin-facing compute surface. Routes through the Rust/WASM core when
// it is loaded (production build), otherwise through the raw WebGPU API
// (dev mode, where the WASM module is absent). Both paths expose the same
// primitives — create buffer, upload, compile kernel, dispatch, read back —
// and plugins reach them via `PluginApi.gpu`.
//
// When there is no WebGPU device, `getGpuCompute()` returns `null` and
// plugins fall back to CPU.
// ==========================================================================

import { logger } from './logger';
import { getGpuBackend } from './gpu';
import { getWasm, type WasmModule } from './wasm';
import type {
  ComputeBufferHandle,
  GpuComputeApi,
  GpuKernelDescriptor,
  GpuKernelHandle,
} from '@/types/plugin';

/** Convert any ArrayBufferView into a byte view over its memory. */
function toBytes(data: ArrayBufferView): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Copy a mapped range out of a GPU buffer before unmap. Respects the view's
 *  byteOffset/length so a nonzero-offset buffer is not misaligned. */
function copyMappedRange(range: ArrayBuffer, byteOffset = 0, byteLength?: number): ArrayBuffer {
  return new Uint8Array(range, byteOffset, byteLength ?? range.byteLength).slice().buffer as ArrayBuffer;
}

// ---- WASM core adapter (primary, used in production builds) -------------

/**
 * Structural types for the generated native-core bindings. The generated
 * classes have `private` constructors and are created through static
 * factories, so we cannot use `InstanceType` — we type them structurally.
 */
type WasmBufferLike = {
  readonly size: number;
  readonly usage: number;
  /** The underlying raw `GPUBuffer` (used for host-side bindings/copies). */
  readonly buffer: GPUBuffer;
  write(queue: GPUQueue, data: Uint8Array, offset: number): void;
  read(): Promise<Uint8Array>;
};

type WasmKernelLike = {
  readonly label: string;
  compilation_info(): Promise<string[]>;
  run(queue: GPUQueue, buffers: GPUBuffer[], x: number, y: number, z: number): void;
};

type BufferCtor = new (device: GPUDevice, label: string, size: number, usage: number) => WasmBufferLike;
type BindingCtor = new (binding: number, bufferType: string) => unknown;
type KernelDescCtor = new (
  label: string,
  wgsl: string,
  entryPoint: string,
  workgroupSize: Uint32Array,
  bindings: unknown[],
) => unknown;

class WasmBuffer implements ComputeBufferHandle {
  readonly raw: WasmBufferLike;

  constructor(
    private readonly device: GPUDevice,
    raw: WasmBufferLike,
  ) {
    this.raw = raw;
  }

  get size(): number {
    return this.raw.size;
  }

  get usage(): number {
    return this.raw.usage;
  }

  write(data: ArrayBufferView, offset = 0): void {
    this.raw.write(this.device.queue, toBytes(data), offset);
  }

  async read(): Promise<ArrayBuffer> {
    const u8 = await this.raw.read();
    return copyMappedRange(u8.buffer as ArrayBuffer, u8.byteOffset, u8.byteLength);
  }

  destroy(): void {
    // The raw `GPUBuffer` is reachable even on the WASM path; destroy it so
    // the device memory is released instead of surviving until GC/teardown.
    try {
      this.raw.buffer.destroy();
    } catch {
      /* already destroyed or device lost */
    }
  }
}

class WasmKernel implements GpuKernelHandle {
  readonly raw: WasmKernelLike;

  constructor(readonly label: string, raw: WasmKernelLike) {
    this.raw = raw;
  }

  compilationInfo(): Promise<string[]> {
    return this.raw.compilation_info();
  }
}

class WasmCompute implements GpuComputeApi {
  readonly available = true;
  readonly backend = 'wasm' as const;

  constructor(
    private readonly device: GPUDevice,
    private readonly wasm: WasmModule,
  ) {}

  createBuffer(size: number, usage: number, label = 'compute'): ComputeBufferHandle | null {
    try {
      const ctor = this.wasm.GpuBuffer as unknown as BufferCtor;
      const raw = new ctor(this.device, label, size, usage);
      return new WasmBuffer(this.device, raw);
    } catch (err) {
      logger.warn('compute', 'buffer creation failed', err);
      return null;
    }
  }

  compileKernel(descriptor: GpuKernelDescriptor): GpuKernelHandle | null {
    try {
      const { ComputeKernel, KernelDescriptor, BindingDescriptor } = this.wasm;
      if (!ComputeKernel || !KernelDescriptor || !BindingDescriptor) return null;
      const workgroupSize = descriptor.workgroupSize ?? [64, 1, 1];
      const bindings = descriptor.bindings.map(
        (b) => new (BindingDescriptor as unknown as BindingCtor)(b.binding, b.bufferType),
      );
      const rawDesc = new (KernelDescriptor as unknown as KernelDescCtor)(
        descriptor.label,
        descriptor.wgsl,
        descriptor.entryPoint ?? 'main',
        new Uint32Array(workgroupSize),
        bindings,
      );
      const kernel = ComputeKernel.compile(this.device, rawDesc as never) as unknown as WasmKernelLike;
      return new WasmKernel(descriptor.label, kernel);
    } catch (err) {
      logger.warn('compute', `kernel compile failed (${descriptor.label})`, err);
      return null;
    }
  }

  run(
    kernel: GpuKernelHandle,
    buffers: ComputeBufferHandle[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number,
  ): boolean {
    if (!(kernel instanceof WasmKernel)) return false;
    if (!buffers.every((b) => b instanceof WasmBuffer)) return false;
    try {
      kernel.raw.run(
        this.device.queue,
        (buffers as WasmBuffer[]).map((b) => b.raw.buffer),
        workgroupCountX,
        workgroupCountY,
        workgroupCountZ,
      );
      notifyGpuDispatch();
      return true;
    } catch (err) {
      logger.warn('compute', `kernel dispatch failed (${kernel.label})`, err);
      return false;
    }
  }
}

// ---- Raw WebGPU adapter (fallback when the WASM module is absent) -------

class NativeBuffer implements ComputeBufferHandle {
  readonly raw: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    raw: GPUBuffer,
    readonly size: number,
    readonly usage: number,
  ) {
    this.raw = raw;
  }

  write(data: ArrayBufferView, offset = 0): void {
    const bytes = toBytes(data);
    if (offset < 0 || offset + bytes.byteLength > this.size) {
      throw new Error(
        `buffer write out of bounds: offset ${offset} + ${bytes.byteLength} bytes > size ${this.size}`,
      );
    }
    if (!(this.usage & GPUBufferUsage.COPY_DST)) {
      // queue.writeBuffer requires COPY_DST on the destination; a MAP_WRITE
      // buffer would need an async map/write/unmap cycle, which the
      // synchronous `write` contract cannot express. Report the mismatch
      // loudly instead of letting the queue throw an opaque validation error.
      throw new Error(
        'buffer is not writable via the queue (requires COPY_DST usage)',
      );
    }
    // Pass an exact byte view + explicit size: writeBuffer's dataOffset/size
    // are in bytes, and a view whose byteOffset is nonzero copies from the
    // view start only when size is explicit (the footgun otherwise copies the
    // whole underlying ArrayBuffer on some implementations).
    this.device.queue.writeBuffer(this.raw, offset, bytes, 0, bytes.byteLength);
  }

  async read(): Promise<ArrayBuffer> {
    // Contract (docs): buffers created with MAP_READ are read by mapping the
    // buffer directly. WebGPU forbids MAP_READ alongside STORAGE, so buffers
    // created for storage compute are read via a COPY_SRC → readback copy.
    if (this.usage & GPUBufferUsage.MAP_READ) {
      try {
        await this.raw.mapAsync(GPUMapMode.READ);
        const range = this.raw.getMappedRange();
        const copy = copyMappedRange(range);
        this.raw.unmap();
        return copy;
      } catch (err) {
        throw new Error(`buffer read (map) failed: ${String(err)}`);
      }
    }
    if (this.usage & GPUBufferUsage.COPY_SRC) {
      const readback = this.device.createBuffer({
        label: 'readback',
        size: this.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      try {
        this.device.queue.copyBufferToBuffer(this.raw, 0, readback, 0, this.size);
        await readback.mapAsync(GPUMapMode.READ);
        const range = readback.getMappedRange();
        const copy = copyMappedRange(range);
        readback.unmap();
        return copy;
      } catch (err) {
        throw new Error(`buffer read (copy) failed: ${String(err)}`);
      } finally {
        // Every copy read allocates a dedicated MAP_READ|COPY_DST readback
        // buffer; release it on both the success and failure paths so GPU
        // memory is not leaked per read. destroy() on an already-destroyed
        // buffer is a no-op.
        try {
          readback.destroy();
        } catch {
          /* device already lost */
        }
      }
    }
    throw new Error('buffer is not readable (requires MAP_READ or COPY_SRC usage)');
  }

  destroy(): void {
    try {
      this.raw.destroy();
    } catch {
      /* already destroyed or device lost */
    }
  }
}

class NativeKernel implements GpuKernelHandle {
  constructor(
    readonly label: string,
    private readonly pipeline: GPUComputePipeline,
    private readonly module: GPUShaderModule,
    /** Binding numbers declared by the kernel descriptor (may be sparse). */
    private readonly bindings: number[],
  ) {}

  async compilationInfo(): Promise<string[]> {
    try {
      const info = await this.module.getCompilationInfo();
      return info.messages.map(
        (m) => `[${m.type}] line ${m.lineNum}:${m.linePos} ${m.message}`,
      );
    } catch {
      return [];
    }
  }

  run(device: GPUDevice, buffers: NativeBuffer[], x: number, y: number, z: number): void {
    // Bind by the kernel descriptor's declared binding numbers, NOT array
    // index: a kernel with sparse/non-contiguous bindings (e.g. {0,2}) was
    // rejected here while the WASM path (which carries real binding numbers)
    // accepted it — divergent behaviour between the two compute backends.
    const entries: GPUBindGroupEntry[] = buffers.map((b, i) => ({
      binding: this.bindings[i] ?? i,
      // Per the current WebGPU spec, `resource` takes a GPUBufferBinding
      // object ({ buffer, offset?, size? }) rather than a bare GPUBuffer;
      // TS 5.7's lib.dom enforces this (GPUBindingResource union).
      resource: { buffer: b.raw },
    }));
    const bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(x, y, z);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}

class NativeCompute implements GpuComputeApi {
  readonly available = true;
  readonly backend = 'webgpu' as const;

  constructor(private readonly device: GPUDevice) {}

  createBuffer(size: number, usage: number, label = 'compute'): ComputeBufferHandle | null {
    try {
      const raw = this.device.createBuffer({ label, size, usage });
      return new NativeBuffer(this.device, raw, size, usage);
    } catch (err) {
      logger.warn('compute', 'buffer creation failed', err);
      return null;
    }
  }

  compileKernel(descriptor: GpuKernelDescriptor): GpuKernelHandle | null {
    try {
      const entries: GPUBindGroupLayoutEntry[] = descriptor.bindings.map((b) => ({
        binding: b.binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: b.bufferType },
      }));
      const layout = this.device.createBindGroupLayout({ entries });
      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [layout],
      });
      const module = this.device.createShaderModule({ code: descriptor.wgsl });
      const pipeline = this.device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: descriptor.entryPoint ?? 'main' },
      });
      return new NativeKernel(
        descriptor.label,
        pipeline,
        module,
        descriptor.bindings.map((b) => b.binding),
      );
    } catch (err) {
      logger.warn('compute', `kernel compile failed (${descriptor.label})`, err);
      return null;
    }
  }

  run(
    kernel: GpuKernelHandle,
    buffers: ComputeBufferHandle[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number,
  ): boolean {
    if (!(kernel instanceof NativeKernel)) return false;
    if (!buffers.every((b) => b instanceof NativeBuffer)) return false;
    try {
      kernel.run(this.device, buffers as NativeBuffer[], workgroupCountX, workgroupCountY, workgroupCountZ);
      notifyGpuDispatch();
      return true;
    } catch (err) {
      logger.warn('compute', `kernel dispatch failed (${kernel.label})`, err);
      return false;
    }
  }
}

// ---- Accessors ----------------------------------------------------------

let cached: { device: GPUDevice; service: GpuComputeApi } | null = null;

/**
 * Resolve the current GPU compute surface, or `null` when no WebGPU device
 * is available. The result is cached per device and re-resolved automatically
 * when the backend device changes (e.g. after a re-init).
 */
export function getGpuCompute(): GpuComputeApi | null {
  const backend = getGpuBackend();
  if (!backend.available || !backend.device) {
    cached = null;
    return null;
  }
  if (cached?.device === backend.device) return cached.service;

  const device = backend.device;
  const wasm = getWasm();
  let service: GpuComputeApi;
  if (wasm?.GpuBuffer && wasm?.ComputeKernel && wasm?.KernelDescriptor && wasm?.BindingDescriptor) {
    service = new WasmCompute(device, wasm);
    logger.info('compute', 'using WASM core compute engine');
  } else {
    service = new NativeCompute(device);
    logger.info('compute', 'using raw WebGPU compute engine');
  }
  cached = { device, service };
  return service;
}

/** Drop the cached compute surface. */
export function resetGpuCompute(): void {
  cached = null;
}

// ---- GPU activity (host indicator) --------------------------------------
//
// Fired whenever a kernel is actually dispatched to the device — once per
// `run()`. The status bar subscribes so a compute burst is visible even when
// the workload is far too short to move a Task-Manager-style GPU graph.

export type GpuActivityListener = () => void;

const gpuActivityListeners = new Set<GpuActivityListener>();

function emitGpuActivity(): void {
  for (const l of gpuActivityListeners) l();
}

/**
 * Notify activity listeners that a real device dispatch just happened.
 * Called internally by both compute backends; exported so hosts can ping the
 * indicator independently (e.g. for tests or direct instrumentation).
 */
export function notifyGpuDispatch(): void {
  emitGpuActivity();
}

/** Subscribe to GPU dispatch activity. Returns an unsubscribe function. */
export function subscribeGpuActivity(listener: GpuActivityListener): () => void {
  gpuActivityListeners.add(listener);
  return () => gpuActivityListeners.delete(listener);
}

export type { ComputeBufferHandle, GpuComputeApi, GpuKernelDescriptor, GpuKernelHandle };