// ==========================================================================
// EM Eigensolver plugin — 3D mode-field rendering helpers
//
// Builds a displaced-surface mesh for one mode field over the host
// Three.js scene: the grid value displaces the surface height and colors
// it with the same diverging map as the Figure Studio export
// (Okabe-Ito blue = negative / white = zero / vermilion = positive), plus
// annotations at both the positive peak and the negative trough (marker
// sphere, drop line and a value/coordinate/λ label).
//
// The color ramp, extreme locators and raw buffer builders are pure and
// exported for unit tests; only `buildFieldMesh` / `buildFieldAnnotations`
// touch Three.js.
// ==========================================================================

import * as THREE from 'three';
import type { EmModeField } from './types';

/** Diverging Okabe-Ito ramp for t in [-1, 1]; clamped, NaN-safe. */
export function fieldColor(t: number): [number, number, number] {
  const NEG = [0, 114, 178];
  const POS = [213, 94, 0];
  const WHITE = [255, 255, 255];
  const a = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  // u=0 → white (zero), u=1 → full hue (|t| = 1).
  const [to, u] = a < 0 ? [NEG, -a] : [POS, a];
  return WHITE.map((f, i) => (f + (to[i]! - f) * u) / 255) as [number, number, number];
}

/**
 * three.js treats vertex-color buffers as linear working space while
 * `fieldColor` yields sRGB — feeding them raw washes mid-tones out to pastel
 * (the renderer re-applies linear→sRGB on output, brightening everything).
 * Convert per channel so the rendered hues match the SVG export.
 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
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
      colors[i * 3] = srgbToLinear(cr);
      colors[i * 3 + 1] = srgbToLinear(cg);
      colors[i * 3 + 2] = srgbToLinear(cb);
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
    roughness: 0.45,
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

/** One annotated extremum of a mode field. */
export interface FieldExtreme {
  row: number;
  col: number;
  value: number;
}

/**
 * Locate the strongest positive and negative vertices of a mode field.
 * Either side is null when the field carries no values of that sign.
 */
export function fieldExtremes(
  field: EmModeField,
): { pos: FieldExtreme | null; neg: FieldExtreme | null } {
  let pos: FieldExtreme | null = null;
  let neg: FieldExtreme | null = null;
  for (let i = 0; i < field.values.length; i += 1) {
    const v = field.values[i] ?? 0;
    const row = Math.floor(i / field.cols);
    const col = i % field.cols;
    if (v > 0 && (!pos || v > pos.value)) pos = { row, col, value: v };
    if (v < 0 && (!neg || v < neg.value)) neg = { row, col, value: v };
  }
  return { pos, neg };
}

/** The dominant extremum (largest |value|), keeping its sign. */
export function fieldPeak(field: EmModeField): FieldExtreme {
  const { pos, neg } = fieldExtremes(field);
  if (pos && (!neg || Math.abs(pos.value) >= Math.abs(neg.value))) return pos;
  if (neg) return neg;
  return { row: 0, col: 0, value: 0 };
}

/** Canvas-texture sprite with a dark backing plate; always faces camera. */
function labelSprite(text: string, extent: number): THREE.Sprite {
  const dpr = 2;
  const font = '500 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const lines = text.split('\n');
  const pad = 14;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)) + pad * 2);
  const h = lines.length * 34 + pad * 2 - 8;
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.font = font;
  g.fillStyle = 'rgba(10, 18, 32, 0.78)';
  g.beginPath();
  g.roundRect(0.5, 0.5, w - 1, h - 1, 8);
  g.fill();
  g.fillStyle = '#f8fafc';
  g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, pad, pad - 6 + i * 34));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  const sw = extent * 0.5;
  spr.scale.set(sw, (sw * canvas.height) / canvas.width, 1);
  spr.renderOrder = 10;
  return spr;
}

/**
 * Annotation group for the mode field: a white marker + drop line + floating
 * label at the positive peak ("max") and the negative trough ("min"), each
 * with its value and grid coordinates; the dominant side also carries λ.
 */
export function buildFieldAnnotations(field: EmModeField, heightScale = 0.35): THREE.Group {
  const group = new THREE.Group();
  const extent = Math.max(field.rows, field.cols);
  const { pos, neg } = fieldExtremes(field);
  const dominantPos =
    pos && (!neg || Math.abs(pos.value) >= Math.abs(neg.value));
  const items: Array<[FieldExtreme, string]> = [];
  if (pos) items.push([pos, 'max']);
  if (neg) items.push([neg, 'min']);

  for (const [e, prefix] of items) {
    const x = e.col - (field.cols - 1) / 2;
    const z = e.row - (field.rows - 1) / 2;
    const y = e.value * heightScale * extent;
    // Labels for valleys hang BELOW the vertex so they float in the empty
    // space under the surface instead of covering it; peaks keep the label
    // above. Stem direction follows the same sign rule.
    const up = e.value >= 0;

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(extent * 0.015, 0.08), 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    marker.position.set(x, y, z);
    group.add(marker);

    const tip = y + (up ? 1 : -1) * extent * 0.14;
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(x, tip, z),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    group.add(stem);

    const sign = e.value >= 0 ? '+' : '−';
    let text = `${prefix} ${sign}${Math.abs(e.value).toFixed(2)} (r${e.row},c${e.col})`;
    if ((prefix === 'max') === dominantPos) text += `\nλ=${field.eigenvalue.toExponential(2)}`;
    const spr = labelSprite(text, extent);
    spr.position.set(x, tip + (up ? 1 : -1) * extent * 0.1, z);
    group.add(spr);
  }
  return group;
}

/** Dispose every geometry/material/texture in an object tree. */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const o = obj as THREE.Mesh & { material: THREE.Material & { map?: THREE.Texture } };
    o.geometry?.dispose();
    if (o.material) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}
