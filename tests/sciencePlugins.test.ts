// Science plugin tests (spec §5 / §8.3): N-body gravity compute + WGSL kernel,
// and the protein interaction network force-directed layout. Covers the GPU
// kernel template generation, buffer pack/unpack, CPU integrator physics
// (momentum conservation), and the plugin compute() CPU fallback path.
import { describe, it, expect, vi } from 'vitest';
import {
  advanceNBodyCPU,
  nbodyBufferBytes,
  nbodyKernelWGSL,
  NBODY_FLOATS_PER_BODY,
  packBodies,
  unpackBodies,
  type NBodyBody,
} from '@/core/wgsl';
import type { PluginApi } from '@/types/plugin';

// ---- helpers -------------------------------------------------------------

function makeApi(overrides: Partial<PluginApi> = {}): PluginApi {
  return {
    locale: 'en-US',
    notify: vi.fn(),
    reportGpuTime: vi.fn(),
    reportDataScale: vi.fn(),
    setStatus: vi.fn(),
    ...overrides,
  } as unknown as PluginApi;
}

// ---- N-body WGSL kernel template -----------------------------------------

describe('nbodyKernelWGSL', () => {
  it('declares the documented 3-binding layout (read / read_write / uniform)', () => {
    const wgsl = nbodyKernelWGSL();
    expect(wgsl).toContain('@group(0) @binding(0) var<storage, read> bodiesIn');
    expect(wgsl).toContain('@group(0) @binding(1) var<storage, read_write> bodiesOut');
    expect(wgsl).toContain('@group(0) @binding(2) var<uniform> params');
    expect(wgsl).toContain('@compute @workgroup_size(64)');
    // the uniform struct carries count as a real u32
    expect(wgsl).toContain('count: u32');
    expect(wgsl).toContain('inverseSqrt');
    // 3-D body layout: 7 floats per body
    expect(wgsl).toContain('const STRIDE: u32 = 7u');
  });

  it('honours a custom workgroup size', () => {
    expect(nbodyKernelWGSL({ workgroupSize: 128 })).toContain('@workgroup_size(128)');
  });
});

// ---- N-body buffer layout -----------------------------------------------

describe('nbody buffer layout', () => {
  it('computes byte sizes from body count', () => {
    expect(NBODY_FLOATS_PER_BODY).toBe(7);
    expect(nbodyBufferBytes(0)).toBe(0);
    expect(nbodyBufferBytes(4096)).toBe(4096 * 28);
  });

  it('round-trips bodies through pack/unpack', () => {
    const bodies: NBodyBody[] = [
      { x: 0.5, y: -0.25, z: 0.1, vx: 0.01, vy: -0.02, vz: 0.3, mass: 10 },
      { x: -1, y: 1, z: -0.5, vx: 0, vy: 0.5, vz: -0.1, mass: 1 },
    ];
    const packed = packBodies(bodies);
    expect(packed).toHaveLength(bodies.length * NBODY_FLOATS_PER_BODY);
    expect(packed[0]).toBeCloseTo(0.5, 6);
    expect(packed[2]).toBeCloseTo(0.1, 6);
    expect(packed[6]).toBe(10); // mass is the 7th float

    const out: NBodyBody[] = [
      { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 0 },
      { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 0 },
    ];
    unpackBodies(packed, out);
    for (let i = 0; i < bodies.length; i += 1) {
      expect(out[i]?.x).toBeCloseTo(bodies[i]!.x, 6);
      expect(out[i]?.z).toBeCloseTo(bodies[i]!.z, 6);
      expect(out[i]?.mass).toBeCloseTo(bodies[i]!.mass, 6);
    }
  });
});

// ---- N-body CPU integrator physics ---------------------------------------

