// ==========================================================================
// FR-15 3D visualization tests: height-field meshing, voxel isosurface,
// point-cloud budget/downsample policy, GPU color kernel + CPU mirror,
// parsers, and the surface/voxel plugin lifecycles (no WebGPU in Node →
// the CPU fallback paths are the ones exercised here).
// ==========================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  heightFieldToMesh,
  voxelIsosurface,
  voxelSolidCells,
  type VoxelField,
} from '@/core/mesh3d';
import {
  CPU_POINT_BUDGET,
  GPU_POINT_BUDGET,
  isWebGpuAvailable,
  preparePointCloud,
  strideDownsample,
  randomDownsample,
  heightColorsCPU,
  scalarRampColors,
  rampColor,
  RAMP_LOW,
  RAMP_MID,
  RAMP_HIGH,
  pointCloudColorKernelWGSL,
  pointCloudColorBytes,
  packPointCloudGpuParams,
  heightColorsGpu,
} from '@/core/pointcloud-gpu';
import {
  Surface3DPlugin,
  parseHeightGrid,
  sampleSurfaceFunction,
  surfaceFunctionValue,
} from '@/plugins/builtin/surface3D';
import {
  Voxel3DPlugin,
  parseVoxelField,
  fieldRange,
} from '@/plugins/builtin/voxel3D';
import { PointCloud3DPlugin } from '@/plugins/builtin/pointCloud3D';
import { viz3dZh, viz3dEn } from '@/i18n/dicts/viz3d';
import type { PluginApi } from '@/types/plugin';

beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => undefined;
});

// ---- helpers ---------------------------------------------------------------

function fakeApi(locale = 'en-US'): PluginApi {
  return {
    locale,
    t: (k: string) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: () => {},
    log: () => {},
    exportFile: () => {},
    cache: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      clear: async () => {},
      keys: async () => [],
    },
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: () => undefined,
    setParam: () => {},
  } as unknown as PluginApi;
}

function injectThree(plugin: unknown) {
  const scene = { added: [] as unknown[], removed: [] as unknown[] };
  const handle = {
    scene: {
      add: (o: unknown) => scene.added.push(o),
      remove: (o: unknown) => scene.removed.push(o),
    },
    camera: {
      position: { set: () => {}, copy: () => {} },
      near: 0.1,
      far: 2000,
      updateProjectionMatrix: () => {},
    },
    controls: {
      target: { set: () => {}, copy: () => {} },
      update: () => {},
    },
    render: vi.fn(),
    snapshot: () => 'data:image/png;base64,iVBORw0KGgo=',
  };
  (plugin as { three: unknown }).three = handle;
  return { handle, scene };
}

/** Merge triangle indices by vertex position so shared edges become shared
 *  indices (the voxel surface duplicates per-face vertices on purpose). */
function mergeByPosition(positions: Float32Array, indices: Uint32Array): Uint32Array {
  const key = new Map<string, number>();
  const remap = new Map<number, number>();
  let next = 0;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    const v = indices[i]!;
    let merged = remap.get(v);
    if (merged === undefined) {
      const k = `${positions[v * 3]!.toFixed(6)},${positions[v * 3 + 1]!.toFixed(6)},${positions[v * 3 + 2]!.toFixed(6)}`;
      const hit = key.get(k);
      merged = hit ?? next++;
      if (hit === undefined) key.set(k, merged);
      remap.set(v, merged);
    }
    out[i] = merged;
  }
  return out;
}

/** Directed-edge parity check: a closed orientable surface has every (a→b)
 *  edge matched by exactly one (b→a) edge. */
function isWatertight(indices: Uint32Array): boolean {
  const counts = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      counts.set(`${u}->${v}`, (counts.get(`${u}->${v}`) ?? 0) + 1);
    }
  }
  for (const [edge, n] of counts) {
    const [from, to] = edge.split('->') as [string, string];
    if (counts.get(`${to}->${from}`) !== n) return false;
  }
  return true;
}

