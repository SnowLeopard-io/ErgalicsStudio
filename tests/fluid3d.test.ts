// fluid3d plugin — pure kernel / geometry / rendering-helper tests.
// The GPU dispatch path, the WebGPU device and the whole plugin class are not
// touched: each module under test is host-agnostic.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LBM3D_DIRECTIONS,
  LBM3D_EX,
  LBM3D_EY,
  LBM3D_EZ,
  LBM3D_OPP,
  LBM3D_SPONGE_STRENGTH,
  LBM3D_WEIGHTS,
  equilibrium3D,
  lbm3dFieldBytes,
  lbm3dMacroBytes,
  lbm3dScalarBytes,
  lbm3dSpongeWidth,
  macroCPU3D,
  packLbm3dParams,
  stepCPU3D,
  wakeSurvey3D,
} from '@/plugins/builtin/fluid3d/lbm3d';
import {
  countSolidCells,
  frontalAreaCells,
  planFit,
  rayTriangleX,
  voxelizeGeometry,
} from '@/plugins/builtin/fluid3d/geometry3d';
import { PRESETS, presetById, type PresetId } from '@/plugins/builtin/fluid3d/presets';
import {
  MULTI_SLICE_FRACTIONS,
  MultiSliceField,
  StreamlineTrails,
  TRAIL_LEN,
  TracerCloud,
  speedColors,
  speedRamp,
  vorticityRamp,
} from '@/plugins/builtin/fluid3d/render3d';
import { findBuiltin } from '@/plugins/builtin';

describe('fluid3d manifest', () => {
  it('is registered as a builtin plugin (resolvable by findBuiltin)', () => {
    const found = findBuiltin('example.fluid3d');
    expect(found).toBeDefined();
    expect(found?.manifest.id).toBe('example.fluid3d');
  });
});

describe('D3Q19 lattice constants', () => {
  it('the 19 weights sum to one', () => {
    expect(LBM3D_WEIGHTS).toHaveLength(LBM3D_DIRECTIONS);
    let sum = 0;
    for (const w of LBM3D_WEIGHTS) sum += w;
    expect(sum).toBeCloseTo(1, 12);
  });

  it('the opposite table is an involution with 0 as its own opposite', () => {
    expect(LBM3D_OPP).toHaveLength(LBM3D_DIRECTIONS);
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      const o = LBM3D_OPP[d]!;
      expect(LBM3D_OPP[o]!).toBe(d);
      expect(LBM3D_EX[d]! + LBM3D_EX[o]!).toBe(0);
      expect(LBM3D_EY[d]! + LBM3D_EY[o]!).toBe(0);
      expect(LBM3D_EZ[d]! + LBM3D_EZ[o]!).toBe(0);
    }
  });

  it('is a genuine 19-velocity stencil', () => {
    const set = new Set<string>();
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      set.add(`${LBM3D_EX[d]},${LBM3D_EY[d]},${LBM3D_EZ[d]}`);
    }
    expect(set.size).toBe(LBM3D_DIRECTIONS);
  });
});

