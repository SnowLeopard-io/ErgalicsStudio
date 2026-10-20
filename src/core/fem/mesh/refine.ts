// ==========================================================================
// FEM core — uniform (red) refinement by target edge size + boundary
// preservation.
//
// Red refinement splits every edge at its midpoint and every triangle into
// four similar children, so conformity and element shape are preserved by
// construction and the boundary polyline is preserved exactly (midpoints of
// tagged boundary edges inherit the tag). Passes repeat until the longest
// edge no longer exceeds the target size (each pass halves all edges).
// ==========================================================================

import { PlanarMesh, TriElement, rebuildBoundaryEdges } from './types';

/** Safety cap so a bad target cannot explode memory (elements per pass ×4). */
const MAX_ELEMENTS = 400_000;

export interface RefineOptions {
  /** Optional cap on the number of red-refinement passes (default 6). */
  maxPasses?: number;
  /** Optional hard cap on the resulting element count. */
  maxElements?: number;
}

/**
 * Uniformly refine `mesh` until every element edge length is ≤ `targetSize`.
 * Element tags are inherited by all children; boundary edge tags are
 * inherited by both sub-edges; new node tags inherit a parent tag only when
 * both parents agree (otherwise 0 = untagged).
 */
export function refineToSize(mesh: PlanarMesh, targetSize: number, options: RefineOptions = {}): PlanarMesh {
  if (!(targetSize > 0) || !Number.isFinite(targetSize)) {
    throw new Error('fem: targetSize must be a positive number');
  }
  const maxPasses = options.maxPasses ?? 6;
  const maxElements = options.maxElements ?? MAX_ELEMENTS;
  let current = mesh;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (longestEdge(current) <= targetSize * (1 + 1e-12)) break;
    if (current.elements.length * 4 > maxElements) break;
    current = redRefineOnce(current);
  }
  return current;
}

/** Longest element edge length in the mesh. */
export function longestEdge(mesh: PlanarMesh): number {
  let longest = 0;
  const nodes = mesh.nodes;
  const measure = (a: number, b: number): number => {
    const dx = nodes[a * 2]! - nodes[b * 2]!;
    const dy = nodes[a * 2 + 1]! - nodes[b * 2 + 1]!;
    return Math.hypot(dx, dy);
  };
  for (const el of mesh.elements) {
    longest = Math.max(longest, measure(el.a, el.b), measure(el.b, el.c), measure(el.c, el.a));
  }
  return longest;
}

/** One red-refinement pass: every edge is split at its midpoint. */
export function redRefineOnce(mesh: PlanarMesh): PlanarMesh {
  const nodes: number[] = Array.from(mesh.nodes);
  const nodeTags: number[] = Array.from(mesh.nodeTags);
  const midpoint = new Map<string, number>();

  const midOf = (a: number, b: number, edgeTag: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = midpoint.get(key);
    if (hit !== undefined) return hit;
    const id = nodes.length / 2;
    nodes.push((mesh.nodes[a * 2]! + mesh.nodes[b * 2]!) / 2, (mesh.nodes[a * 2 + 1]! + mesh.nodes[b * 2 + 1]!) / 2);
    const ta = mesh.nodeTags[a]!;
    const tb = mesh.nodeTags[b]!;
    nodeTags.push(ta !== 0 && ta === tb ? ta : edgeTag);
    midpoint.set(key, id);
    return id;
  };

  const elements: TriElement[] = [];
  for (const el of mesh.elements) {
    const mab = midOf(el.a, el.b, 0);
    const mbc = midOf(el.b, el.c, 0);
    const mca = midOf(el.c, el.a, 0);
    const tag = el.tag;
    // Four similar children; parent is CCW so the children are too.
    elements.push({ a: el.a, b: mab, c: mca, tag });
    elements.push({ a: mab, b: el.b, c: mbc, tag });
    elements.push({ a: mca, b: mbc, c: el.c, tag });
    elements.push({ a: mab, b: mbc, c: mca, tag });
  }

  // Boundary edges split into two tagged sub-edges (exact boundary preservation).
  const boundaryEdges = [];
  for (const e of mesh.boundaryEdges) {
    const m = midOf(e.a, e.b, e.tag);
    boundaryEdges.push({ a: e.a, b: m, tag: e.tag }, { a: m, b: e.b, tag: e.tag });
  }

  const refined: PlanarMesh = {
    nodes: Float64Array.from(nodes),
    nodeTags: Int32Array.from(nodeTags),
    elements,
    boundaryEdges,
  };
  // The constructed boundary list is already complete; rebuild as a safety
  // net for degenerate inputs (also normalizes a < b ordering).
  refined.boundaryEdges = rebuildBoundaryEdges(refined, boundaryTagMap(refined, boundaryEdges));
  return refined;
}

function boundaryTagMap(mesh: PlanarMesh, edges: Array<{ a: number; b: number; tag: number }>): Map<string, number> {
  void mesh;
  const map = new Map<string, number>();
  for (const e of edges) map.set(`${Math.min(e.a, e.b)}_${Math.max(e.a, e.b)}`, e.tag);
  return map;
}