function field(nx: number, ny: number, nz: number, fn: (x: number, y: number, z: number) => number): VoxelField {
  const values = new Float32Array(nx * ny * nz);
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        values[(x * ny + y) * nz + z] = fn(x, y, z);
      }
    }
  }
  return { nx, ny, nz, values };
}

function cloudOf(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = i;
    out[i * 3 + 1] = i * 2;
    out[i * 3 + 2] = i * 3;
  }
  return out;
}

// ---- height-field meshing ---------------------------------------------------

describe('heightFieldToMesh', () => {
  it('produces one vertex per grid node and two triangles per cell', () => {
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    const mesh = heightFieldToMesh(grid)!;
    expect(mesh).toBeTruthy();
    expect(mesh.positions).toHaveLength(9 * 3);
    expect(mesh.values).toHaveLength(9);
    // 4 cells × 2 triangles × 3 indices
    expect(mesh.indices).toHaveLength(4 * 2 * 3);
    // heights land in z
    expect(mesh.positions[2]).toBe(0);
    expect(mesh.positions[8]).toBe(2);
    expect(mesh.positions[(2 * 3 + 2) * 3 + 2]).toBe(8);
  });

  it('centers the grid and honours cellSize/heightScale', () => {
    const mesh = heightFieldToMesh([[0, 0], [0, 0]], { cellSize: 2, center: true })!;
    expect(mesh.positions[0]).toBeCloseTo(-1);
    expect(mesh.positions[3]).toBeCloseTo(1);
    const scaled = heightFieldToMesh([[1, 1], [1, 1]], { heightScale: 3 })!;
    expect(scaled.positions[2]).toBeCloseTo(3);
    const off = heightFieldToMesh([[0, 0], [0, 0]], { center: false })!;
    expect(off.positions[0]).toBe(0);
    expect(off.positions[3]).toBe(1);
  });

  it('is manifold: interior edges shared by 2 triangles, boundary by 1', () => {
    const rows = 5;
    const cols = 4;
    const grid = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => r * cols + c),
    );
    const mesh = heightFieldToMesh(grid)!;
    const edgeCount = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t]!;
      const b = mesh.indices[t + 1]!;
      const c = mesh.indices[t + 2]!;
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const k = u < v ? `${u}-${v}` : `${v}-${u}`;
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }
    let once = 0;
    let twice = 0;
    for (const n of edgeCount.values()) {
      expect(n).toBeLessThanOrEqual(2);
      if (n === 1) once += 1;
      else twice += 1;
    }
    // boundary edges of a rows × cols grid
    expect(once).toBe(2 * (rows - 1) + 2 * (cols - 1));
    expect(once + 2 * twice).toBe(mesh.indices.length); // every edge slot accounted
  });

  it('rejects ragged, tiny and empty grids; sanitizes non-finite cells', () => {
    expect(heightFieldToMesh([[1]])).toBeNull();
    expect(heightFieldToMesh([[1, 2]])).toBeNull();
    expect(heightFieldToMesh([[1], [2]])).toBeNull();
    expect(heightFieldToMesh([])).toBeNull();
    expect(heightFieldToMesh([[1, 2], [3]])).toBeNull();
    const mesh = heightFieldToMesh([[Number.NaN, 1], [2, 3]])!;
    expect(mesh.positions[2]).toBe(0); // NaN → height 0
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });
});

// ---- voxel isosurface -------------------------------------------------------