describe('advanceNBodyCPU', () => {
  it('conserves total momentum and produces finite state', () => {
    const bodies: NBodyBody[] = [
      { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 100 },
      { x: 1, y: 0, z: 0, vx: 0, vy: 0.5, vz: 0, mass: 1 },
      { x: -1, y: 0, z: 0, vx: 0, vy: -0.5, vz: 0, mass: 1 },
    ];
    const p0 = bodies.reduce((s, b) => s + b.mass * b.vx, 0);

    for (let s = 0; s < 40; s += 1) advanceNBodyCPU(bodies, 0.001, 0.05, 0.03);

    const p1 = bodies.reduce((s, b) => s + b.mass * b.vx, 0);
    expect(p1).toBeCloseTo(p0, 9); // internal forces conserve momentum
    for (const b of bodies) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
      expect(Number.isFinite(b.z)).toBe(true);
      expect(Number.isFinite(b.vx)).toBe(true);
    }
  });

  it('pulls bodies toward each other (attractive gravity)', () => {
    // two equal masses start at rest and should accelerate toward the origin
    const bodies: NBodyBody[] = [
      { x: 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 1 },
      { x: -1, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 1 },
    ];
    advanceNBodyCPU(bodies, 0.001, 1, 0.03);
    // after one step each body gains velocity toward the other
    expect(bodies[0]!.vx).toBeLessThan(0);
    expect(bodies[1]!.vx).toBeGreaterThan(0);
  });

  it('matches Kepler period for unequal masses (regression: missing /mᵢ)', () => {
    // Regression: the integrator used force G·mᵢ·mⱼ/r³ (not acceleration
    // G·mⱼ/r³) and fed it straight into the velocity update, so unequal-mass
    // systems ran ~√(mᵢ) too fast. The equal-mass Kepler benchmark masked this.
    // With m1=1, m2=10 the measured period must match Kepler's third law
    // T = 2π·√(a³/G·M) to within a few percent.
    const G = 1;
    const m1 = 1;
    const m2 = 10;
    const M = m1 + m2;
    const a = 1; // circular orbit, separation = semi-major axis
    const vRel = Math.sqrt((G * M) / a);
    const bodies: NBodyBody[] = [
      { x: (-a * m2) / M, y: 0, z: 0, vx: 0, vy: (-vRel * m2) / M, vz: 0, mass: m1 },
      { x: (a * m1) / M, y: 0, z: 0, vx: 0, vy: (vRel * m1) / M, vz: 0, mass: m2 },
    ];
    const T = 2 * Math.PI * Math.sqrt((a * a * a) / (G * M));
    const dt = T / 4000;
    const maxSteps = Math.ceil((1.3 * T) / dt);
    const TWO_PI = Math.PI * 2;
    let prev = Math.atan2(bodies[1]!.y - bodies[0]!.y, bodies[1]!.x - bodies[0]!.x);
    let unwrapped = prev;
    let tPeriod = Number.NaN;
    for (let s = 1; s <= maxSteps; s += 1) {
      advanceNBodyCPU(bodies, dt, G, 0);
      const rx = bodies[1]!.x - bodies[0]!.x;
      const ry = bodies[1]!.y - bodies[0]!.y;
      const th = Math.atan2(ry, rx);
      let d = th - prev;
      if (d > Math.PI) d -= TWO_PI;
      if (d < -Math.PI) d += TWO_PI;
      unwrapped += d;
      prev = th;
      if (unwrapped >= TWO_PI) {
        const frac = (TWO_PI - (unwrapped - d)) / Math.max(1e-30, d);
        tPeriod = (s - 1 + frac) * dt;
        break;
      }
    }
    const err = Math.abs(tPeriod - T) / T;
    // Symplectic-Euler frequency error is O((ω·dt)²) ≈ 2.5e-7 here, so a
    // 5% bound cleanly separates the fixed integrator from the old ~57% error.
    expect(err).toBeLessThan(0.05);
  });
});

// ---- N-Body plugin compute fallback --------------------------------------

describe('NBodyPlugin compute (CPU fallback)', () => {
  it('runs the CPU integrator and reports progress when no GPU is present', async () => {
    const { NBodyPlugin } = await import('@/plugins/builtin/nbody');
    const plugin = new NBodyPlugin();
    const api = makeApi();
    await plugin.init(api);

    const file = new File(
      [JSON.stringify({ bodies: [[0, 0, 0, 0, 0, 0, 100], [1, 0, 0, 0.5, 0, 0, 1], [-1, 0, 0, -0.5, 0, 0, 1]] })],
      'nbody.json',
    );
    await plugin.loadData(file);

    const progress: number[] = [];
    const result = await plugin.compute(null, (p) => progress.push(p.done));

    expect(result.ok).toBe(true);
    expect(progress[progress.length - 1]).toBeGreaterThan(0);
    expect(api.reportGpuTime).toHaveBeenCalled();
  });

  it('returns an error when no data has been loaded', async () => {
    const { NBodyPlugin } = await import('@/plugins/builtin/nbody');
    const plugin = new NBodyPlugin();
    const api = makeApi();
    await plugin.init(api);
    // the plugin must NOT fabricate a dataset — compute() reports an error
    const result = await plugin.compute(null);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---- Protein interaction network ----------------------------------------

describe('ProteinPlugin compute (force-directed layout)', () => {
  it('lays out a connected network and reports component metrics', async () => {
    const { ProteinPlugin } = await import('@/plugins/builtin/protein');
    const plugin = new ProteinPlugin();
    const api = makeApi();
    await plugin.init(api);

    const file = new File(
      [
        JSON.stringify({
          proteins: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
          interactions: [
            { source: 'A', target: 'B', weight: 1 },
            { source: 'B', target: 'C', weight: 1 },
            { source: 'C', target: 'D', weight: 1 },
            { source: 'A', target: 'D', weight: 0.5 },
          ],
        }),
      ],
      'ppi.json',
    );
    await plugin.loadData(file);

    const progress: number[] = [];
    const result = await plugin.compute(null, (p) => progress.push(p.done));

    expect(result.ok).toBe(true);
    expect(progress[progress.length - 1]).toBeGreaterThan(0);
    const out = result.output as { nodes: number; edges: number; components: number; maxComponent: number };
    expect(out.nodes).toBe(4);
    expect(out.edges).toBe(4);
    expect(out.components).toBe(1); // fully connected → single component
    expect(out.maxComponent).toBe(4);
    expect(api.reportGpuTime).toHaveBeenCalled();
  });

  it('parses numeric-index edges and weight arrays', async () => {
    const { ProteinPlugin } = await import('@/plugins/builtin/protein');
    const plugin = new ProteinPlugin();
    await plugin.init(makeApi());
    const file = new File(
      [JSON.stringify({ proteins: [{ id: 'X' }, { id: 'Y' }], interactions: [[0, 1, 0.8]] })],
      'ppi2.json',
    );
    await plugin.loadData(file);
    const result = await plugin.compute(null);
    expect(result.ok).toBe(true);
  });

  it('returns an error when no network has been loaded', async () => {
    const { ProteinPlugin } = await import('@/plugins/builtin/protein');
    const plugin = new ProteinPlugin();
    await plugin.init(makeApi());
    const result = await plugin.compute(null);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