describe('equilibrium3D', () => {
  it('reproduces the density and the momentum of its arguments', () => {
    const f = equilibrium3D(1.2, 0.07, -0.03, 0.01);
    let rho = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      rho += f[d]!;
      mx += f[d]! * LBM3D_EX[d]!;
      my += f[d]! * LBM3D_EY[d]!;
      mz += f[d]! * LBM3D_EZ[d]!;
    }
    expect(rho).toBeCloseTo(1.2, 5);
    expect(mx).toBeCloseTo(1.2 * 0.07, 5);
    expect(my).toBeCloseTo(1.2 * -0.03, 5);
    expect(mz).toBeCloseTo(1.2 * 0.01, 5);
  });

  it('writes into a caller-supplied 19-slot buffer', () => {
    const out = new Float32Array(LBM3D_DIRECTIONS);
    const ret = equilibrium3D(1, 0.1, 0, 0, out);
    expect(ret).toBe(out);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('packLbm3dParams (32-byte uniform block)', () => {
  it('lays out nx/ny/nz/sponge as u32 and omega/u0/strength as f32', () => {
    const buf = packLbm3dParams(88, 64, 32, 1.8, 0.1, 7, LBM3D_SPONGE_STRENGTH);
    expect(buf.byteLength).toBe(32);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(88);
    expect(dv.getUint32(4, true)).toBe(64);
    expect(dv.getUint32(8, true)).toBe(32);
    expect(dv.getUint32(12, true)).toBe(7);
    expect(dv.getFloat32(16, true)).toBeCloseTo(1.8, 5);
    expect(dv.getFloat32(20, true)).toBeCloseTo(0.1, 6);
    expect(dv.getFloat32(24, true)).toBeCloseTo(LBM3D_SPONGE_STRENGTH, 6);
    expect(dv.getFloat32(28, true)).toBe(0);
  });
});

describe('buffer-size helpers', () => {
  it('scale linearly with the cell count', () => {
    expect(lbm3dFieldBytes(10)).toBe(10 * LBM3D_DIRECTIONS * 4);
    expect(lbm3dScalarBytes(10)).toBe(40);
    expect(lbm3dMacroBytes(10)).toBe(160);
    expect(lbm3dFieldBytes(-5)).toBe(0);
  });
});

describe('lbm3dSpongeWidth', () => {
  it('is at least 4 cells', () => {
    expect(lbm3dSpongeWidth(8)).toBe(4);
    expect(lbm3dSpongeWidth(48)).toBe(4);
    expect(lbm3dSpongeWidth(120)).toBe(10);
  });
});

describe('macroCPU3D', () => {
  it('recovers rho and u from a uniform equilibrium field', () => {
    const nx = 8;
    const ny = 8;
    const nz = 8;
    const cells = nx * ny * nz;
    const f = new Float32Array(cells * LBM3D_DIRECTIONS);
    const feq = equilibrium3D(1, 0.1, 0.02, -0.01);
    for (let c = 0; c < cells; c += 1) f.set(feq, c * LBM3D_DIRECTIONS);
    const m = macroCPU3D(f, nx, ny, nz);
    for (let c = 0; c < cells; c += 1) {
      expect(m.rho[c]!).toBeCloseTo(1, 5);
      expect(m.ux[c]!).toBeCloseTo(0.1, 5);
      expect(m.uy[c]!).toBeCloseTo(0.02, 5);
      expect(m.uz[c]!).toBeCloseTo(-0.01, 5);
    }
  });
});

describe('stepCPU3D', () => {
  it('leaves an untouched interior cell of a uniform stream in equilibrium', () => {
    const nx = 16;
    const ny = 16;
    const nz = 16;
    const u0 = 0.1;
    const cells = nx * ny * nz;
    const f = new Float32Array(cells * LBM3D_DIRECTIONS);
    const fpost = new Float32Array(cells * LBM3D_DIRECTIONS);
    const flags = new Float32Array(cells);
    const feq = equilibrium3D(1, u0, 0, 0);
    for (let c = 0; c < cells; c += 1) f.set(feq, c * LBM3D_DIRECTIONS);
    // Two steps: the wall bounce-back perturbation only reaches two cells
    // inward, and x = 2 sits upstream of the sponge layer (width 4), so the
    // sampled cell is still exactly the seeded equilibrium.
    for (let s = 0; s < 2; s += 1) stepCPU3D(f, fpost, flags, nx, ny, nz, 1.8, u0);
    const m = macroCPU3D(f, nx, ny, nz);
    const cell = (8 * ny + 8) * nx + 2;
    expect(m.rho[cell]!).toBeCloseTo(1, 4);
    expect(m.ux[cell]!).toBeCloseTo(u0, 4);
    expect(m.uy[cell]!).toBeCloseTo(0, 4);
    expect(m.uz[cell]!).toBeCloseTo(0, 4);
  });

  it('never produces non-finite populations around a solid block', () => {
    const nx = 12;
    const ny = 10;
    const nz = 10;
    const cells = nx * ny * nz;
    const flags = new Float32Array(cells);
    for (let z = 4; z <= 6; z += 1) {
      for (let y = 4; y <= 6; y += 1) {
        for (let x = 4; x <= 6; x += 1) flags[(z * ny + y) * nx + x] = 1;
      }
    }
    const f = new Float32Array(cells * LBM3D_DIRECTIONS);
    const fpost = new Float32Array(cells * LBM3D_DIRECTIONS);
    const feq = equilibrium3D(1, 0.1, 0, 0);
    for (let c = 0; c < cells; c += 1) f.set(feq, c * LBM3D_DIRECTIONS);
    for (let s = 0; s < 10; s += 1) stepCPU3D(f, fpost, flags, nx, ny, nz, 1.8, 0.1);
    const m = macroCPU3D(f, nx, ny, nz);
    for (let c = 0; c < cells; c += 1) {
      if (flags[c]! > 0.5) continue;
      expect(Number.isFinite(m.rho[c]!)).toBe(true);
      expect(Number.isFinite(m.ux[c]!)).toBe(true);
      expect(m.rho[c]!).toBeGreaterThan(0);
    }
  });
});

describe('wakeSurvey3D (far-field momentum balance)', () => {
  it('reports a null survey for an undisturbed uniform stream', () => {
    const nx = 8;
    const ny = 6;
    const nz = 6;
    const cells = nx * ny * nz;
    const rho = new Float32Array(cells).fill(1);
    const ux = new Float32Array(cells).fill(0.1);
    const uy = new Float32Array(cells).fill(0);
    const s = wakeSurvey3D({ rho, ux, uy }, nx, ny, nz, 4, 0.1);
    expect(s.drag).toBeCloseTo(0, 6);
    expect(s.lift).toBeCloseTo(0, 6);
    expect(s.area).toBe(ny * nz);
  });

  it('reports positive drag for a downstream velocity deficit', () => {
    const nx = 8;
    const ny = 6;
    const nz = 6;
    const cells = nx * ny * nz;
    const rho = new Float32Array(cells).fill(1);
    const ux = new Float32Array(cells).fill(0.1);
    const uy = new Float32Array(cells).fill(0);
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) ux[(z * ny + y) * nx + 4] = 0.05;
    }
    const s = wakeSurvey3D({ rho, ux, uy }, nx, ny, nz, 4, 0.1);
    expect(s.drag).toBeGreaterThan(0);
  });
});

describe('rayTriangleX (Möller–Trumbore against one x-aligned line)', () => {
  it('returns the crossing coordinate on a hit and null on a miss', () => {
    // A triangle in the plane x = 2, spanning y,z ∈ [0,1].
    const hit = rayTriangleX(0.4, 0.4, 2, 0, 0, 2, 1, 0, 2, 0, 1);
    expect(hit).not.toBeNull();
    expect(hit!).toBeCloseTo(2, 6);
    expect(rayTriangleX(5, 5, 2, 0, 0, 2, 1, 0, 2, 0, 1)).toBeNull();
  });
});

describe('planFit + voxelizeGeometry', () => {
  it('rasterises a unit cube into a solid block', () => {
    const nx = 32;
    const ny = 32;
    const nz = 32;
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const fit = planFit(cube, nx, ny, nz);
    expect(fit.scale).toBeGreaterThan(0);
    const flags = voxelizeGeometry(cube, fit, nx, ny, nz);
    const solid = countSolidCells(flags);
    expect(solid).toBeGreaterThan(1500);
    expect(solid).toBeLessThan(6000);
    expect(frontalAreaCells(flags, nx, ny, nz)).toBeGreaterThan(150);
    // The block spans lattice x ≈ [3, 18]. Nothing is marked upstream of it,
    // and the plane x = 10 is entirely inside it.
    let upstream = 0;
    let plane10 = 0;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        const row = (iz * ny + iy) * nx;
        upstream += flags[row + 1]!;
        plane10 += flags[row + 10]!;
      }
    }
    expect(upstream).toBe(0);
    expect(plane10).toBeGreaterThan(100);
    cube.dispose();
  });

  it('voxelises a sphere (non-indexed IcosahedronGeometry) as well', () => {
    const nx = 24;
    const ny = 24;
    const nz = 24;
    const g = presetById('sphere').build();
    const fit = planFit(g, nx, ny, nz);
    const flags = voxelizeGeometry(g, fit, nx, ny, nz);
    expect(countSolidCells(flags)).toBeGreaterThan(100);
    g.dispose();
  });
});

