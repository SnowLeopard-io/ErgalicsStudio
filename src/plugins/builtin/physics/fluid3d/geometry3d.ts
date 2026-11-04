// ==========================================================================
// fluid3d — model import + lattice voxelisation (pure, host-agnostic)
//
// Loads an arbitrary 3-D model (GLB / GLTF / STL / OBJ / PLY) into a single
// BufferGeometry, fits it into the flow domain, and rasterises it into the
// D3Q19 solid mask. The voxeliser runs one axis-aligned line per (y, z) lattice
// column (parity / point-in-mesh test) rather than testing every cell against
// every triangle, so it is O(ny*nz*triangles) instead of O(cells*triangles).
//
// Everything here depends only on `three` (+ its loader/BufferGeometryUtils
// addons); no solver or scene state.
// ==========================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Extensions the importer understands. */
export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.stl', '.obj', '.ply'] as const;

/** Model → lattice transform: `lattice = center + scale * (model - modelCenter)`. */
export interface ModelFit {
  scale: number;
  modelCenter: THREE.Vector3;
  center: THREE.Vector3;
}

/** Parse a GLTF/GLB buffer into a loaded scene. */
function parseGltf(data: ArrayBuffer | string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  // Meshopt only; DRACO would need an external decoder that this plugin must
  // not depend on.
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(
      data,
      '',
      (gltf) => resolve(gltf.scene as THREE.Group),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

/**
 * Reduce one mesh's geometry to a position-only BufferGeometry in world space.
 * Stripping other attributes keeps `mergeGeometries` happy when a group mixes
 * meshes with different attribute sets (e.g. glTF with/without UVs).
 */
function meshToPositionGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  const src = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!src || !src.attributes.position) return null;
  // Non-indexed copy: mergeGeometries requires a uniform indexed/non-indexed
  // shape, and the voxeliser only ever needs a triangle soup.
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.applyMatrix4(mesh.matrixWorld);
  const pos = g.attributes.position;
  if (!pos) {
    g.dispose();
    return null;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos.array as Float32Array, 3));
  g.dispose();
  return out;
}

/** Collapse a loaded object (Group/Scene/Mesh) into a single geometry. */
function toSingleGeometry(root: THREE.Object3D | THREE.BufferGeometry): THREE.BufferGeometry {
  if ((root as THREE.BufferGeometry).isBufferGeometry) {
    const g = root as THREE.BufferGeometry;
    if (!g.attributes.position) throw new Error('model has no position data');
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
  const obj = root as THREE.Object3D;
  obj.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh) return;
    const g = meshToPositionGeometry(mesh);
    if (g) parts.push(g);
  });
  if (parts.length === 0) throw new Error('model contained no triangles');
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (!merged || !merged.attributes.position) throw new Error('model could not be merged');
  if (!merged.attributes.normal) merged.computeVertexNormals();
  merged.computeBoundingBox();
  const count = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
  if (!(count >= 1)) throw new Error('model contained no triangles');
  return merged;
}

/**
 * Load a model file into one BufferGeometry. Throws a descriptive `Error` for
 * an unsupported extension or an empty result (no triangles).
 */
