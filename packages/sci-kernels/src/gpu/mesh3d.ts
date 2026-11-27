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

type Point3 = [number, number, number];

/**
 * Smooth isosurface via marching tetrahedra: each cube cell is split into
 * six tets sharing the 0-6 body diagonal; the 16 sign cases per tet emit
 * interpolated edge vertices, so the surface follows the field rather than
 * snapping to voxel faces. Triangle winding points away from the tet's
 * inside-corner centroid (outward), independent of the tet decomposition's
 * handedness. Coordinates use the same lattice space as `voxelIsosurface`
 * (sample i sits at integer position i).
 */
export function marchingTets(
  field: VoxelField,
  level: number,
): { positions: Float32Array; vertexValues: Float32Array } {
  const { nx, ny, nz, values } = field;
  // Output is non-indexed with one vertex triple per triangle (shared
  // vertices duplicated), mirroring `voxelIsosurface` so consumers can treat
  // every 9 consecutive floats as one triangle.
  const pts: number[] = [];
  const vals: number[] = [];

  const sample = (x: number, y: number, z: number): number => {
    const xi = Math.min(Math.max(x, 0), nx - 1);
    const yi = Math.min(Math.max(y, 0), ny - 1);
    const zi = Math.min(Math.max(z, 0), nz - 1);
    return values[(xi * ny + yi) * nz + zi] ?? 0;
  };

  // Six tets per cube sharing the 0-6 body diagonal. Corner bit encoding:
  // dx in bits 2, dy in bits 1, dz in bits 0. The four entries of each tet
  // are [diagonal start, diagonal end, ring a, ring b] where (a, b) is one
  // edge of the hexagonal ring around the diagonal — this exact ring order
  // makes opposite faces of the cube split along the same global diagonal,
  // so neighbouring cubes agree on shared faces (no cracks, no parity
  // alternation needed).
  const DIAG_A = 0b000; // (0,0,0)
  const DIAG_B = 0b111; // (1,1,1)
  const TETS: ReadonlyArray<readonly [number, number, number, number]> = [
    [DIAG_A, DIAG_B, 0b100, 0b101], // ring edge (1,0,0)-(1,0,1)
    [DIAG_A, DIAG_B, 0b101, 0b001], // (1,0,1)-(0,0,1)
    [DIAG_A, DIAG_B, 0b001, 0b011], // (0,0,1)-(0,1,1)
    [DIAG_A, DIAG_B, 0b011, 0b010], // (0,1,1)-(0,1,0)
    [DIAG_A, DIAG_B, 0b010, 0b110], // (0,1,0)-(1,1,0)
    [DIAG_A, DIAG_B, 0b110, 0b100], // (1,1,0)-(1,0,0)
  ];

  for (let x = 0; x < nx - 1; x += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let z = 0; z < nz - 1; z += 1) {
        for (const tet of TETS) {
          const cx = [x + ((tet[0]! >> 2) & 1), x + ((tet[1]! >> 2) & 1), x + ((tet[2]! >> 2) & 1), x + ((tet[3]! >> 2) & 1)];
          const cy = [y + ((tet[0]! >> 1) & 1), y + ((tet[1]! >> 1) & 1), y + ((tet[2]! >> 1) & 1), y + ((tet[3]! >> 1) & 1)];
          const cz = [z + (tet[0]! & 1), z + (tet[1]! & 1), z + (tet[2]! & 1), z + (tet[3]! & 1)];
          const cv = [0, 1, 2, 3].map((i) => sample(cx[i]!, cy[i]!, cz[i]!));
          const inside = cv.map((v) => v >= level);
          const nInside = inside.filter(Boolean).length;
          if (nInside === 0 || nInside === 4) continue;

          /** Crossing point on tet edge (a, b). The interpolation direction
           *  is canonicalized to the lexicographically smaller lattice node,
           *  so every tet touching a shared lattice edge computes a
           *  bitwise-identical crossing point (watertight patching). */
          const crossPoint = (a: number, b: number): [number, number, number] => {
            let p = a;
            let q = b;
            if (cx[p]! > cx[q]! || (cx[p]! === cx[q]! && (cy[p]! > cy[q]! || (cy[p]! === cy[q]! && cz[p]! > cz[q]!)))) {
              [p, q] = [q, p];
            }
            const t = (level - cv[p]!) / (cv[q]! - cv[p]!);
            return [cx[p]! + t * (cx[q]! - cx[p]!), cy[p]! + t * (cy[q]! - cy[p]!), cz[p]! + t * (cz[q]! - cz[p]!)];
          };

          // Collect the (up to four) edge crossings in tet-edge order.
          const crossing: Array<[number, number]> = [];
          for (let a = 0; a < 4; a += 1) {
            for (let b = a + 1; b < 4; b += 1) {
              if (inside[a] !== inside[b]) crossing.push([a, b]);
            }
          }

          // Triangle vertex triples for this tet (points not yet emitted).
          let tris: Array<[Point3, Point3, Point3]>;
          if (nInside === 1 || nInside === 3) {
            tris = [[
              crossPoint(crossing[0]![0]!, crossing[0]![1]!),
              crossPoint(crossing[1]![0]!, crossing[1]![1]!),
              crossPoint(crossing[2]![0]!, crossing[2]![1]!),
            ]];
          } else {
            // Planar quad (the isosurface plane cuts the tet in a convex
            // quad). The raw edge list is not in cycle order, so reorder the
            // four crossings into their surface cycle first, then
            // triangulate along the p0-p2 diagonal: (p0,p1,p2) + (p0,p2,p3).
            const cycle = [crossing[0]!, crossing[1]!, crossing[2]!, crossing[3]!];
            const shares = (p: [number, number], q: [number, number]): boolean =>
              p[0] === q[0] || p[0] === q[1] || p[1] === q[0] || p[1] === q[1];
            const [c0] = cycle;
            const rest = [cycle[1]!, cycle[2]!, cycle[3]!];
            const n1 = rest.find((e) => shares(c0!, e))!;
            const n2 = rest.find((e) => e !== c0 && e !== n1 && shares(n1, e))!;
            const n3 = rest.find((e) => e !== n1 && e !== n2)!;
            const ring = [c0!, n1, n2, n3];
            const p = ring.map(([a, b]) => crossPoint(a, b));
            tris = [
              [p[0]!, p[1]!, p[2]!],
              [p[0]!, p[2]!, p[3]!],
            ];
          }

          // Interior reference point: mean of the tet corners on the inside
          // (value ≥ level). Normals must point away from the solid interior,
          // which is exact and local — unlike gradient estimation it cannot
          // misfire on thin shells or plateau regions.
          let icx = 0, icy = 0, icz = 0;
          for (let i = 0; i < 4; i += 1) {
            if (inside[i]) {
              icx += cx[i]!;
              icy += cy[i]!;
              icz += cz[i]!;
            }
          }
          icx /= nInside; icy /= nInside; icz /= nInside;

          for (const tri of tris) {
            const [a, b, c] = tri;
            const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
            const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
            const nxv = uy * vz - uz * vy;
            const nyv = uz * vx - ux * vz;
            const nzv = ux * vy - uy * vx;
            const rx = (a[0]! + b[0]! + c[0]!) / 3 - icx;
            const ry = (a[1]! + b[1]! + c[1]!) / 3 - icy;
            const rz = (a[2]! + b[2]! + c[2]!) / 3 - icz;
            const ordered = nxv * rx + nyv * ry + nzv * rz < 0 ? [c, b, a] : [a, b, c];
            for (const pt of ordered) {
              pts.push(pt[0]!, pt[1]!, pt[2]!);
              vals.push(level);
            }
          }
        }
      }
    }
  }
  return { positions: new Float32Array(pts), vertexValues: new Float32Array(vals) };
}

/** Trilinear field sample at lattice-space coordinates (clamped at borders). */
export function sampleFieldTrilinear(field: VoxelField, x: number, y: number, z: number): number {
  const { nx, ny, nz, values } = field;
  const at = (xi: number, yi: number, zi: number): number =>
    values[
      (Math.min(Math.max(xi, 0), nx - 1) * ny + Math.min(Math.max(yi, 0), ny - 1)) * nz +
      Math.min(Math.max(zi, 0), nz - 1)
    ] ?? 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
  const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
  const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
  const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}
