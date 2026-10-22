// ==========================================================================
// FEM core — parametric 2-D domain builders.
//
// A `PlanarDomain` is described by boundary loops. Each loop is an ordered
// polyline of tagged segments; point-inside is decided with the even-odd
// crossing rule over ALL loops, so holes need no special winding convention.
//
// Edge tag conventions (used by boundary-condition selectors):
//   - rectangle            : 1 = bottom, 2 = right, 3 = top, 4 = left
//   - circle               : 1 = the whole circle
//   - annulus              : 1 = outer circle, 2 = inner circle (hole)
//   - L-shape              : 1..6 going CCW from the bottom edge
//   - rectangle with hole  : 1..4 outer (as rectangle), 5 = circular hole
// ==========================================================================

import { PlanarMesh, TriElement, rebuildBoundaryEdges } from './types';

export interface XY {
  x: number;
  y: number;
}

/** One straight piece of a boundary loop carrying a physical-group tag. */
export interface BoundarySegment {
  a: XY;
  b: XY;
  tag: number;
}

export interface PlanarDomain {
  /** Outer boundary loop(s), each an ordered open polyline; the loop closes
   * from the last point back to the first. */
  outer: BoundarySegment[][];
  /** Hole loops (same convention as `outer`). */
  holes: BoundarySegment[][];
  /** Human-readable edge tag legend (tag → label), for UIs and debug. */
  edgeLegend: Record<number, string>;
}

// ---- geometry helpers ------------------------------------------------------

function seg(x0: number, y0: number, x1: number, y1: number, tag: number): BoundarySegment {
  return { a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, tag };
}

/**
 * Even-odd inside test against all loops (outer + holes). A point strictly
 * inside the material region returns true; points on the boundary count as
 * inside (ray-casting tie behaviour), which is what the mesher wants.
 */
export function pointInsideDomain(domain: PlanarDomain, x: number, y: number): boolean {
  let crossings = 0;
  for (const loop of [...domain.outer, ...domain.holes]) {
    for (const s of loop) {
      const { x: ax, y: ay } = s.a;
      const { x: bx, y: by } = s.b;
      // Ray towards +x from (x, y); count proper straddles of the segment.
      if (ay > y !== by > y) {
        const t = (y - ay) / (by - ay);
        const xi = ax + t * (bx - ax);
        if (x < xi) crossings += 1;
      }
    }
  }
  return (crossings & 1) === 1;
}

/** Shortest distance from a point to a boundary segment (straight edges only). */
export function distanceToSegment(s: BoundarySegment, x: number, y: number): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((x - s.a.x) * dx + (y - s.a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = s.a.x + t * dx;
  const py = s.a.y + t * dy;
  return Math.hypot(x - px, y - py);
}

/** All segments of the domain (outer + holes) as a flat list. */
export function domainSegments(domain: PlanarDomain): BoundarySegment[] {
  return [...domain.outer.flat(), ...domain.holes.flat()];
}

// ---- domain builders -------------------------------------------------------

/** Rectangular domain [0, w] × [0, h]. Tags: 1 bottom, 2 right, 3 top, 4 left. */
export function rectangleDomain(w: number, h: number): PlanarDomain {
  return {
    outer: [[seg(0, 0, w, 0, 1), seg(w, 0, w, h, 2), seg(w, h, 0, h, 3), seg(0, h, 0, 0, 4)]],
    holes: [],
    edgeLegend: { 1: 'bottom', 2: 'right', 3: 'top', 4: 'left' },
  };
}

/** Circular domain centred at (cx, cy) with radius r. Tag 1 = circle. */
export function circleDomain(r: number, cx = 0, cy = 0): PlanarDomain {
  const loop = discretizeCircle(r, cx, cy, 1);
  return { outer: [loop], holes: [], edgeLegend: { 1: 'circle' } };
}

/** Annulus: outer circle tag 1, inner circle (hole) tag 2. */
export function annulusDomain(rInner: number, rOuter: number, cx = 0, cy = 0): PlanarDomain {
  return {
    outer: [discretizeCircle(rOuter, cx, cy, 1)],
    holes: [discretizeCircle(rInner, cx, cy, 2)],
    edgeLegend: { 1: 'outer', 2: 'inner' },
  };
}

/**
 * L-shaped domain (0,0) → (2,0) → (2,1) → (1,1) → (1,2) → (0,2), CCW with a
 * reflex corner at (1,1). Tags 1..6 starting at the bottom edge.
 */
export function lShapeDomain(): PlanarDomain {
  const p: XY[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ];
  const loop: BoundarySegment[] = [];
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    loop.push(seg(a.x, a.y, b.x, b.y, i + 1));
  }
  return {
    outer: [loop],
    holes: [],
    edgeLegend: { 1: 'bottom', 2: 'right', 3: 'step-bottom', 4: 'step-inner', 5: 'step-left', 6: 'left-top' },
  };
}