export async function loadModelGeometry(
  file: File,
): Promise<{ geometry: THREE.BufferGeometry; name: string }> {
  const name = file.name;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!(MODEL_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported model extension "${ext}" (expected ${MODEL_EXTENSIONS.join(', ')})`);
  }

  if (ext === '.glb' || ext === '.gltf') {
    const buffer = await file.arrayBuffer();
    const data: ArrayBuffer | string = ext === '.glb' ? buffer : new TextDecoder().decode(buffer);
    const scene = await parseGltf(data);
    return { geometry: toSingleGeometry(scene), name };
  }
  if (ext === '.stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    return { geometry: toSingleGeometry(geometry), name };
  }
  if (ext === '.obj') {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    const group = new OBJLoader().parse(text);
    return { geometry: toSingleGeometry(group), name };
  }
  // .ply
  const geometry = new PLYLoader().parse(await file.arrayBuffer());
  if (!geometry.index) {
    // PLY point clouds have no faces — nothing to voxelise.
    throw new Error('PLY file has no triangles');
  }
  return { geometry: toSingleGeometry(geometry), name };
}

/**
 * Fit an axis-aligned model bounding box into an `nx*ny*nz` lattice: uniform
 * scale, bbox centre at `(0.34*nx, 0.50*ny, 0.50*nz)`. Zero-extent axes are
 * floored to a tiny epsilon so the division never blows up.
 */
export function planFit(geometry: THREE.BufferGeometry, nx: number, ny: number, nz: number): ModelFit {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  const size = bb.getSize(new THREE.Vector3());
  const modelCenter = bb.getCenter(new THREE.Vector3());
  const sx = Math.max(size.x, 1e-9);
  const sy = Math.max(size.y, 1e-9);
  const sz = Math.max(size.z, 1e-9);
  const scale = Math.min((0.5 * nx) / sx, (0.74 * ny) / sy, (0.74 * nz) / sz);
  const center = new THREE.Vector3(0.34 * nx, 0.5 * ny, 0.5 * nz);
  return { scale: scale > 0 && Number.isFinite(scale) ? scale : 1, modelCenter, center };
}

/** Grow a triangle soup (9 f32 per triangle) from a geometry, index-aware. */
function extractTriangles(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) throw new Error('geometry has no position attribute');
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const nTri = Math.floor(count / 3);
  const out = new Float32Array(nTri * 9);
  for (let t = 0; t < nTri; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vi = index ? (index.getX(t * 3 + k) as number) : t * 3 + k;
      out[t * 9 + k * 3 + 0] = pos.getX(vi);
      out[t * 9 + k * 3 + 1] = pos.getY(vi);
      out[t * 9 + k * 3 + 2] = pos.getZ(vi);
    }
  }
  return out;
}

/**
 * Möller–Trumbore against the x-aligned line through `(my, mz)`.
 *
 * The ray origin is `(0, my, mz)` with direction `(1, 0, 0)`, so the returned
 * parameter `t` is exactly the intersection x-coordinate. Both signs of `t`
 * are accepted (an infinite line), which makes the caller's parity test work
 * for a mesh anywhere along x. Returns `null` on a miss or degenerate triangle.
 */
export function rayTriangleX(
  my: number,
  mz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number | null {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  // h = D × e2 with D = (1, 0, 0) → (0, −e2z, e2y).
  const hx = 0;
  const hy = -e2z;
  const hz = e2y;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det;
  const sx = 0 - ax;
  const sy = my - ay;
  const sz = mz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  // q = s × e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (1 * qx + 0 * qy + 0 * qz);
  if (v < 0 || u + v > 1) return null;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return Number.isFinite(t) ? t : null;
}

/**
 * Rasterise a geometry into an `nx*ny*nz` solid mask (1 = solid).
 *
 * For each (y, z) lattice column the column's model-space `(my, mz)` is mapped
 * and one x-aligned line is cast against every triangle, collecting the
 * crossing x-coordinates. Sorted, they delimit the entry/exit pairs of a
 * point-in-mesh parity test: cells whose x falls inside an odd interval
 * `[x0, x1], [x2, x3], …` are marked solid.
 */
export function voxelizeGeometry(
  geometry: THREE.BufferGeometry,
  fit: ModelFit,
  nx: number,
  ny: number,
  nz: number,
): Float32Array {
  const flags = new Float32Array(nx * ny * nz);
  const tri = extractTriangles(geometry);
  const nTri = tri.length / 9;
  const crossings = new Float32Array(Math.max(1, nTri));
  const { scale, center, modelCenter } = fit;
  const invScale = scale !== 0 ? 1 / scale : 0;

  for (let iz = 0; iz < nz; iz += 1) {
    const mz = modelCenter.z + (iz - center.z) * invScale;
    for (let iy = 0; iy < ny; iy += 1) {
      const my = modelCenter.y + (iy - center.y) * invScale;
      let n = 0;
      for (let t = 0; t < nTri; t += 1) {
        const o = t * 9;
        const hit = rayTriangleX(
          my,
          mz,
          tri[o]!,
          tri[o + 1]!,
          tri[o + 2]!,
          tri[o + 3]!,
          tri[o + 4]!,
          tri[o + 5]!,
          tri[o + 6]!,
          tri[o + 7]!,
          tri[o + 8]!,
        );
        if (hit !== null) crossings[n++] = hit;
      }
      if (n < 2) continue;
      const list = crossings.subarray(0, n);
      list.sort();
      for (let k = 0; k + 1 < n; k += 2) {
        const xa = center.x + scale * (list[k]! - modelCenter.x);
        const xb = center.x + scale * (list[k + 1]! - modelCenter.x);
        let i0 = Math.ceil(Math.min(xa, xb));
        let i1 = Math.floor(Math.max(xa, xb));
        if (i0 < 0) i0 = 0;
        if (i1 > nx - 1) i1 = nx - 1;
        for (let ix = i0; ix <= i1; ix += 1) {
          flags[(iz * ny + iy) * nx + ix] = 1;
        }
      }
    }
  }
  return flags;
}

/** Number of (y, z) columns that contain at least one solid cell. */
export function frontalAreaCells(flags: Float32Array, nx: number, ny: number, nz: number): number {
  let columns = 0;
  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      const rowBase = (iz * ny + iy) * nx;
      for (let ix = 0; ix < nx; ix += 1) {
        if (flags[rowBase + ix]! > 0.5) {
          columns += 1;
          break;
        }
      }
    }
  }
  return columns;
}

/** Total number of solid cells. */
export function countSolidCells(flags: Float32Array): number {
  let n = 0;
  for (let i = 0; i < flags.length; i += 1) if (flags[i]! > 0.5) n += 1;
  return n;
}

/** Map a lattice-space point to model space (inverse of the fit transform). */
export function latticePointToModel(point: THREE.Vector3, fit: ModelFit, out?: THREE.Vector3): THREE.Vector3 {
  const r = out ?? new THREE.Vector3();
  const invScale = fit.scale !== 0 ? 1 / fit.scale : 0;
  r.set(
    fit.modelCenter.x + (point.x - fit.center.x) * invScale,
    fit.modelCenter.y + (point.y - fit.center.y) * invScale,
    fit.modelCenter.z + (point.z - fit.center.z) * invScale,
  );
  return r;
}

/** Map a model-space point to the centred world coordinates of the domain. */
export function modelPointToWorld(
  point: THREE.Vector3,
  fit: ModelFit,
  nx: number,
  ny: number,
  nz: number,
  out?: THREE.Vector3,
): THREE.Vector3 {
  const r = out ?? new THREE.Vector3();
  r.set(
    fit.center.x + fit.scale * (point.x - fit.modelCenter.x) - (nx - 1) / 2,
    fit.center.y + fit.scale * (point.y - fit.modelCenter.y) - (ny - 1) / 2,
    fit.center.z + fit.scale * (point.z - fit.modelCenter.z) - (nz - 1) / 2,
  );
  return r;
}
