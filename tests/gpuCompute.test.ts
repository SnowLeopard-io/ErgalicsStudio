// GPU compute foundation tests (spec §8.3): WGSL template generation,
// particle buffer packing/unpacking, the CPU-equivalent integrator, and the
// compute service's device gating.
import { describe, it, expect, vi } from 'vitest';
import {
  advanceParticleCPU,
  packParticleParams,
  packParticles,
  particleBufferBytes,
  particleKernelWGSL,
  PARTICLES_BUFFER_USAGE,
  PARTICLES_UNIFORM_USAGE,
  PARTICLE_FLOATS_PER_PARTICLE,
  unpackParticles,
  GPU_BUFFER_USAGE,
} from '@/core/wgsl';
import type { ParticleState } from '@/types/plugin';

describe('particleKernelWGSL', () => {
  it('generates a compute kernel with the documented bind group layout', () => {
    const wgsl = particleKernelWGSL();
    expect(wgsl).toContain('@group(0) @binding(0) var<storage, read_write> data');
    expect(wgsl).toContain('@group(0) @binding(1) var<uniform> params');
    expect(wgsl).toContain('@compute @workgroup_size(64)');
    expect(wgsl).toContain('fn main(@builtin(global_invocation_id) gid');
    expect(wgsl).toContain('params.count');
  });

  it('honours a custom workgroup size', () => {
    expect(particleKernelWGSL({ workgroupSize: 128 })).toContain('@workgroup_size(128)');
  });
});

describe('particle buffer layout', () => {
  it('computes byte sizes from particle count', () => {
    expect(particleBufferBytes(0)).toBe(0);
    expect(particleBufferBytes(5000)).toBe(5000 * 16);
    expect(particleBufferBytes(1.9)).toBe(16); // floored
  });

  it('round-trips particles through pack/unpack', () => {
    const particles: ParticleState[] = [
      { x: 0.5, y: -0.25, vx: 0.01, vy: -0.02 },
      { x: -1, y: 1, vx: 0, vy: 0.5 },
    ];
    const packed = packParticles(particles);
    expect(packed).toHaveLength(particles.length * PARTICLE_FLOATS_PER_PARTICLE);
    expect(packed[0]).toBe(0.5);
    expect(packed[5]).toBe(1);

    const out: ParticleState[] = [
      { x: 0, y: 0, vx: 0, vy: 0 },
      { x: 0, y: 0, vx: 0, vy: 0 },
    ];
    unpackParticles(packed, out);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i] as ParticleState;
      const o = out[i] as ParticleState;
      expect(o.x).toBeCloseTo(p.x, 6);
      expect(o.y).toBeCloseTo(p.y, 6);
      expect(o.vx).toBeCloseTo(p.vx, 6);
      expect(o.vy).toBeCloseTo(p.vy, 6);
    }
  });

  it('packs uniform params as [dt, speed, count, 0]', () => {
    const params = packParticleParams(1 / 60, 2.5, 1000);
    expect(params[0]).toBeCloseTo(1 / 60, 6);
    expect(params[1]).toBe(2.5);
    expect(params[3]).toBe(0);
  });

  it('writes `count` as a real u32 so the kernel bounds guard fires', () => {
    // The WGSL struct declares `count: u32` (see particleKernelWGSL); a plain
    // f32 store would leave the float bit-pattern in memory. Reading the bytes
    // back as little-endian u32 must yield the exact integer.
    const params = packParticleParams(1 / 60, 2.5, 1000);
    const dv = new DataView(params.buffer);
    expect(dv.getUint32(8, true)).toBe(1000);
    expect(dv.getUint32(8, true)).not.toBe(1169915904); // f32 bit pattern of 1000
  });

  it('exposes buffer usage flags aligned with GPUBufferUsage', () => {
    // storage + copy-dst + copy-src — WebGPU forbids MAP_READ alongside
    // STORAGE, so results are read via a separate MAP_READ|COPY_DST buffer.
    expect(PARTICLES_BUFFER_USAGE).toBe(
      GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC,
    );
    // uniform + copy-dst — writeBuffer validation requires COPY_DST on the
    // destination, otherwise uploading params throws on a real device.
    expect(PARTICLES_UNIFORM_USAGE).toBe(GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST);
    expect(GPU_BUFFER_USAGE.STORAGE).toBe(128);
    expect(GPU_BUFFER_USAGE.UNIFORM).toBe(64);
  });
});

describe('advanceParticleCPU', () => {
  it('integrates position by velocity × dt × speed', () => {
    const p: ParticleState = { x: 0, y: 0, vx: 1, vy: 2 };
    advanceParticleCPU(p, 0.1, 1);
    expect(p.x).toBeCloseTo(0.1);
    expect(p.y).toBeCloseTo(0.2);
  });

  it('bounces at the ±1 boundaries and flips velocity', () => {
    const p: ParticleState = { x: 0.95, y: -0.98, vx: 1, vy: -1 };
    advanceParticleCPU(p, 0.1, 1);
    expect(p.x).toBeCloseTo(1);
    expect(p.vx).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(-1);
    expect(p.vy).toBeCloseTo(1);
  });
});

describe('particles plugin compute fallback', () => {
  function makeApi() {
    return {
      locale: 'en-US',
      notify: vi.fn(),
      reportGpuTime: vi.fn(),
      reportDataScale: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as import('@/types/plugin').PluginApi;
  }

  it('runs the CPU integrator and reports progress when GPU is absent', async () => {
    const { ParticlePlugin } = await import('@/plugins/builtin/particles');
    const plugin = new ParticlePlugin();
    const api = makeApi();
    await plugin.init(api);

    const file = new File(
      ['0 0 0.01 0\n0.5 -0.5 -0.01 0.02\n-0.25 0.75 0.005 -0.01\n'],
      'test.dat',
    );
    await plugin.loadData(file);

    const progress: number[] = [];
    const result = await plugin.compute(null, (p) => progress.push(p.done));

    expect(result.ok).toBe(true);
    expect(result.metrics?.gpuMs).toBeGreaterThanOrEqual(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(240);
    expect(api.reportGpuTime).toHaveBeenCalled();
  });
});