// ==========================================================================
// Engineering → Three.js scene bridge (CAD viewing)
//
// Pure conversion helpers shared by the CAD viewer. They take the neutral
// engineering model (geometry entities / mesh / field) and produce Three.js
// objects WITHOUT owning a renderer or a camera — the host React component
// owns those. Keeping this pure makes it testable and reusable by plugins.
// ==========================================================================

import * as THREE from 'three';
import { marchingTets, type VoxelField } from '@ergalics/sci-kernels/gpu/mesh3d';
import type {
  EngineeringField,
  EngineeringGeometry,
  EngineeringMesh,
  GeometryEntity,
} from './types';

/** Colours used for CAD entities (light theme friendly, high contrast). */
export const CAD_COLOURS = {
  line: 0x60a5fa,
  circle: 0x34d399,
  arc: 0xfbbf24,
  point: 0xf472b6,
  meshEdge: 0x1e293b,
  grid: 0x334155,
} as const;

function pushPoint(target: number[], p: readonly [number, number, number]): void {
  target.push(p[0], p[1], p[2]);
}

/** Tessellate a single geometry entity into line-segment vertex pairs. */
export function entitySegments(entity: GeometryEntity): number[] {
  const points = entity.points;
  const out: number[] = [];
  if (points.length === 0) return out;
  if (entity.kind === 'point') {
    // A point is drawn as a tiny cross so it is visible in wireframe mode.
    const [x, y, z] = points[0]!;
    const r = 0.02;
    out.push(x - r, y, z, x + r, y, z);
    out.push(x, y - r, z, x, y + r, z);
    out.push(x, y, z - r, x, y, z + r);
    return out;
  }
  for (let i = 0; i + 1 < points.length; i += 1) {
    pushPoint(out, points[i]!);
    pushPoint(out, points[i + 1]!);
  }
  if (entity.closed && points.length > 2) {
    pushPoint(out, points[points.length - 1]!);
    pushPoint(out, points[0]!);
  }
  return out;
}

function linesGeometry(segments: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  return geometry;
}

/**
 * Build a wireframe group from a lightweight DXF/STEP geometry model.
 * Each layer is a separate child so the viewer can toggle visibility by name.
 */
export function geometryToScene(
  geometry: EngineeringGeometry,
  options: { layers?: readonly string[]; colourByKind?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'engineering-geometry';
  const allowed = options.layers ? new Set(options.layers) : null;
  const byLayer = new Map<string, Map<string, number[]>>();
  for (const entity of geometry.entities) {
    if (allowed && entity.layer && !allowed.has(entity.layer)) continue;
    const layer = entity.layer ?? '';
    let kinds = byLayer.get(layer);
    if (!kinds) {
      kinds = new Map();
      byLayer.set(layer, kinds);
    }
    const bucket = options.colourByKind === false ? 'line' : entity.kind;
    const segments = kinds.get(bucket) ?? [];
    segments.push(...entitySegments(entity));
    kinds.set(bucket, segments);
  }
  for (const [layer, kinds] of byLayer) {
    const layerGroup = new THREE.Group();
    layerGroup.name = `layer:${layer}`;
    for (const [kind, segments] of kinds) {
      if (segments.length === 0) continue;
      const colour =
        kind === 'circle' ? CAD_COLOURS.circle
        : kind === 'arc' ? CAD_COLOURS.arc
        : kind === 'point' ? CAD_COLOURS.point
        : CAD_COLOURS.line;
      const material = new THREE.LineBasicMaterial({ color: colour });
      const line = new THREE.LineSegments(linesGeometry(segments), material);
      line.name = `entities:${kind}`;
      layerGroup.add(line);
    }
    group.add(layerGroup);
  }
  return group;
}

/** Interpolate a blue→cyan→yellow→red ramp for a scalar in [0,1]. */
export function fieldColour(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  const stops = [
    { p: 0, c: new THREE.Color(0x2563eb) },
    { p: 0.4, c: new THREE.Color(0x06b6d4) },
    { p: 0.75, c: new THREE.Color(0xfacc15) },
    { p: 1, c: new THREE.Color(0xdc2626) },
  ];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (clamped <= b.p) {
      const k = b.p === a.p ? 0 : (clamped - a.p) / (b.p - a.p);
      return a.c.clone().lerp(b.c, k);
    }
  }
  return stops[stops.length - 1]!.c.clone();
}

