// ==========================================================================
// EM Eigensolver plugin — 3D mode-field rendering helpers
//
// Builds a displaced-surface mesh for one mode field over the host
// Three.js scene: the grid value displaces the surface height and colors
// it with a diverging map (teal = negative / dark = zero / amber = positive;
// magnitude fields only occupy the positive half).
//
// The color ramp and the raw buffer builders are pure and exported for
// unit tests; only `buildFieldMesh` touches Three.js.
// ==========================================================================

import * as THREE from 'three';
import type { EmModeField } from './types';

/** Diverging teal↔amber ramp for t in [-1, 1]; clamped, NaN-safe. */
export function fieldColor(t: number): [number, number, number] {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(-1, t)) : 0;
  // Two linear arms around 0 keep the zero level visually dark and quiet.
  if (x >= 0) {
    // dark slate (#1e293b) → amber (#fbbf24), brightening near the peak
    const s = x;
    const lift = s > 0.85 ? (s - 0.85) / 0.15 : 0;
    const r = Math.min(0.12 + s * 0.86 + lift * 0.02, 1);
    const g = Math.min(0.16 + s * 0.59 + lift * 0.2, 1);
    const b = Math.max(0.23 - s * 0.08 + lift * 0.25, 0.1);
    return [r, g, b];
  }
  // dark slate → teal (#2dd4bf)
  const s = -x;
  const r = Math.max(0.12 - 0.12 * s, 0);
  const g = 0.16 + s * 0.67;
  const b = 0.23 + s * 0.52;
  return [r, g, b];
}

/**
 * Raw surface geometry data for one mode field: a rows×cols grid over the
 * XZ plane (x → cols, z → rows), height along Y scaled to `heightScale`
 * times the grid extent. Positions/colors are interleaved-free flat arrays
 * matching THREE.BufferAttribute expectations.
 */
export function surfaceBuffers(
  field: EmModeField,
  heightScale = 0.35,
): { positions: Float32Array; colors: Float32Array; indices: Uint32Array; sizeX: number; sizeZ: number } {
  const { rows, cols, values } = field;
  const count = rows * cols;
  const sizeX = cols;
  const sizeZ = rows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      const v = values[i] ?? 0;
      positions[i * 3] = c - (cols - 1) / 2;
      positions[i * 3 + 1] = v * heightScale * Math.max(rows, cols);
      positions[i * 3 + 2] = r - (rows - 1) / 2;
      const [cr, cg, cb] = fieldColor(v);
      colors[i * 3] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    }
  }
  // Two triangles per quad; consistent winding so DoubleSide stays cheap.
  const quads = (rows - 1) * (cols - 1);
  const indices = new Uint32Array(quads * 6);
  let p = 0;
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices[p++] = a; indices[p++] = d; indices[p++] = b;
      indices[p++] = b; indices[p++] = d; indices[p++] = e;
    }
  }
  return { positions, colors, indices, sizeX, sizeZ };
}

/** Build (or rebuild) a THREE mesh for the mode field, centred at origin. */
export function buildFieldMesh(field: EmModeField, heightScale = 0.35): THREE.Mesh {
  const { positions, colors, indices } = surfaceBuffers(field, heightScale);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  // Vertex colors carry the field; a little lambert shading gives the
  // surface depth without needing per-fragment fanciness.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.65,
    metalness: 0.05,
  });
  return new THREE.Mesh(geometry, material);
}

/** Frame the camera so the whole field surface fits the view. */
export function fitFieldCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  rows: number,
  cols: number,
): void {
  const extent = Math.max(rows, cols);
  const dist = extent * 2.1 + 2;
  controls.target.set(0, 0, 0);
  camera.position.set(dist * 0.55, dist * 0.75, dist * 0.75);
  camera.near = Math.max(dist / 200, 0.01);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  controls.update();
}