describe('presets', () => {
  it('exposes three primitives, each building a non-empty geometry', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['sphere', 'cube', 'cylinder']);
    for (const p of PRESETS) {
      const g = p.build();
      const pos = g.attributes.position;
      expect(pos).toBeDefined();
      expect(pos!.count).toBeGreaterThanOrEqual(3);
      g.dispose();
    }
  });

  it('presetById falls back to the first preset for an unknown id', () => {
    expect(presetById('cylinder').id).toBe('cylinder');
    expect(presetById('nope' as PresetId).id).toBe('sphere');
  });
});

describe('colour ramps', () => {
  it('speedRamp clamps its argument into [0,1]', () => {
    expect(speedRamp(-1)).toEqual(speedRamp(0));
    expect(speedRamp(2)).toEqual(speedRamp(1));
    const mid = speedRamp(0.5);
    expect(mid[0]).toBeCloseTo(0.902, 10);
    expect(mid[1]).toBeCloseTo(0.471, 10);
    expect(mid[2]).toBeCloseTo(0.157, 10);
  });

  it('vorticityRamp is dark at zero and signed in the tails', () => {
    expect(vorticityRamp(0)).toEqual([0.063, 0.078, 0.11]);
    expect(vorticityRamp(1)[1]).toBeCloseTo(vorticityRamp(-1)[1]!, 6);
    expect(vorticityRamp(1)[0]).toBeGreaterThan(vorticityRamp(1)[2]!);
    expect(vorticityRamp(-1)[2]).toBeGreaterThan(vorticityRamp(-1)[0]!);
  });
});