/** Scalar display value for an element: magnitude for vector fields. */
function entryMagnitude(field: EngineeringField, entry: number): number {
  const c = field.components;
  if (c <= 1) return field.values[entry] ?? 0;
  let sum = 0;
  for (let k = 0; k < c; k += 1) {
    const v = field.values[entry * c + k] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

function scalarForElement(
  elementIndex: number,
  mesh: EngineeringMesh,
  field: EngineeringField | null,
): number {
  if (!field) return 0;
  const element = mesh.elements[elementIndex];
  if (!element) return 0;
  if (field.location === 'element') return entryMagnitude(field, elementIndex);
  let sum = 0;
  let count = 0;
  for (const node of element.nodes) {
    const value = entryMagnitude(field, node);
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Build a shaded triangular mesh as a non-indexed BufferGeometry. */
export function meshToScene(
  mesh: EngineeringMesh,
  field: EngineeringField | null = null,
  options: { wireframe?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'engineering-mesh';
  const positions: number[] = [];
  const colours: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  if (field) {
    const entries = field.location === 'node' ? mesh.nodes.length : mesh.elements.length;
    for (let entry = 0; entry < entries; entry += 1) {
      const value = entryMagnitude(field, entry);
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const span = field ? max - min || 1 : 1;
  for (let index = 0; index < mesh.elements.length; index += 1) {
    const element = mesh.elements[index]!;
    if (element.nodes.length < 3) continue;
    const colour = field ? fieldColour((scalarForElement(index, mesh, field) - min) / span) : null;
    for (let i = 1; i + 1 < element.nodes.length; i += 1) {
      const tri = [element.nodes[0]!, element.nodes[i]!, element.nodes[i + 1]!];
      for (const nodeIndex of tri) {
        const node = mesh.nodes[nodeIndex];
        if (!node) break;
        positions.push(node.x, node.y, node.z);
        if (colour) colours.push(colour.r, colour.g, colour.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours.length > 0) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhongMaterial({
    color: colours.length > 0 ? 0xffffff : 0x64748b,
    vertexColors: colours.length > 0,
    side: THREE.DoubleSide,
    wireframe: options.wireframe === true,
    transparent: true,
    opacity: colours.length > 0 ? 1 : 0.85,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.name = 'surface';
  group.add(surface);
  return group;
}

/**
 * Build a shaded isosurface from a sampled VoxelField via marchingTets.
 * Used by the 3-D post-processor to show contours of stress/temperature.
 */
export function isosurfaceToScene(
  voxel: VoxelField,
  level: number,
  colour = 0x38bdf8,
  bounds?: [number, number, number, number, number, number],
): THREE.Mesh | null {
  const surface = marchingTets(voxel, level);
  if (surface.positions.length === 0) return null;
  // marchingTets emits voxel-lattice coordinates; map them back to model space
  // so the isosurface aligns with the mesh rendered in the same scene.
  let positions = surface.positions;
  if (bounds) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
    positions = new Float32Array(surface.positions.length);
    for (let i = 0; i < surface.positions.length; i += 3) {
      positions[i] = minX + (surface.positions[i]! / Math.max(1, voxel.nx - 1)) * (maxX - minX);
      positions[i + 1] = minY + (surface.positions[i + 1]! / Math.max(1, voxel.ny - 1)) * (maxY - minY);
      positions[i + 2] = minZ + (surface.positions[i + 2]! / Math.max(1, voxel.nz - 1)) * (maxZ - minZ);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhongMaterial({
    color: colour, side: THREE.DoubleSide, transparent: true, opacity: 0.75,
    shininess: 60,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'isosurface';
  return mesh;
}

/** Axis-aligned bounding box helper framed by the CAD viewport. */
export function engineeringBounds(geometry?: EngineeringGeometry | null, mesh?: EngineeringMesh | null): THREE.Box3 {
  const box = new THREE.Box3();
  if (mesh) {
    for (const node of mesh.nodes) box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z));
  }
  if (geometry) {
    for (const entity of geometry.entities) {
      for (const point of entity.points) box.expandByPoint(new THREE.Vector3(...point));
    }
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  return box;
}
