// ==========================================================================
// 3-D mesh data pipelines (spec FR-15): pure functions shared by the
// surface and voxel plugins.
//
//   - heightFieldToMesh: regular height grid z = f(x, y) → indexed
//     triangle mesh (two triangles per cell, one vertex per grid node).
//   - voxelIsosurface: scalar field → blocky isosurface. This is the
//     documented *slice/face approximation* of marching cubes: every axis-
//     aligned voxel face that separates an inside cell (value ≥ level) from
//     an outside cell (or the field border) becomes two triangles. It is
//     watertight and manifold by construction and far cheaper to verify
//     than the full 256-case MC table.
//   - voxelSolidCells: linear indices of cells inside the level, used by
//     the translucent-voxel (instanced cube) mode.
//
// No React / DOM / three imports — everything here is unit-testable in the
// Node environment.
// ==========================================================================

/** Indexed triangle set: xyz-interleaved positions, 3 indices per triangle,
 *  one scalar per vertex (the source height / field value, for coloring). */
export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  values: Float32Array;
}

/** Regular 3-D scalar field, row-major with z fastest: index = (x*ny + y)*nz + z. */
export interface VoxelField {
  nx: number;
  ny: number;
  nz: number;
  values: Float32Array;
}

export interface HeightFieldOptions {
  /** Grid spacing in world units (default 1). */
  cellSize?: number;
  /** Center the grid on the origin (default true). */
  center?: boolean;
  /** Vertical multiplier applied to every height (default 1). */
  heightScale?: number;
}

/**
 * Triangulate a rectangular height grid (rows × cols of z values).
 * Returns null for ragged or degenerate (< 2 × 2) input. Non-finite cells
 * are treated as height 0 so a stray NaN never poisons the buffer.
 */
export function heightFieldToMesh(
  grid: number[][],
  opts: HeightFieldOptions = {},
): TriangleMesh | null {
  const rows = grid.length;
  if (rows < 2) return null;
  const cols = grid[0]!.length;
  if (cols < 2) return null;
  for (const row of grid) {
    if (row.length !== cols) return null;
  }

  const cell = opts.cellSize ?? 1;
  const scale = opts.heightScale ?? 1;
  const center = opts.center ?? true;
  const ox = center ? ((cols - 1) * cell) / 2 : 0;
  const oy = center ? ((rows - 1) * cell) / 2 : 0;

  const vertexCount = rows * cols;
  const positions = new Float32Array(vertexCount * 3);
  const values = new Float32Array(vertexCount);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const raw = grid[r]![c]!;
      const z = Number.isFinite(raw) ? raw * scale : 0;
      const i = r * cols + c;
      positions[i * 3] = c * cell - ox;
      positions[i * 3 + 1] = r * cell - oy;
      positions[i * 3 + 2] = z;
      values[i] = z;
    }
  }

  const triangles = (rows - 1) * (cols - 1) * 2;
  const indices = new Uint32Array(triangles * 3);
  let o = 0;
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const v00 = r * cols + c;
      const v10 = v00 + 1;
      const v01 = v00 + cols;
      const v11 = v01 + 1;
      indices[o++] = v00;
      indices[o++] = v10;
      indices[o++] = v11;
      indices[o++] = v00;
      indices[o++] = v11;
      indices[o++] = v01;
    }
  }
  return { positions, indices, values };
}

// ---- voxel isosurface (blocky face-extraction approximation) --------------

// The four corners of each voxel face, in (dx, dy, dz) offsets from the cell
// origin, ordered so every face winds outward (consistent orientation makes
// the extracted surface watertight: shared edges cancel in opposite
// directions, which the manifold test asserts).
const FACE_CORNERS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], // +x
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -x
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // +y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +z
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], // -z
];

const FACE_NEIGHBOR: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cellInside(field: VoxelField, level: number, x: number, y: number, z: number): boolean {
  if (x < 0 || y < 0 || z < 0 || x >= field.nx || y >= field.ny || z >= field.nz) return false;
  return (field.values[(x * field.ny + y) * field.nz + z] ?? 0) >= level;
}

/** Linear indices of every cell whose value is ≥ `level`. */
export function voxelSolidCells(field: VoxelField, level: number): Uint32Array {
  const { nx, ny, nz, values } = field;
  const out: number[] = [];
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        if ((values[(x * ny + y) * nz + z] ?? 0) >= level) out.push((x * ny + y) * nz + z);
      }
    }
  }
  return Uint32Array.from(out);
}

/**
 * Blocky isosurface of a voxel field at `level` (see file header for the
 * approximation note). Four vertices per exposed face (duplicated corners
 * keep per-face flat normals available to the renderer), two triangles each.
 */
export function voxelIsosurface(field: VoxelField, level: number): TriangleMesh {
  const { nx, ny, nz, values } = field;
  // Pass 1: count exposed faces so the buffers can be sized exactly.
  let faces = 0;
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        if (!cellInside(field, level, x, y, z)) continue;
        for (let f = 0; f < 6; f += 1) {
          const d = FACE_NEIGHBOR[f]!;
          if (!cellInside(field, level, x + d[0], y + d[1], z + d[2])) faces += 1;
        }
      }
    }
  }

  const positions = new Float32Array(faces * 4 * 3);
  const valuesOut = new Float32Array(faces * 4);
  const indices = new Uint32Array(faces * 6);
  let vertex = 0;
  let io = 0;
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        const idx = (x * ny + y) * nz + z;
        const v = values[idx] ?? 0;
        if (v < level) continue;
        for (let f = 0; f < 6; f += 1) {
          const d = FACE_NEIGHBOR[f]!;
          if (cellInside(field, level, x + d[0], y + d[1], z + d[2])) continue;
          const corners = FACE_CORNERS[f]!;
          const base = vertex;
          for (let k = 0; k < 4; k += 1) {
            const c = corners[k]!;
            positions[vertex * 3] = x + c[0];
            positions[vertex * 3 + 1] = y + c[1];
            positions[vertex * 3 + 2] = z + c[2];
            valuesOut[vertex] = v;
            vertex += 1;
          }
          indices[io++] = base;
          indices[io++] = base + 1;
          indices[io++] = base + 2;
          indices[io++] = base;
          indices[io++] = base + 2;
          indices[io++] = base + 3;
        }
      }
    }
  }
  return { positions, indices, values: valuesOut };
}
