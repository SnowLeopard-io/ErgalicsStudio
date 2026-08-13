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

interface Navigator {
  gpu?: GPU;
}

declare namespace navigator {
  const gpu: GPU | undefined;
}