describe('voxelIsosurface', () => {
  it('extracts a closed cube for a single solid voxel', () => {
    const f = field(1, 1, 1, () => 1);
    const mesh = voxelIsosurface(f, 0.5);
    expect(mesh.indices).toHaveLength(6 * 2 * 3); // 6 faces × 2 triangles
    expect(mesh.positions).toHaveLength(6 * 4 * 3); // 4 duplicated verts / face
    const merged = mergeByPosition(mesh.positions, mesh.indices);
    let unique = 0;
    const seen = new Set<number>();
    for (const v of merged) if (!seen.has(v)) (seen.add(v), unique++);
    expect(unique).toBe(8); // the 8 cube corners
    expect(isWatertight(merged)).toBe(true);
  });

  it('hollows a 3×3×3 shell at mid level and stays watertight', () => {
    const f = field(3, 3, 3, (x, y, z) => (x === 1 && y === 1 && z === 1 ? 0 : 2));
    const mesh = voxelIsosurface(f, 1);
    // 26 solid cells, 26×6 exterior faces minus shared... just check topology
    expect(mesh.indices.length % 6).toBe(0);
    const merged = mergeByPosition(mesh.positions, mesh.indices);
    expect(isWatertight(merged)).toBe(true);
    // the cavity adds 12 inner faces (26 exterior of a 3³ block = 54 faces,
    // plus 6 faces of the removed centre cell → 60 faces → 120 triangles)
    expect(mesh.indices.length).toBe(60 * 6);
  });

  it('emits nothing when the level excludes the whole field', () => {
    const f = field(2, 2, 2, () => 0.1);
    const mesh = voxelIsosurface(f, 0.5);
    expect(mesh.indices).toHaveLength(0);
    expect(mesh.positions).toHaveLength(0);
    expect(mesh.values).toHaveLength(0);
  });

  it('marks the solid cells with linear indices (z fastest)', () => {
    const f = field(2, 2, 2, (x, _y, z) => (x === 1 && z === 1 ? 1 : 0));
    const cells = voxelSolidCells(f, 0.5);
    // linear index = (x*ny + y)*nz + z → x=1, z=1 ⇒ 5 and 7
    expect(Array.from(cells)).toEqual([5, 7]);
    for (const c of cells) {
      const x = Math.floor(c / 4);
      const z = c % 2;
      expect(x).toBe(1);
      expect(z).toBe(1);
    }
  });
});

// ---- downsample policy ------------------------------------------------------

