// ==========================================================================
// FEM core — planar mesh data model (pure TypeScript, zero DOM).
//
// A `PlanarMesh` is a linear (P1) triangular mesh over the plane:
//   - `nodes`  : flat coordinate array [x0, y0, x1, y1, ...]
//   - `nodeTags`: per-node physical-group tag (0 = untagged), used for
//     point selectors (e.g. a single pinned node in elasticity).
//   - `elements`: P1 triangles (CCW node ordering) with an element tag for
//     sub-domain (multi-material) identification.
//   - `boundaryEdges`: boundary edges with a physical-group tag used by
//     Dirichlet / Neumann / Robin selectors.
// ==========================================================================

/** A P1 triangle: indices of its three nodes, CCW. `tag` identifies the
 * physical group (sub-domain / material) the element belongs to. */
export interface TriElement {
  a: number;
  b: number;
  c: number;
  /** Physical group marker (0 = default region). */
  tag: number;
}

/** A boundary edge between nodes `a` and `b` (a < b). */
export interface EdgeElement {
  a: number;
  b: number;
  /** Physical group marker of the boundary segment this edge lies on. */
  tag: number;
}

export interface PlanarMesh {
  /** Flat node coordinates, length `2 * nodeCount`. */
  nodes: Float64Array;
  /** Per-node physical tag (0 = untagged). */
  nodeTags: Int32Array;
  elements: TriElement[];
  /** Boundary edges, each stored once with `a < b`. */
  boundaryEdges: EdgeElement[];
}

/** Number of nodes in the mesh. */
export function nodeCount(mesh: PlanarMesh): number {
  return mesh.nodes.length >> 1;
}

/** X coordinate of node `i`. */
export function nodeX(mesh: PlanarMesh, i: number): number {
  return mesh.nodes[i * 2]!;
}

/** Y coordinate of node `i`. */
export function nodeY(mesh: PlanarMesh, i: number): number {
  return mesh.nodes[i * 2 + 1]!;
}

/** Signed area of the triangle (a, b, c); positive for CCW ordering. */
export function triangleSignedArea(nodes: Float64Array, a: number, b: number, c: number): number {
  const ax = nodes[a * 2]!;
  const ay = nodes[a * 2 + 1]!;
  const bx = nodes[b * 2]!;
  const by = nodes[b * 2 + 1]!;
  const cx = nodes[c * 2]!;
  const cy = nodes[c * 2 + 1]!;
  return 0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
}

/** Unsigned area of a triangle element. */
export function elementArea(mesh: PlanarMesh, el: TriElement): number {
  return Math.abs(triangleSignedArea(mesh.nodes, el.a, el.b, el.c));
}

/** Canonical undirected key for an edge. */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Rebuild the boundary edge list from the element connectivity: edges that
 * appear in exactly one triangle are boundary edges. Tags are taken from
 * `edgeTagMap` (key → tag) when available, otherwise 0.
 */
export function rebuildBoundaryEdges(
  mesh: Pick<PlanarMesh, 'nodes' | 'elements'>,
  edgeTagMap?: Map<string, number>,
): EdgeElement[] {
  const count = new Map<string, number>();
  for (const el of mesh.elements) {
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      const key = edgeKey(p, q);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const edges: EdgeElement[] = [];
  for (const el of mesh.elements) {
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      const key = edgeKey(p, q);
      if (count.get(key) === 1) {
        edges.push({ a: Math.min(p, q), b: Math.max(p, q), tag: edgeTagMap?.get(key) ?? 0 });
      }
    }
  }
  return edges;
}

/**
 * Compact a mesh in place-ish: drop elements failing `keep`, then remove
 * nodes no longer referenced by any element, remapping indices. Returns the
 * compacted mesh (a new object; input arrays are not mutated).
 */
export function compactMesh(mesh: PlanarMesh, keep: (el: TriElement) => boolean): PlanarMesh {
  const elements = mesh.elements.filter(keep);
  const used = new Int32Array(nodeCount(mesh)).fill(-1);
  const coords: number[] = [];
  const tags: number[] = [];
  let next = 0;
  for (const el of elements) {
    for (const n of [el.a, el.b, el.c] as const) {
      if (used[n] === -1) {
        used[n] = next;
        coords.push(mesh.nodes[n * 2]!, mesh.nodes[n * 2 + 1]!);
        tags.push(mesh.nodeTags[n]!);
        next += 1;
      }
    }
  }
  const remap = (n: number): number => (used[n] === -1 ? n : used[n]!);
  for (const el of elements) {
    el.a = remap(el.a);
    el.b = remap(el.b);
    el.c = remap(el.c);
  }
  const compacted: PlanarMesh = {
    nodes: Float64Array.from(coords),
    nodeTags: Int32Array.from(tags),
    elements,
    boundaryEdges: [],
  };
  compacted.boundaryEdges = rebuildBoundaryEdges(compacted, undefined);
  return compacted;
}

/** Set of node indices that lie on the boundary. */
export function boundaryNodeSet(mesh: PlanarMesh): Set<number> {
  const set = new Set<number>();
  for (const e of mesh.boundaryEdges) {
    set.add(e.a);
    set.add(e.b);
  }
  return set;
}
