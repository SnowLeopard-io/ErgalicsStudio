// ==========================================================================
// Engineering volume sampling — bridge unstructured tet meshes to the
// project's regular-grid volume tools (mesh3d.marchingTets / isosurfaces).
//
// A 3-D result field lives on tetrahedral nodes; the volume visualiser works
// on a regular VoxelField. This module samples the nearest containing tet at
// each voxel centre (barycentric interpolation), producing a VoxelField that
// any of the existing isosurface / slice renderers can consume.
// ==========================================================================

import type { VoxelField } from '@ergalics/sci-kernels/gpu/mesh3d';
import type { EngineeringField, EngineeringMesh } from './types';

/** Barycentric coordinates of point p inside tetra (a,b,c,d), or null. */
function barycentric(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): [number, number, number, number] | null {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const vp = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const det =
    v0[0]! * (v1[1]! * v2[2]! - v1[2]! * v2[1]!) -
    v0[1]! * (v1[0]! * v2[2]! - v1[2]! * v2[0]!) +
    v0[2]! * (v1[0]! * v2[1]! - v1[1]! * v2[0]!);
  if (Math.abs(det) < 1e-14) return null;
  const solveDet = (col: number): number => {
    const m00 = col === 0 ? vp[0]! : v0[0]!;
    const m01 = col === 1 ? vp[0]! : v1[0]!;
    const m02 = col === 2 ? vp[0]! : v2[0]!;
    const m10 = col === 0 ? vp[1]! : v0[1]!;
    const m11 = col === 1 ? vp[1]! : v1[1]!;
    const m12 = col === 2 ? vp[1]! : v2[1]!;
    const m20 = col === 0 ? vp[2]! : v0[2]!;
    const m21 = col === 1 ? vp[2]! : v1[2]!;
    const m22 = col === 2 ? vp[2]! : v2[2]!;
    return (
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20)
    ) / det;
  };
  const v = [solveDet(0), solveDet(1), solveDet(2)];
  return [1 - v[0]! - v[1]! - v[2]!, v[0]!, v[1]!, v[2]!];
}

export interface VolumeSampleOptions {
  /** Voxels per longest bounding-box axis (default 48). */
  resolution?: number;
  /** Scalar component to sample from a vector field (default 0 = magnitude). */
  component?: number;
}

/** Sample a nodal tetrahedral field onto a regular voxel grid. */
export function sampleTetField(
  mesh: EngineeringMesh,
  field: EngineeringField,
  options: VolumeSampleOptions = {},
): VoxelField {
  const res = Math.max(4, Math.min(128, Math.floor(options.resolution ?? 48)));
  const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bounds;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const nx = Math.max(2, Math.round(((maxX - minX) / span) * res) || res);
  const ny = Math.max(2, Math.round(((maxY - minY) / span) * res) || res);
  const nz = Math.max(2, Math.round(((maxZ - minZ) / span) * res) || res);

  // Precompute tetrahedra with BOTH their corner coordinates and node indices
  // so sampling never does an O(nodes) coordinate search per voxel.
  const tets = mesh.elements
    .filter((e) => e.type === 'tet4' && e.nodes.length === 4)
    .map((e) => ({
      indices: e.nodes,
      corners: e.nodes.map((i) => {
        const node = mesh.nodes[i]!;
        return [node.x, node.y, node.z] as [number, number, number];
      }),
    }));

  const scalarAt = (nodeIndex: number): number => {
    const c = field.components;
    if (c <= 1) return field.values[nodeIndex] ?? 0;
    if (options.component !== undefined) return field.values[nodeIndex * c + options.component] ?? 0;
    let sum = 0;
    for (let k = 0; k < c; k += 1) {
      const v = field.values[nodeIndex * c + k] ?? 0;
      sum += v * v;
    }
    return Math.sqrt(sum);
  };

  const values = new Float32Array(nx * ny * nz);
  for (let iz = 0; iz < nz; iz += 1) {
    const z = minZ + ((iz + 0.5) / nz) * (maxZ - minZ || span);
    for (let iy = 0; iy < ny; iy += 1) {
      const y = minY + ((iy + 0.5) / ny) * (maxY - minY || span);
      for (let ix = 0; ix < nx; ix += 1) {
        const x = minX + ((ix + 0.5) / nx) * (maxX - minX || span);
        const p: [number, number, number] = [x, y, z];
        let value = 0;
        let found = false;
        for (const tet of tets) {
          const w = barycentric(p, tet.corners[0]!, tet.corners[1]!, tet.corners[2]!, tet.corners[3]!);
          if (!w || w.some((v) => v < -1e-6)) continue;
          const idx = tet.indices;
          value =
            scalarAt(idx[0]!) * w[0]! + scalarAt(idx[1]!) * w[1]! +
            scalarAt(idx[2]!) * w[2]! + scalarAt(idx[3]!) * w[3]!;
          found = true;
          break;
        }
        values[(ix * ny + iy) * nz + iz] = found ? value : Number.NaN;
      }
    }
  }
  return { nx, ny, nz, values };
}