describe('strideDownsample', () => {
  it('is a no-op below the budget and keeps the first point above it', () => {
    const cloud = cloudOf(10);
    expect(strideDownsample(cloud, 10)).toBe(cloud);
    expect(strideDownsample(cloud, 20)).toBe(cloud);
    const out = strideDownsample(cloud, 5);
    expect(out).toHaveLength(15);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    // evenly spaced source indices 0,2,4,6,8
    expect(out[3]).toBe(2);
    expect(out[12]).toBe(8);
  });

  it('is deterministic', () => {
    const cloud = cloudOf(1000);
    const a = strideDownsample(cloud, 300);
    const b = strideDownsample(cloud, 300);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('randomDownsample', () => {
  it('honours the size and is reproducible per seed', () => {
    const cloud = cloudOf(1000);
    const a = randomDownsample(cloud, 200, 42);
    const b = randomDownsample(cloud, 200, 42);
    const c = randomDownsample(cloud, 200, 43);
    expect(a).toHaveLength(600);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('only ever emits source points', () => {
    const cloud = cloudOf(50);
    const out = randomDownsample(cloud, 10, 7);
    for (let i = 0; i < 10; i += 1) {
      const x = out[i * 3]!;
      expect(x).toBe(out[i * 3 + 1]! / 2);
      expect(x).toBe(out[i * 3 + 2]! / 3);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(50);
    }
  });
});

describe('preparePointCloud (FR-15 budget policy)', () => {
  it('keeps up to a million points when WebGPU is available', () => {
    const cloud = cloudOf(500_000);
    const p = preparePointCloud(cloud, { gpuAvailable: true });
    expect(p.downsampled).toBe(false);
    expect(p.shown).toBe(500_000);
    expect(p.positions).toBe(cloud); // zero-copy
    expect(p.budget).toBe(GPU_POINT_BUDGET);
  });

  it('caps at the GPU budget above a million', () => {
    const cloud = cloudOf(1_200_000);
    const p = preparePointCloud(cloud, { gpuAvailable: true });
    expect(p.downsampled).toBe(true);
    expect(p.shown).toBe(GPU_POINT_BUDGET);
    expect(p.total).toBe(1_200_000);
  });

  it('downsamples to the CPU budget without WebGPU and flags it', () => {
    const cloud = cloudOf(300_000);
    const p = preparePointCloud(cloud, { gpuAvailable: false });
    expect(p.downsampled).toBe(true);
    expect(p.shown).toBe(CPU_POINT_BUDGET);
    expect(p.budget).toBe(CPU_POINT_BUDGET);
  });

  it('leaves small clouds untouched in both modes', () => {
    const cloud = cloudOf(100);
    for (const gpuAvailable of [true, false]) {
      const p = preparePointCloud(cloud, { gpuAvailable });
      expect(p.downsampled).toBe(false);
      expect(p.positions).toBe(cloud);
    }
  });

  it('accepts an explicit budget override and strategy', () => {
    const cloud = cloudOf(1000);
    const p = preparePointCloud(cloud, { gpuAvailable: true, maxPoints: 100, strategy: 'random', seed: 5 });
    expect(p.shown).toBe(100);
    expect(p.downsampled).toBe(true);
  });
});

// ---- GPU color kernel + CPU mirror -----------------------------------------

describe('pointCloudColorKernelWGSL', () => {
  it('declares the documented 3-binding layout and a workgroup guard', () => {
    const wgsl = pointCloudColorKernelWGSL();
    expect(wgsl).toContain('@group(0) @binding(0) var<storage, read> points');
    expect(wgsl).toContain('@group(0) @binding(1) var<uniform> params');
    expect(wgsl).toContain('@group(0) @binding(2) var<storage, read_write> colors');
    expect(wgsl).toContain('@compute @workgroup_size(64)');
    expect(wgsl).toContain('if (i >= params.count)');
    // the same teal → cyan → amber stops as the CPU ramp
    expect(wgsl).toContain('0.05098');
    expect(wgsl).toContain('0.98431');
  });

  it('honours a custom workgroup size', () => {
    expect(pointCloudColorKernelWGSL({ workgroupSize: 128 })).toContain('@workgroup_size(128)');
  });

  it('packs params and sizes buffers consistently', () => {
    expect(pointCloudColorBytes(10)).toBe(120);
    expect(pointCloudColorBytes(-5)).toBe(0);
    const packed = packPointCloudGpuParams(7, -1.5, 2.5);
    expect(packed.byteLength).toBe(16);
    const dv = new DataView(packed);
    expect(dv.getUint32(0, true)).toBe(7);
    expect(dv.getFloat32(8, true)).toBeCloseTo(-1.5);
    expect(dv.getFloat32(12, true)).toBeCloseTo(2.5);
  });
});

describe('ramp colors (CPU mirror of the WGSL kernel)', () => {
  it('maps the ramp endpoints to the documented stops', () => {
    expect(rampColor(0)).toEqual([RAMP_LOW[0], RAMP_LOW[1], RAMP_LOW[2]]);
    const high = rampColor(1);
    expect(high[0]).toBeCloseTo(RAMP_HIGH[0], 6);
    expect(high[1]).toBeCloseTo(RAMP_HIGH[1], 6);
    expect(high[2]).toBeCloseTo(RAMP_HIGH[2], 6);
    const mid = rampColor(0.5);
    expect(mid[0]).toBeCloseTo(RAMP_MID[0], 5);
    expect(mid[1]).toBeCloseTo(RAMP_MID[1], 5);
  });

  it('clamps out-of-range t', () => {
    expect(rampColor(-5)).toEqual(rampColor(0));
    expect(rampColor(9)).toEqual(rampColor(1));
  });

  it('heightColorsCPU reads z from the xyz-interleaved layout', () => {
    const cloud = new Float32Array([0, 0, -1, 0, 0, 0, 0, 0, 1]);
    const colors = heightColorsCPU(cloud, -1, 1);
    expect(colors).toHaveLength(9);
    expect(colors[0]).toBeCloseTo(RAMP_LOW[0]);
    expect(colors[6]).toBeCloseTo(RAMP_HIGH[0]);
    expect(colors[3]).toBeCloseTo(RAMP_MID[0], 4);
  });

  it('scalarRampColors handles flat per-vertex values', () => {
    const colors = scalarRampColors(new Float32Array([0, 5, 10]), 0, 10);
    expect(colors).toHaveLength(9);
    expect(colors[0]).toBeCloseTo(RAMP_LOW[0]);
    expect(colors[6]).toBeCloseTo(RAMP_HIGH[0]);
  });

  it('is robust to a zero-height span', () => {
    const colors = heightColorsCPU(new Float32Array([0, 0, 7, 0, 0, 7]), 7, 7);
    expect(colors.every(Number.isFinite)).toBe(true);
    expect(colors[0]).toBeCloseTo(RAMP_LOW[0]);
  });
});

describe('heightColorsGpu', () => {
  it('returns null (caller falls back to CPU) when the kernel fails to compile', async () => {
    const gpu = { available: true, compileKernel: () => null } as never;
    expect(await heightColorsGpu(gpu, cloudOf(3), 0, 1)).toBeNull();
  });

  it('returns null when a buffer cannot be created and destroys the rest', async () => {
    const created: Array<{ destroy: () => void }> = [];
    const gpu = {
      available: true,
      compileKernel: () => ({ label: 'x' }),
      createBuffer: (size: number, _usage: number, label: string) => {
        if (label === 'pointcloud.colors') return null;
        const buf = { size, destroy: vi.fn(), write: vi.fn(), read: async () => new ArrayBuffer(0) };
        created.push(buf);
        return buf;
      },
      run: () => true,
    } as never;
    expect(await heightColorsGpu(gpu, cloudOf(100), 0, 1)).toBeNull();
    expect(created).toHaveLength(2); // points + params created, then released
    for (const buf of created) expect(buf.destroy).toHaveBeenCalled();
  });

  it('uploads the whole cloud once and reads colors back', async () => {
    const cloud = cloudOf(3);
    const writes: ArrayBufferView[] = [];
    const colorBuf = {
      size: pointCloudColorBytes(3),
      write: vi.fn(),
      destroy: vi.fn(),
      read: async () => {
        const out = new Float32Array(9);
        out.set(heightColorsCPU(cloud, 0, 6));
        return out.buffer;
      },
    };
    const run = vi.fn(() => true);
    const gpu = {
      available: true,
      compileKernel: vi.fn(() => ({ label: 'pointcloud.color' })),
      createBuffer: (_size: number, _usage: number, label: string) => ({
        size: _size,
        write: (d: ArrayBufferView) => writes.push(d),
        read: async () => new ArrayBuffer(_size),
        destroy: vi.fn(),
        ...(label === 'pointcloud.colors' ? colorBuf : {}),
      }),
      run,
    } as never;
    const colors = await heightColorsGpu(gpu, cloud, 0, 6);
    expect(colors).not.toBeNull();
    expect(colors).toHaveLength(9);
    expect(run).toHaveBeenCalledTimes(1); // single dispatch over the full buffer
    expect(writes.length).toBeGreaterThanOrEqual(2); // points + params uploads
  });
});

// ---- parsers ----------------------------------------------------------------

describe('parseHeightGrid', () => {
  it('reads JSON 2-D arrays and wrappers', () => {
    expect(parseHeightGrid('[[1,2],[3,4]]')).toEqual([[1, 2], [3, 4]]);
    expect(parseHeightGrid('{"values":[[1,2],[3,4]]}')).toEqual([[1, 2], [3, 4]]);
    expect(parseHeightGrid('{"grid":[[5]]}')).toEqual([[5]]);
  });

  it('reads whitespace/comma rows and drops header lines', () => {
    const grid = parseHeightGrid('x y z\n1 2 3\n4,5,6\n');
    expect(grid).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('pads ragged rows and maps non-finite cells to NaN', () => {
    const grid = parseHeightGrid('[[1,2],[3]]');
    expect(grid).toEqual([[1, 2], [3, Number.NaN]]);
    const text = parseHeightGrid('1 bad 3\n4 5 6\n');
    expect(text).toEqual([[4, 5, 6]]);
  });

  it('returns [] for non-grids', () => {
    expect(parseHeightGrid('')).toEqual([]);
    expect(parseHeightGrid('hello world')).toEqual([]);
  });
});

describe('sampleSurfaceFunction / surfaceFunctionValue', () => {
  it('samples a square grid of the requested resolution', () => {
    const grid = sampleSurfaceFunction('gaussian', 16);
    expect(grid).toHaveLength(16);
    expect(grid[0]).toHaveLength(16);
    expect(grid[7]![7]!).toBeGreaterThan(grid[0]![0]!); // peak at the centre
  });

  it('clamps degenerate resolutions', () => {
    expect(sampleSurfaceFunction('sine', 1)).toHaveLength(2);
  });

  it('evaluates every named function', () => {
    for (const fn of ['sine', 'gaussian', 'saddle', 'ripple', 'paraboloid'] as const) {
      expect(Number.isFinite(surfaceFunctionValue(fn, 0.3, -0.7))).toBe(true);
    }
    expect(surfaceFunctionValue('saddle', 1, 0)).toBe(1);
    expect(surfaceFunctionValue('paraboloid', 0, 0)).toBeCloseTo(-1);
  });
});

describe('parseVoxelField', () => {
  it('reads a JSON 3-D array (x → y → z nesting)', () => {
    const f = parseVoxelField('[[[1,2],[3,4]],[[5,6],[7,8]]]')!;
    expect(f).toBeTruthy();
    expect([f.nx, f.ny, f.nz]).toEqual([2, 2, 2]);
    expect(f.values[0]).toBe(1);
    expect(f.values[7]).toBe(8);
  });

  it('reads the {nx, ny, nz, values} wrapper', () => {
    const f = parseVoxelField('{"nx":2,"ny":1,"nz":2,"values":[0,1,2,3]}')!;
    expect(f.values).toEqual(new Float32Array([0, 1, 2, 3]));
  });

  it('rejects non-fields, short value arrays and oversized cells', () => {
    expect(parseVoxelField('1 2 3')).toBeNull();
    expect(parseVoxelField('[[1,2],[3,4]]')).toBeNull(); // 2-D is not a field
    expect(parseVoxelField('{"nx":2,"ny":2,"nz":2,"values":[1,2,3]}')).toBeNull();
    expect(parseVoxelField('{"nx":200,"ny":200,"nz":200,"values":[]}')).toBeNull();
  });

  it('fieldRange covers the values', () => {
    const f = field(2, 1, 1, (x) => x - 0.5);
    expect(fieldRange(f)).toEqual({ min: -0.5, max: 0.5 });
    expect(fieldRange({ nx: 1, ny: 1, nz: 1, values: new Float32Array(0) })).toEqual({ min: 0, max: 1 });
  });
});

// ---- plugin lifecycles (no WebGPU in Node → CPU fallback paths) ------------

describe('Surface3DPlugin', () => {
  it('builds an indexed mesh into the host scene with vertex colors', async () => {
    const plugin = new Surface3DPlugin();
    await plugin.init(fakeApi());
    const { scene } = injectThree(plugin);
    plugin.updateParams({});
    expect(scene.added).toHaveLength(1);
    const mesh = scene.added[0] as {
      geometry: { index: { count: number } | null; attributes: Record<string, { count: number }> };
    };
    expect(mesh.geometry.index).toBeTruthy();
    expect(mesh.geometry.attributes.position!.count).toBe(96 * 96);
    expect(mesh.geometry.attributes.color!.count).toBe(96 * 96);
    await plugin.destroy();
  });

  it('switches parameter functions and resolution', async () => {
    const plugin = new Surface3DPlugin();
    await plugin.init(fakeApi());
    const { scene } = injectThree(plugin);
    plugin.updateParams({ fn: 'gaussian', resolution: 16 });
    const mesh = scene.added[scene.added.length - 1] as {
      geometry: { attributes: Record<string, { count: number }> };
    };
    expect(mesh.geometry.attributes.position!.count).toBe(16 * 16);
    await plugin.destroy();
  });

  it('loads a grid file and reports the vertex scale', async () => {
    const reportDataScale = vi.fn();
    const api = { ...fakeApi(), reportDataScale } as unknown as PluginApi;
    const plugin = new Surface3DPlugin();
    await plugin.init(api);
    injectThree(plugin);
    await plugin.loadData(new File(['[[0,1,2],[3,4,5],[6,7,8]]'], 'h.json'));
    expect(reportDataScale).toHaveBeenCalledWith(9);
    await plugin.destroy();
  });

  it('warns (bilingual) on an unparseable file and keeps the function surface', async () => {
    const notify = vi.fn();
    const api = { ...fakeApi('zh-CN'), notify } as unknown as PluginApi;
    const plugin = new Surface3DPlugin();
    await plugin.init(api);
    injectThree(plugin);
    await plugin.loadData(new File(['not a grid'], 'bad.txt'));
    expect(notify).toHaveBeenCalledWith('warning', expect.stringContaining('高度网格'));
    await plugin.destroy();
  });

  it('exports the height grid as CSV', async () => {
    const exportFile = vi.fn();
    const api = { ...fakeApi(), exportFile } as unknown as PluginApi;
    const plugin = new Surface3DPlugin();
    await plugin.init(api);
    injectThree(plugin);
    plugin.updateParams({ exportCsv: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    const name = exportFile.mock.calls[0]![0] as string;
    expect(name).toBe('surface3d.csv');
    await plugin.destroy();
  });

  it('shows a localized 2D hint without a three container', async () => {
    const plugin = new Surface3DPlugin();
    await plugin.init(fakeApi('zh-CN'));
    await plugin.render({ canvas2d: undefined, reportDataScale: () => {} } as never);
    await plugin.destroy();
  });
});

describe('Voxel3DPlugin', () => {
  it('renders nothing before data exists', async () => {
    const plugin = new Voxel3DPlugin();
    await plugin.init(fakeApi());
    const { scene } = injectThree(plugin);
    plugin.updateParams({});
    expect(scene.added).toHaveLength(0);
    await plugin.destroy();
  });

  it('loads a field, extracts an isosurface mesh and reports scale', async () => {
    const reportDataScale = vi.fn();
    const notify = vi.fn();
    const api = { ...fakeApi(), reportDataScale, notify } as unknown as PluginApi;
    const plugin = new Voxel3DPlugin();
    await plugin.init(api);
    const { scene } = injectThree(plugin);
    await plugin.loadData(new File(['[[[2,2],[2,2]],[[2,2],[2,0]]]'], 'f.json'));
    expect(reportDataScale).toHaveBeenCalledWith(8);
    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('8'));
    expect(scene.added).toHaveLength(1);
    const mesh = scene.added[0] as { geometry: { index: { count: number } | null } };
    // 7 solid cells of a 2×2×2 block → 24 exterior faces → 48 triangles
    expect(mesh.geometry.index!.count).toBe(48 * 3);
    await plugin.destroy();
  });

  it('switches to translucent instanced voxels (one InstancedMesh)', async () => {
    const plugin = new Voxel3DPlugin();
    await plugin.init(fakeApi());
    const { scene } = injectThree(plugin);
    await plugin.loadData(new File(['[[[0,1],[2,3]],[[4,5],[6,7]]]'], 'f.json'));
    plugin.updateParams({ mode: 'voxels' });
    const obj = scene.added[scene.added.length - 1] as { count: number };
    expect(obj.count).toBe(4); // values ≥ mid level: 4,5,6,7
    await plugin.destroy();
  });

  it('rebuilds when the level slider moves and clears above the max', async () => {
    const plugin = new Voxel3DPlugin();
    await plugin.init(fakeApi());
    const { scene } = injectThree(plugin);
    await plugin.loadData(new File(['[[[0,1],[2,3]],[[4,5],[6,7]]]'], 'f.json'));
    const before = scene.added.length;
    plugin.updateParams({ level: 0.99 });
    expect(scene.removed.length).toBeGreaterThanOrEqual(1);
    expect(scene.added.length).toBe(before + 1); // only the top cell remains
    plugin.updateParams({ mode: 'voxels', level: 1 });
    // mode and level each trigger a rebuild; the last adds one instanced cell
    expect(scene.added.length).toBe(before + 3);
    plugin.updateParams({ level: 0 });
    expect(scene.added.length).toBe(before + 4); // all 8 cells
    await plugin.destroy();
  });

  it('warns on unparseable files and exports the field as CSV', async () => {
    const notify = vi.fn();
    const exportFile = vi.fn();
    const api = { ...fakeApi(), notify, exportFile } as unknown as PluginApi;
    const plugin = new Voxel3DPlugin();
    await plugin.init(api);
    injectThree(plugin);
    await plugin.loadData(new File(['nonsense'], 'bad.json'));
    expect(notify).toHaveBeenCalledWith('warning', expect.stringContaining('scalar field'));
    await plugin.loadData(new File(['[[[1,2],[3,4]]]'], 'f.json'));
    plugin.updateParams({ exportCsv: { action: 'exportCsv' } });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toBe('voxel3d.csv');
    await plugin.destroy();
  });
});

describe('PointCloud3DPlugin (FR-15 budget integration)', () => {
  it('parses without downsampling in the Node (no WebGPU) environment', async () => {
    const plugin = new PointCloud3DPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File(['0 0 1\n1 1 2\n2 2 3\n'], 'cloud.xyz'));
    const p = plugin as unknown as {
      state: { count: number; total: number; downsampled: boolean };
    };
    expect(isWebGpuAvailable()).toBe(false);
    expect(p.state.total).toBe(3);
    expect(p.state.count).toBe(3);
    expect(p.state.downsampled).toBe(false);
    await plugin.destroy();
  });

  it('downsamples an oversized cloud and notifies with the viz3d key', async () => {
    const notify = vi.fn();
    const api = { ...fakeApi(), notify } as unknown as PluginApi;
    const plugin = new PointCloud3DPlugin();
    await plugin.init(api);
    // Force the CPU fallback below the parse ceiling: temporarily shrink the
    // effective budget through the public policy by faking a tiny cloud is
    // impossible — instead assert the policy directly at scale:
    const big = new File(
      [Array.from({ length: CPU_POINT_BUDGET + 5 }, (_, i) => `${i} ${i} ${i}`).join('\n')],
      'big.xyz',
    );
    await plugin.loadData(big);
    const p = plugin as unknown as {
      state: { count: number; total: number; downsampled: boolean };
    };
    expect(p.state.total).toBe(CPU_POINT_BUDGET + 5);
    expect(p.state.count).toBe(CPU_POINT_BUDGET);
    expect(p.state.downsampled).toBe(true);
    expect(notify).toHaveBeenCalledWith('info', expect.stringContaining('downsampled'));
    await plugin.destroy();
  });

  it('exports the (possibly downsampled) points as x,y,z CSV', async () => {
    const exportFile = vi.fn();
    const api = { ...fakeApi(), exportFile } as unknown as PluginApi;
    const plugin = new PointCloud3DPlugin();
    await plugin.init(api);
    await plugin.loadData(new File(['0 0 1\n1 1 2\n'], 'c.xyz'));
    plugin.updateParams({ exportCsv: true });
    const blob = exportFile.mock.calls[0]![1] as Blob;
    const text = await blob.text();
    expect(text).toContain('x,y,z');
    expect(text).toContain('0,0,1');
    await plugin.destroy();
  });
});

// ---- i18n dictionary ---------------------------------------------------------

describe('viz3d dictionaries', () => {
  it('keeps zh/en key parity with the viz3d. prefix', () => {
    const zhKeys = Object.keys(viz3dZh).sort();
    const enKeys = Object.keys(viz3dEn).sort();
    expect(zhKeys).toEqual(enKeys);
    expect(zhKeys.every((k) => k.startsWith('viz3d.'))).toBe(true);
  });

  it('carries the downsample notice and plugin names in both locales', () => {
    expect(viz3dZh['viz3d.pointcloud.downsampled']).toContain('{shown}');
    expect(viz3dEn['viz3d.pointcloud.downsampled']).toContain('{total}');
    expect(viz3dZh['viz3d.surface.name']).toBe('3D 表面图');
    expect(viz3dEn['viz3d.voxel.name']).toBe('3D Voxel');
  });
});