describe('speedColors', () => {
  it('maps per-point speeds through the speed ramp, normalised by u0', () => {
    const out = new Float32Array(9);
    speedColors(new Float32Array([0, 0.5, 1]), 3, 1, out);
    expect(out[0]).toBeCloseTo(0.118, 6);
    expect(out[3]).toBeCloseTo(0.902, 6);
    expect(out[6]).toBeCloseTo(1.0, 6);
    expect(out[8]).toBeCloseTo(0.176, 6);
  });

  it('stays finite when u0 is zero', () => {
    const out = new Float32Array(3);
    speedColors(new Float32Array([0]), 1, 0, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('MultiSliceField', () => {
  it('stacks one plane per slice fraction', () => {
    const field = new MultiSliceField(8, 6);
    expect(field.group.children).toHaveLength(MULTI_SLICE_FRACTIONS.length);
    field.dispose();
  });
});

describe('TracerCloud', () => {
  it('reports its capacity and clamps the draw range to it', () => {
    const cloud = new TracerCloud(10);
    expect(cloud.size).toBe(10);
    cloud.update(new Float32Array(30).fill(1), new Float32Array(30).fill(0.5), 100);
    const geometry = cloud.points.geometry as THREE.BufferGeometry;
    expect(geometry.drawRange.count).toBe(10);
    cloud.dispose();
  });
});

describe('StreamlineTrails', () => {
  it('preallocates seeds*(TRAIL_LEN-1)*2 vertices', () => {
    const trails = new StreamlineTrails(20);
    expect(trails.vertexCapacity).toBe(20 * (TRAIL_LEN - 1) * 2);
    trails.dispose();
  });

  it('emits vertex pairs after enough steps in a still medium', () => {
    const nx = 16;
    const ny = 12;
    const nz = 12;
    const trails = new StreamlineTrails(8);
    const flags = new Float32Array(nx * ny * nz);
    const still = (): [number, number, number] => [0, 0, 0];
    for (let i = 0; i < 5; i += 1) {
      trails.step(still, nx, ny, nz, flags, 0);
      trails.update();
    }
    // Each seed has accumulated exactly 5 points → 4 segments → 8 vertices.
    const geometry = trails.lines.geometry as THREE.BufferGeometry;
    expect(geometry.drawRange.count).toBe(8 * 4 * 2);
    trails.dispose();
  });
});
