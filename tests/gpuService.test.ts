// GPU compute service gating (spec §8.3): the surface must be `null` when no
// device is available, and must select the WASM core when its classes are
// present on the loaded module.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const wasmMock = vi.hoisted(() => ({ getWasm: vi.fn() }));

const device = {} as GPUDevice;

function fakeBackend(available: boolean) {
  return {
    available,
    name: 'Test',
    backend: 'webgpu',
    device: available ? device : null,
    fallback: false,
    oom: false,
  };
}

const gpuMock = vi.hoisted(() => ({ getGpuBackend: vi.fn() }));

vi.mock('@/core/gpu', () => ({
  getGpuBackend: () => gpuMock.getGpuBackend(),
}));

vi.mock('@/core/wasm', () => ({
  getWasm: () => wasmMock.getWasm(),
}));

async function freshCompute() {
  const mod = await import('@/core/compute');
  return mod;
}

describe('getGpuCompute', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when no GPU device is available', async () => {
    gpuMock.getGpuBackend.mockReturnValue(fakeBackend(false));
    wasmMock.getWasm.mockReturnValue(null);
    const { getGpuCompute } = await freshCompute();
    expect(getGpuCompute()).toBeNull();
  });

  it('selects the WASM compute engine when the native core is loaded', async () => {
    gpuMock.getGpuBackend.mockReturnValue(fakeBackend(true));
    wasmMock.getWasm.mockReturnValue({
      GpuBuffer: class {},
      ComputeKernel: { compile: vi.fn() },
      KernelDescriptor: class {},
      BindingDescriptor: class {},
    });
    const { getGpuCompute } = await freshCompute();
    const compute = getGpuCompute();
    expect(compute).not.toBeNull();
    expect(compute?.available).toBe(true);
    expect(compute?.backend).toBe('wasm');
  });

  it('falls back to the raw WebGPU engine without the native core', async () => {
    gpuMock.getGpuBackend.mockReturnValue(fakeBackend(true));
    wasmMock.getWasm.mockReturnValue(null);
    const { getGpuCompute } = await freshCompute();
    const compute = getGpuCompute();
    expect(compute).not.toBeNull();
    expect(compute?.backend).toBe('webgpu');
  });
});