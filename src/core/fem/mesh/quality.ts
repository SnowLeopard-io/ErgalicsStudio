// ==========================================================================
// FEM core — triangle quality metrics and degenerate-element handling.
// ==========================================================================

import { PlanarMesh, TriElement, rebuildBoundaryEdges, triangleSignedArea } from './types';

export interface MeshQualityStats {
  nodeCount: number;
  elementCount: number;
  /** Smallest interior angle over all elements, in degrees. */
  minAngleDeg: number;
  /** Largest aspect ratio (longest edge / shortest edge). */
  maxAspectRatio: number;
  /** Mean aspect ratio over all elements. */
  meanAspectRatio: number;
  /** Elements dropped as degenerate by `dropDegenerateTriangles` would be
   * reflected here when re-measured after compaction. */
  degenerateCount: number;
}

/** Interior angles of one triangle in radians. */
export function triangleAngles(nodes: Float64Array, a: number, b: number, c: number): [number, number, number] {
  const ax = nodes[a * 2]!;
  const ay = nodes[a * 2 + 1]!;
  const bx = nodes[b * 2]!;
  const by = nodes[b * 2 + 1]!;
  const cx = nodes[c * 2]!;
  const cy = nodes[c * 2 + 1]!;
  const angleAt = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    Math.acos(
      Math.max(-1, Math.min(1, ((qx - px) * (rx - px) + (qy - py) * (ry - py)) /
        (Math.hypot(qx - px, qy - py) * Math.hypot(rx - px, ry - py) || 1e-300))),
    );
  return [
    angleAt(ax, ay, bx, by, cx, cy),
    angleAt(bx, by, cx, cy, ax, ay),
    angleAt(cx, cy, ax, ay, bx, by),
  ];
}

/** Aspect ratio of one triangle: longest edge / shortest edge (≥ 1). */
export function triangleAspectRatio(nodes: Float64Array, el: TriElement): number {
  const lens = [
    Math.hypot(nodes[el.b * 2]! - nodes[el.a * 2]!, nodes[el.b * 2 + 1]! - nodes[el.a * 2 + 1]!),
    Math.hypot(nodes[el.c * 2]! - nodes[el.b * 2]!, nodes[el.c * 2 + 1]! - nodes[el.b * 2 + 1]!),
    Math.hypot(nodes[el.a * 2]! - nodes[el.c * 2]!, nodes[el.a * 2 + 1]! - nodes[el.c * 2 + 1]!),
  ];
  const longest = Math.max(...lens);
  const shortest = Math.min(...lens);
  return longest / Math.max(shortest, 1e-300);
}

/** Radius ratio of one triangle: 2·r_in / R_circ ∈ (0, 1], 1 = equilateral. */
export function triangleRadiusRatio(nodes: Float64Array, el: TriElement): number {
  const area = Math.abs(triangleSignedArea(nodes, el.a, el.b, el.c));
  const lens = [
    Math.hypot(nodes[el.b * 2]! - nodes[el.a * 2]!, nodes[el.b * 2 + 1]! - nodes[el.a * 2 + 1]!),
    Math.hypot(nodes[el.c * 2]! - nodes[el.b * 2]!, nodes[el.c * 2 + 1]! - nodes[el.b * 2 + 1]!),
    Math.hypot(nodes[el.a * 2]! - nodes[el.c * 2]!, nodes[el.a * 2 + 1]! - nodes[el.c * 2 + 1]!),
  ];
  const perimeter = lens[0]! + lens[1]! + lens[2]!;
  if (perimeter <= 0) return 0;
  const rIn = (2 * area) / perimeter;
  // Circumradius R = abc / (4A).
  const rCirc = (lens[0]! * lens[1]! * lens[2]!) / Math.max(4 * area, 1e-300);
  return (2 * rIn) / Math.max(rCirc, 1e-300);
}

/** Aggregate quality statistics of a mesh. */
export function meshQuality(mesh: PlanarMesh): MeshQualityStats {
  let minAngle = Math.PI;
  let maxAspect = 0;
  let aspectSum = 0;
  let degenerate = 0;
  for (const el of mesh.elements) {
    const area = Math.abs(triangleSignedArea(mesh.nodes, el.a, el.b, el.c));
    if (!(area > 0) || !Number.isFinite(area)) {
      degenerate += 1;
      continue;
    }
    for (const a of triangleAngles(mesh.nodes, el.a, el.b, el.c)) minAngle = Math.min(minAngle, a);
    const aspect = triangleAspectRatio(mesh.nodes, el);
    maxAspect = Math.max(maxAspect, aspect);
    aspectSum += aspect;
  }
  const n = mesh.elements.length;
  return {
    nodeCount: mesh.nodes.length / 2,
    elementCount: n,
    minAngleDeg: (minAngle * 180) / Math.PI,
    maxAspectRatio: maxAspect,
    meanAspectRatio: n > 0 ? aspectSum / n : 0,
    degenerateCount: degenerate,
  };
}

/**
 * Remove degenerate elements (zero/near-zero area, non-finite geometry) and
 * compact the mesh so no orphan nodes remain. `minArea` defaults to a tiny
 * fraction of the mesh bounding box area.
 */
export function dropDegenerateTriangles(mesh: PlanarMesh, minArea?: number): PlanarMesh {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.nodes.length; i += 2) {
    minX = Math.min(minX, mesh.nodes[i]!);
    maxX = Math.max(maxX, mesh.nodes[i]!);
    minY = Math.min(minY, mesh.nodes[i + 1]!);
    maxY = Math.max(maxY, mesh.nodes[i + 1]!);
  }
  const fallback = Math.max((maxX - minX) * (maxY - minY), 1) * 1e-14;
  const threshold = minArea ?? fallback;
  const elements = mesh.elements.filter((el) => {
    const area = Math.abs(triangleSignedArea(mesh.nodes, el.a, el.b, el.c));
    return Number.isFinite(area) && area > threshold;
  });
  // Remap node indices to drop orphan nodes.
  const remap = new Map<number, number>();
  const coords: number[] = [];
  const tags: number[] = [];
  const idOf = (n: number): number => {
    const hit = remap.get(n);
    if (hit !== undefined) return hit;
    const id = coords.length / 2;
    coords.push(mesh.nodes[n * 2]!, mesh.nodes[n * 2 + 1]!);
    tags.push(mesh.nodeTags[n]!);
    remap.set(n, id);
    return id;
  };
  for (const el of elements) {
    el.a = idOf(el.a);
    el.b = idOf(el.b);
    el.c = idOf(el.c);
  }
  const compacted: PlanarMesh = {
    nodes: Float64Array.from(coords),
    nodeTags: Int32Array.from(tags),
    elements,
    boundaryEdges: [],
  };
  compacted.boundaryEdges = rebuildBoundaryEdges(compacted);
  return compacted;
}

/** Diagnostic helper: duplicate-coordinate node count (should be 0). */
export function duplicateNodeCount(mesh: PlanarMesh): number {
  const seen = new Set<string>();
  let dup = 0;
  for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
    const key = `${mesh.nodes[i * 2]!.toFixed(12)}_${mesh.nodes[i * 2 + 1]!.toFixed(12)}`;
    if (seen.has(key)) dup += 1;
    else seen.add(key);
  }
  return dup;
}
