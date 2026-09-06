// Geography / physics plugin tests: LBM fluid (WGSL layout + CPU stepper),
// wave equation (CPU stepper + drive semantics), double pendulum (RK4 energy
// conservation + chaos divergence), and the GeoJSON parser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  FLUID_DIRECTIONS,
  FLUID_WEIGHTS,
  fluidCollideKernelWGSL,
  fluidCurlKernelWGSL,
  fluidEquilibrium,
  fluidMacroCPU,
  fluidStepCPU,
  fluidStreamKernelWGSL,
} from '@/core/wgsl';
import { packWaveParams, waveKernelWGSL, waveStepCPU } from '@/core/wgsl';
import {
  parseGeoJSON,
  numericPropertyKeys,
} from '@/plugins/builtin/geoMap';
import {
  pendulumDeriv,
  pendulumEnergy,
  pendulumStepRK4,
} from '@/plugins/builtin/doublePendulum';
import { parseMask } from '@/plugins/builtin/fluid';
import { parseGrid, parseWaveData, resampleGrid } from '@/plugins/builtin/wave';
import { parsePendulumIC } from '@/plugins/builtin/doublePendulum';

// ---- Fluid (LBM D2Q9) -------------------------------------------------------

describe('fluid WGSL kernels', () => {
  it('declares the documented collide / stream / curl bind groups', () => {
    const collide = fluidCollideKernelWGSL();
    expect(collide).toContain('@group(0) @binding(0) var<storage, read> fin');
    expect(collide).toContain('@group(0) @binding(1) var<storage, read_write> fout');
    expect(collide).toContain('@group(0) @binding(2) var<storage, read> flags');
    expect(collide).toContain('@group(0) @binding(3) var<uniform> params');
    expect(collide).toContain('@compute @workgroup_size(8, 8)');

    const stream = fluidStreamKernelWGSL();
    expect(stream).toContain('var<storage, read> fin');
    expect(stream).toContain('opp(d)');

    const curl = fluidCurlKernelWGSL();
    expect(curl).toContain('var<storage, read_write> curl');
  });

  it('has a unimodal weight set summing to 1', () => {
    expect(FLUID_DIRECTIONS).toBe(9);
    const sum = FLUID_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('fluidStepCPU', () => {
  const W = 32;
  const H = 24;

  function seeded(omega: number) {
    const f = new Float32Array(W * H * FLUID_DIRECTIONS);
    const flags = new Float32Array(W * H);
    // A small rectangular obstacle in the middle.
    for (let y = 10; y < 14; y += 1) {
      for (let x = 12; x < 16; x += 1) flags[y * W + x] = 1;
    }
    const feq = fluidEquilibrium(1, 0.1, 0);
    for (let cell = 0; cell < W * H; cell += 1) {
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) f[cell * FLUID_DIRECTIONS + d] = feq[d]!;
    }
    const fpost = new Float32Array(f.length);
    return { f, fpost, flags, omega };
  }

  it('keeps the density bounded and finite over many steps', () => {
    const { f, fpost, flags, omega } = seeded(1.9);
    for (let s = 0; s < 60; s += 1) fluidStepCPU(f, fpost, flags, W, H, omega, 0.1);
    const { rho } = fluidMacroCPU(f, W, H);
    for (let cell = 0; cell < W * H; cell += 1) {
      if (flags[cell]! > 0.5) continue; // solid cells hold zero populations
      expect(Number.isFinite(rho[cell]!)).toBe(true);
      expect(rho[cell]!).toBeGreaterThan(0.5);
      expect(rho[cell]!).toBeLessThan(1.5);
    }
  });

  it('conserves total mass in a closed sanity window (inflow ≈ outflow drift is small)', () => {
    const { f, fpost, flags } = seeded(1.8);
    // One step first so the obstacle cells drop their seeded populations
    // (solids hold zero from then on) and the baseline is physical.
    fluidStepCPU(f, fpost, flags, W, H, 1.8, 0.1);
    const total = () => f.reduce((a, b) => a + b, 0);
    const t0 = total();
    for (let s = 0; s < 40; s += 1) fluidStepCPU(f, fpost, flags, W, H, 1.8, 0.1);
    const drift = Math.abs(total() - t0) / t0;
    // Channel has inflow at x=0 and outflow at x=W-1; the equilibrium inflow
    // matches the initial state so the drift stays tiny over 40 steps.
    expect(drift).toBeLessThan(0.01);
  });

  it('keeps solid cells at zero populations', () => {
    const { f, fpost, flags } = seeded(1.9);
    for (let s = 0; s < 10; s += 1) fluidStepCPU(f, fpost, flags, W, H, 1.9, 0.1);
    for (let y = 10; y < 14; y += 1) {
      for (let x = 12; x < 16; x += 1) {
        const base = (y * W + x) * FLUID_DIRECTIONS;
        for (let d = 0; d < FLUID_DIRECTIONS; d += 1) expect(f[base + d]).toBe(0);
      }
    }
  });
});

describe('fluid parseMask', () => {
  it('accepts boolean and numeric grids, rejects ragged input', () => {
    expect(parseMask([[0, 1], [1, true]])).toEqual({ width: 2, height: 2, values: [[0, 1], [1, 1]] });
    expect(parseMask([[0, 1], [1]])).toBeNull();
    expect(parseMask('nope')).toBeNull();
    expect(parseMask({ values: [[1, 0], [0, 1]] })).toEqual({ width: 2, height: 2, values: [[1, 0], [0, 1]] });
  });
});

// ---- Wave equation -----------------------------------------------------------

describe('waveKernelWGSL', () => {
  it('declares the documented 6-binding layout', () => {
    const wgsl = waveKernelWGSL();
    expect(wgsl).toContain('@group(0) @binding(0) var<storage, read> uIn');
    expect(wgsl).toContain('@group(0) @binding(1) var<storage, read> vIn');
    expect(wgsl).toContain('@group(0) @binding(2) var<storage, read_write> uOut');
    expect(wgsl).toContain('@group(0) @binding(3) var<storage, read_write> vOut');
    expect(wgsl).toContain('@group(0) @binding(4) var<storage, read> drive');
    expect(wgsl).toContain('@group(0) @binding(5) var<uniform> params');
  });

  it('packs uniform params as 24 bytes with u32 width/height', () => {
    const buf = packWaveParams(224, 144, 0.2, 1, 3.5);
    expect(buf.byteLength).toBe(24);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(224);
    expect(dv.getUint32(4, true)).toBe(144);
    expect(dv.getFloat32(8, true)).toBeCloseTo(0.2, 6);
  });
});

describe('waveStepCPU', () => {
  const W = 48;
  const H = 32;

  it('keeps the field bounded for stable k and pins barriers to zero', () => {
    const u = new Float32Array(W * H);
    const v = new Float32Array(W * H);
    const unew = new Float32Array(W * H);
    const vnew = new Float32Array(W * H);
    const drive = new Float32Array(W * H);
    // Gaussian pulse + a barrier column.
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        u[y * W + x] = Math.exp(-((x - 12) ** 2 + (y - 16) ** 2) / 8);
        if (x === 30) drive[y * W + x] = -1;
      }
    }
    for (let s = 0; s < 200; s += 1) {
      waveStepCPU(u, v, unew, vnew, drive, W, H, 0.45, 1, s + 1);
    }
    let peak = 0;
    for (let i = 0; i < u.length; i += 1) {
      expect(Number.isFinite(u[i]!)).toBe(true);
      peak = Math.max(peak, Math.abs(u[i]!));
      if (drive[i]! < 0) expect(u[i]).toBe(0);
    }
    expect(peak).toBeLessThan(2);
  });
});

// ---- Double pendulum -----------------------------------------------------------

describe('double pendulum physics', () => {
  const params = { m1: 2, m2: 1, l1: 1, l2: 1, g: 9.81 };
  const initial: [number, number, number, number] = [(120 * Math.PI) / 180, 0, (-10 * Math.PI) / 180, 0];

  it('derivative is finite and RK4 conserves energy to <0.5% over 10 s', () => {
    const d = pendulumDeriv(initial, params);
    expect(d.every(Number.isFinite)).toBe(true);
    let s: [number, number, number, number] = [...initial];
    const dt = 0.001;
    const e0 = pendulumEnergy(s, params);
    for (let i = 0; i < 10000; i += 1) s = pendulumStepRK4(s, params, dt);
    const drift = Math.abs((pendulumEnergy(s, params) - e0) / e0);
    expect(drift).toBeLessThan(0.005);
  });

  it('a 0.001 rad ghost diverges from the primary (sensitive dependence)', () => {
    let main: [number, number, number, number] = [...initial];
    let ghost: [number, number, number, number] = [initial[0] + 0.001, initial[1], initial[2], initial[3]];
    const dt = 0.001;
    for (let i = 0; i < 12000; i += 1) {
      main = pendulumStepRK4(main, params, dt);
      ghost = pendulumStepRK4(ghost, params, dt);
    }
    const divergence = Math.abs(main[0] - ghost[0]);
    expect(divergence).toBeGreaterThan(0.1);
  });
});

// ---- Wave scenario / pendulum IC parsing ------------------------------------

describe('parseWaveData', () => {
  it('accepts { u }, { drive }, both, and a bare grid', () => {
    const grid = [[0, 1], [2, 3]];
    expect(parseWaveData({ u: grid, drive: grid })).toEqual({ u: grid, drive: grid });
    expect(parseWaveData({ drive: grid })).toEqual({ u: null, drive: grid });
    expect(parseWaveData(grid)).toEqual({ u: grid, drive: null });
    expect(parseWaveData({ u: 'nope' })).toBeNull();
    expect(parseWaveData({})).toBeNull();
    expect(parseWaveData('junk')).toBeNull();
  });

  it('rejects ragged grids', () => {
    expect(parseWaveData({ u: [[0, 1], [1]] })).toBeNull();
    expect(parseGrid([[0, 1], [1]])).toBeNull();
  });

  it('resamples grids onto the lattice by nearest neighbour', () => {
    const out = resampleGrid([[0, 1], [2, 3]], 4, 4);
    expect(out).toHaveLength(16);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(1);
    expect(out[15]).toBe(3);
  });
});

describe('parsePendulumIC', () => {
  it('converts degrees to radians and defaults velocities to 0', () => {
    const ic = parsePendulumIC({ th1: 180, th2: -90 });
    expect(ic).not.toBeNull();
    expect(ic!.th1).toBeCloseTo(Math.PI, 10);
    expect(ic!.th2).toBeCloseTo(-Math.PI / 2, 10);
    expect(ic!.w1).toBe(0);
    expect(ic!.w2).toBe(0);
    const full = parsePendulumIC({ th1: 0, th2: 0, w1: 90, w2: -90 });
    expect(full!.w1).toBeCloseTo(Math.PI / 2, 10);
  });

  it('rejects missing angles and non-object input', () => {
    expect(parsePendulumIC({ th1: 10 })).toBeNull();
    expect(parsePendulumIC('junk')).toBeNull();
    expect(parsePendulumIC([1, 2])).toBeNull();
  });
});

// ---- GeoJSON parser --------------------------------------------------------------

describe('parseGeoJSON', () => {
  it('parses a FeatureCollection with polygons, lines and points', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'A', value: 3 },
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        },
        {
          type: 'Feature',
          properties: { name: 'B', value: 9 },
          geometry: { type: 'MultiPolygon', coordinates: [[[[2, 0], [3, 0], [3, 1], [2, 0]]]] },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [5, 5] } },
        { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[6, 6], [7, 7]] } },
      ],
    });
    const features = parseGeoJSON(text);
    expect(features).toHaveLength(5);
    expect(features[0]!.polygons).toHaveLength(1);
    expect(features[1]!.polygons).toHaveLength(1);
    expect(features[2]!.lines).toHaveLength(1);
    expect(features[2]!.lines[0]).toHaveLength(2);
    expect(features[3]!.points).toHaveLength(1);
    expect(features[4]!.points).toHaveLength(2);
    const keys = numericPropertyKeys(features);
    expect(keys).toEqual(['value']);
  });

  it('handles a bare geometry and GeometryCollection, rejects junk', () => {
    const bare = parseGeoJSON(JSON.stringify({ type: 'Point', coordinates: [1, 2] }));
    expect(bare).toHaveLength(1);
    const gc = parseGeoJSON(
      JSON.stringify({
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [1, 2] }],
      }),
    );
    expect(gc).toHaveLength(1);
    expect(parseGeoJSON('not json')).toEqual([]);
    expect(parseGeoJSON('{"type":"Feature","geometry":null}')).toEqual([]);
  });

  it('parses the bundled China provinces sample (34 regions + nine-dash line)', () => {
    // Guards against regenerating the sample without the geometry type
    // wrapper (a bare coordinate array is not valid GeoJSON and renders
    // nothing — this exact bug shipped once).
    const text = readFileSync(
      fileURLToPath(new URL('../examples/data/china-provinces.geojson', import.meta.url)),
      'utf-8',
    );
    const features = parseGeoJSON(text);
    expect(features.length).toBeGreaterThanOrEqual(34);
    const withPolygons = features.filter((f) => f.polygons.length > 0);
    expect(withPolygons.length).toBeGreaterThanOrEqual(34);
    const keys = numericPropertyKeys(features);
    expect(keys).toContain('adcode');
    // Full territorial extent: mainland west to ~73°E, south to the nine-dash
    // line at ~4°N (guards against truncated / wrongly-bounded data).
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const f of withPolygons) {
      for (const ring of f.polygons) {
        for (const pt of ring) {
          minLon = Math.min(minLon, pt[0]!);
          maxLon = Math.max(maxLon, pt[0]!);
          minLat = Math.min(minLat, pt[1]!);
          maxLat = Math.max(maxLat, pt[1]!);
        }
      }
    }
    expect(minLon).toBeLessThan(74);
    expect(maxLon).toBeGreaterThan(134);
    expect(minLat).toBeLessThan(4.5);
    expect(maxLat).toBeGreaterThan(53);
  });
});
