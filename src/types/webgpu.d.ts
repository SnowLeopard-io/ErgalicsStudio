// Minimal WebGPU type declarations (subset used by the scaffold).
// Full definitions are provided by @webgpu/types when installed.

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    backend?: string;
  };
}

interface GPUDevice {
  readonly lost: Promise<GPUDeviceLostInfo>;
  addEventListener(type: string, listener: EventListener): void;
  readonly queue: GPUQueue;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
}

interface GPUDeviceLostInfo {
  reason?: string;
  message?: string;
}

interface GPUUncapturedErrorEvent extends Event {
  error: GPUError;
}

type GPUError = GPUOutOfMemoryError | GPUValidationError;

interface GPUOutOfMemoryError {
  message: string;
}

interface GPUValidationError {
  message: string;
}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBufferView | ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
}

interface GPUBuffer {
  readonly size: number;
  readonly usage: number;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GPUBufferDescriptor {
  label?: string;
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUShaderModule {
  getCompilationInfo(): Promise<GPUCompilationInfo>;
}

interface GPUShaderModuleDescriptor {
  code: string;
  label?: string;
}

interface GPUCompilationInfo {
  messages: GPUCompilationMessage[];
}

interface GPUCompilationMessage {
  message: string;
  type: 'error' | 'warning' | 'info';
  lineNum: number;
  linePos: number;
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer?: GPUBufferBindingLayout;
}

interface GPUBufferBindingLayout {
  type?: 'uniform' | 'storage' | 'read-only-storage';
  hasDynamicOffset?: boolean;
  minBindingSize?: number;
}

interface GPUBindGroupLayoutDescriptor {
  label?: string;
  entries: GPUBindGroupLayoutEntry[];
}

interface GPUPipelineLayoutDescriptor {
  label?: string;
  bindGroupLayouts: (GPUBindGroupLayout | null)[];
}

interface GPUProgrammableStage {
  module: GPUShaderModule;
  entryPoint: string;
}

interface GPUComputePipelineDescriptor {
  label?: string;
  layout: GPUPipelineLayout;
  compute: GPUProgrammableStage;
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBuffer;
}

interface GPUBindGroupDescriptor {
  label?: string;
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUCommandEncoder {
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
  finish(): GPUCommandBuffer;
}

interface GPUCommandEncoderDescriptor {
  label?: string;
}

interface GPUComputePassDescriptor {
  label?: string;
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup | null, dynamicOffsets?: number[]): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface GPUPipelineLayout {}
interface GPUBindGroupLayout {}
interface GPUBindGroup {}
interface GPUCommandBuffer {}
interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal';

declare const GPUMapMode: {
  readonly READ: number;
  readonly WRITE: number;
};

declare const GPUBufferUsage: {
  readonly MAP_READ: number;
  readonly MAP_WRITE: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly INDEX: number;
  readonly VERTEX: number;
  readonly UNIFORM: number;
  readonly STORAGE: number;
  readonly INDIRECT: number;
  readonly QUERY_RESOLVE: number;
};

declare const GPUShaderStage: {
  readonly VERTEX: number;
  readonly FRAGMENT: number;
  readonly COMPUTE: number;
};

interface Navigator {
  gpu?: GPU;
}

declare namespace navigator {
  const gpu: GPU | undefined;
}