/** Rectangle [0,w] × [0,h] with a circular hole at (cx, cy) of radius r.
 * Outer tags 1..4 as `rectangleDomain`, hole tag 5. */
export function rectangleWithHoleDomain(w: number, h: number, cx: number, cy: number, r: number): PlanarDomain {
  return {
    outer: [[seg(0, 0, w, 0, 1), seg(w, 0, w, h, 2), seg(w, h, 0, h, 3), seg(0, h, 0, 0, 4)]],
    holes: [discretizeCircle(r, cx, cy, 5)],
    edgeLegend: { 1: 'bottom', 2: 'right', 3: 'top', 4: 'left', 5: 'hole' },
  };
}

/**
 * Approximate a circle with a closed polyline. The default chord length is
 * r/10 (63 segments for a full circle, ≈0.17 % area deficit) so the polygonal
 * domain tracks the true circle even when the mesher's target size is coarse;
 * callers that want a coarser control polygon can pass `h` explicitly.
 */
function discretizeCircle(r: number, cx: number, cy: number, tag: number, h = r / 10): BoundarySegment[] {
  const n = Math.max(12, Math.ceil((2 * Math.PI * r) / h));
  const pts: XY[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  const loop: BoundarySegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    loop.push(seg(a.x, a.y, b.x, b.y, tag));
  }
  return loop;
}

/**
 * Structured rectangular mesh (nx × ny cells, two triangles per cell). Not
 * Delaunay-generated — it exists for convergence studies and for problems
 * (e.g. uniaxial tension) whose exact solution P1 must reproduce exactly.
 * Boundary edges carry the same tag convention as `rectangleDomain`.
 */
export function rectStructuredMesh(w: number, h: number, nx: number, ny: number): PlanarMesh {
  const elements: TriElement[] = [];
  const nodeId = (i: number, j: number): number => j * (nx + 1) + i;
  const coords: number[] = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      coords.push((w * i) / nx, (h * j) / ny);
    }
  }
  const cellTag = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const n00 = nodeId(i, j);
      const n10 = nodeId(i + 1, j);
      const n01 = nodeId(i, j + 1);
      const n11 = nodeId(i + 1, j + 1);
      // Alternating diagonals keep the mesh symmetric under reflection.
      if ((i + j) % 2 === 0) {
        elements.push({ a: n00, b: n10, c: n11, tag: cellTag });
        elements.push({ a: n00, b: n11, c: n01, tag: cellTag });
      } else {
        elements.push({ a: n00, b: n10, c: n01, tag: cellTag });
        elements.push({ a: n10, b: n11, c: n01, tag: cellTag });
      }
    }
  }
  const mesh: PlanarMesh = {
    nodes: Float64Array.from(coords),
    nodeTags: Int32Array.from({ length: coords.length / 2 }, () => 0),
    elements,
    boundaryEdges: [],
  };
  // Tag boundary edges with the rectangle convention.
  const tagMap = new Map<string, number>();
  for (const el of mesh.elements) {
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      const px = mesh.nodes[p * 2]!;
      const py = mesh.nodes[p * 2 + 1]!;
      const qx = mesh.nodes[q * 2]!;
      const qy = mesh.nodes[q * 2 + 1]!;
      const eps = 1e-9 * Math.max(w, h);
      let tag = 0;
      if (Math.abs(py) < eps && Math.abs(qy) < eps) tag = 1;
      else if (Math.abs(px - w) < eps && Math.abs(qx - w) < eps) tag = 2;
      else if (Math.abs(py - h) < eps && Math.abs(qy - h) < eps) tag = 3;
      else if (Math.abs(px) < eps && Math.abs(qx) < eps) tag = 4;
      if (tag > 0) tagMap.set(`${Math.min(p, q)}_${Math.max(p, q)}`, tag);
    }
  }
  mesh.boundaryEdges = rebuildBoundaryEdges(mesh, tagMap);
  return mesh;
}
