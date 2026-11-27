// ==========================================================================
// FEM core — Bowyer–Watson incremental Delaunay triangulation and domain
// meshing with boundary recovery.
//
// Pipeline (`meshDomain`):
//   1. discretize the domain boundary loops into segments ≤ target size;
//   2. scatter jittered-grid interior candidate points (deterministic seed);
//   3. Bowyer–Watson triangulation of the whole point set (super-triangle);
//   4. drop triangles whose centroid lies outside the material region;
//   5. boundary recovery: any boundary segment missing from the triangulation
//      has its midpoint inserted; repeat until every segment is an edge.
//   6. a few Laplacian smoothing sweeps on interior nodes.
// ==========================================================================

import {
  distanceToSegment,
  domainSegments,
  pointInsideDomain,
  PlanarDomain,
} from './domain';
import {
  PlanarMesh,
  TriElement,
  edgeKey,
  rebuildBoundaryEdges,
  triangleSignedArea,
} from './types';

interface WorkTri {
  a: number;
  b: number;
  c: number;
}

/** Deterministic 32-bit LCG in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Bowyer–Watson triangulation of `n` points stored flat in `pts`.
 * Returns CCW triangles over indices [0, n). Degenerate (zero-area)
 * triangles are skipped so cocircular ties cannot produce slivers.
 */
export function bowyerWatson(pts: Float64Array, n: number): WorkTri[] {
  // Super-triangle bounds with a generous margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    minX = Math.min(minX, pts[i * 2]!);
    maxX = Math.max(maxX, pts[i * 2]!);
    minY = Math.min(minY, pts[i * 2 + 1]!);
    maxY = Math.max(maxY, pts[i * 2 + 1]!);
  }
  const dx = Math.max(maxX - minX, 1e-12);
  const dy = Math.max(maxY - minY, 1e-12);
  const m = Math.max(dx, dy) * 20 + 10;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const total = n + 3;
  const all = new Float64Array(total * 2);
  all.set(pts.subarray(0, n * 2));
  all[n * 2] = cx - m;
  all[n * 2 + 1] = cy - m;
  all[(n + 1) * 2] = cx + m;
  all[(n + 1) * 2 + 1] = cy - m;
  all[(n + 2) * 2] = cx;
  all[(n + 2) * 2 + 1] = cy + m;

  const tris: WorkTri[] = [{ a: n, b: n + 1, c: n + 2 }];
  for (let p = 0; p < n; p += 1) {
    const px = all[p * 2]!;
    const py = all[p * 2 + 1]!;
    // Collect the cavity: triangles whose circumcircle contains the point.
    const bad: number[] = [];
    for (let t = 0; t < tris.length; t += 1) {
      if (circumcircleContains(all, tris[t]!, px, py)) bad.push(t);
    }
    if (bad.length === 0) continue;
    // Boundary of the cavity: cavity edges that appear exactly once.
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      const tri = tris[t]!;
      for (const [u, v] of [
        [tri.a, tri.b],
        [tri.b, tri.c],
        [tri.c, tri.a],
      ] as const) {
        const key = edgeKey(u, v);
        const prev = edges.get(key);
        if (prev) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    }
    // Remove bad triangles, then re-triangulate the cavity as a fan.
    const dead = new Set(bad);
    const kept: WorkTri[] = [];
    for (let t = 0; t < tris.length; t += 1) {
      if (!dead.has(t)) kept.push(tris[t]!);
    }
    for (const [u, v] of edges.values()) {
      const tri = { a: u, b: v, c: p };
      if (Math.abs(triangleSignedArea(all, u, v, p)) > 0) kept.push(tri);
    }
    tris.length = 0;
    for (const t of kept) tris.push(t);
  }
  // Drop triangles that still touch a super-node.
  const out: WorkTri[] = [];
  for (const t of tris) {
    if (t.a < n && t.b < n && t.c < n) out.push({ a: t.a, b: t.b, c: t.c });
  }
  return out;
}

/** True when point (px, py) lies strictly inside the circumcircle of tri. */
function circumcircleContains(all: Float64Array, tri: WorkTri, px: number, py: number): boolean {
  const ax = all[tri.a * 2]!;
  const ay = all[tri.a * 2 + 1]!;
  const bx = all[tri.b * 2]!;
  const by = all[tri.b * 2 + 1]!;
  const cx = all[tri.c * 2]!;
  const cy = all[tri.c * 2 + 1]!;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-300) return false; // degenerate triangle: skip
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  const dx = px - ux;
  const dy = py - uy;
  // Strict inequality with a relative slack so cocircular points (exact ties)
  // are treated as outside — keeps degenerate cavities from collapsing.
  return dx * dx + dy * dy < r2 * (1 - 1e-12) - 1e-300;
}

/**
 * Triangulate the material region of `domain` over the given point set:
 * full Delaunay → centroid filter → boundary recovery by midpoint insertion.
 * `segs` are the tagged boundary segments that MUST appear as mesh edges.
 * Returns the (possibly grown) point array together with the triangles, since
 * recovery inserts new boundary midpoint nodes.
 */
function triangulateRegion(
  pts: Float64Array,
  count: number,
  domain: PlanarDomain,
  segs: BoundarySegmentLite[],
): { tris: WorkTri[]; pts: Float64Array } {
  let tris = bowyerWatson(pts, count);
  let n = count;
  let pass = 0;
  for (;;) {
    // Drop triangles outside the material region.
    tris = tris.filter((t) => {
      const gx = (pts[t.a * 2]! + pts[t.b * 2]! + pts[t.c * 2]!) / 3;
      const gy = (pts[t.a * 2 + 1]! + pts[t.b * 2 + 1]! + pts[t.c * 2 + 1]!) / 3;
      return pointInsideDomain(domain, gx, gy);
    });
    // Which boundary segments are still missing?
    const present = new Set<string>();
    for (const t of tris) {
      present.add(edgeKey(t.a, t.b));
      present.add(edgeKey(t.b, t.c));
      present.add(edgeKey(t.c, t.a));
    }
    const missing: BoundarySegmentLite[] = [];
    for (const s of segs) {
      if (!present.has(s.key)) missing.push(s);
    }
    if (missing.length === 0) break;
    if (pass >= 48) {
      throw new Error(`fem: boundary recovery did not converge (${missing.length} segments missing)`);
    }
    pass += 1;
    // Insert midpoints of the missing segments (deduplicated).
    const grown = new Float64Array((n + missing.length) * 2);
    grown.set(pts.subarray(0, n * 2));
    for (const s of missing) {
      const mx = (pts[s.p * 2]! + pts[s.q * 2]!) / 2;
      const my = (pts[s.p * 2 + 1]! + pts[s.q * 2 + 1]!) / 2;
      grown[n * 2] = mx;
      grown[n * 2 + 1] = my;
      n += 1;
    }
    pts = grown;
    tris = bowyerWatson(pts, n);
  }
  return { tris, pts };
}

interface BoundarySegmentLite {
  p: number;
  q: number;
  key: string;
  tag: number;
}

export interface MeshDomainOptions {
  /** Target edge length for the initial mesh. */
  targetSize: number;
  /** RNG seed for the interior point jitter (deterministic by default). */
  seed?: number;
  /** Optional per-element tagger for multi-material meshes. */
  elementTagger?: (x: number, y: number) => number;
}

/**
 * Build a P1 triangular mesh of `domain` with target edge size `h`.
 */
export function meshDomain(domain: PlanarDomain, options: MeshDomainOptions): PlanarMesh {
  const h = options.targetSize;
  if (!(h > 0) || !Number.isFinite(h)) throw new Error('fem: targetSize must be a positive number');
  const rand = lcg(options.seed ?? 20260420);
  const segs = domainSegments(domain);

  // ---- 1. boundary points (ordered, deduplicated at shared endpoints) ----
  const pts: number[] = [];
  const pointIndex = new Map<string, number>();
  const nodeTags: number[] = [];
  const ensurePoint = (x: number, y: number, tag: number): number => {
    const key = `${x.toFixed(9)}_${y.toFixed(9)}`;
    const hit = pointIndex.get(key);
    if (hit !== undefined) return hit;
    const id = pts.length / 2;
    pts.push(x, y);
    nodeTags.push(tag);
    pointIndex.set(key, id);
    return id;
  };
  const segLites: BoundarySegmentLite[] = [];
  // Chain consecutive sub-segment endpoints per input segment.
  for (const s of segs) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const parts = Math.max(1, Math.ceil(len / h));
    let prev = ensurePoint(s.a.x, s.a.y, s.tag);
    for (let k = 1; k <= parts; k += 1) {
      const t = k / parts;
      const cur = ensurePoint(s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t, s.tag);
      if (cur !== prev) {
        segLites.push({ p: prev, q: cur, key: edgeKey(prev, cur), tag: s.tag });
        prev = cur;
      }
    }
  }

  // ---- 2a. one graded boundary layer: an offset ring at ~0.85·h_b ---------
  // When the boundary polyline is finer than the interior grid step (curved
  // domains), raw Delaunay connects the fine boundary points to far interior
  // nodes and produces thin boundary-layer slivers. Mirroring the boundary
  // polyline one row inward at the local boundary spacing keeps the first
  // layer near-equilateral for every target size.
  const neighbours = new Map<number, number[]>();
  for (const s of segLites) {
    const add = (p: number, q: number): void => {
      const list = neighbours.get(p);
      if (list) {
        if (!list.includes(q)) list.push(q);
      } else neighbours.set(p, [q]);
    };
    add(s.p, s.q);
    add(s.q, s.p);
  }
  let hbSum = 0;
  for (const s of segLites) {
    hbSum += Math.hypot(pts[s.q * 2]! - pts[s.p * 2]!, pts[s.q * 2 + 1]! - pts[s.p * 2 + 1]!);
  }
  const hb = hbSum / segLites.length; // typical boundary edge length (≤ h)
  const ringNodes: number[] = [];
  for (const [p, nbs] of neighbours) {
    if (nbs.length !== 2) continue;
    const q1 = nbs[0]!;
    const q2 = nbs[1]!;
    const px = pts[p * 2]!;
    const py = pts[p * 2 + 1]!;
    const tx = pts[q2 * 2]! - pts[q1 * 2]!;
    const ty = pts[q2 * 2 + 1]! - pts[q1 * 2 + 1]!;
    const tl = Math.hypot(tx, ty);
    if (tl === 0) continue;
    const d = (0.85 * (Math.hypot(pts[q1 * 2]! - px, pts[q1 * 2 + 1]! - py) +
      Math.hypot(pts[q2 * 2]! - px, pts[q2 * 2 + 1]! - py))) / 2;
    // Inward bisector: pick the side that lands inside the material region.
    let cx = px + d * (ty / tl);
    let cy = py + d * (-tx / tl);
    if (!pointInsideDomain(domain, cx, cy)) {
      cx = px - d * (ty / tl);
      cy = py - d * (-tx / tl);
    }
    if (!pointInsideDomain(domain, cx, cy)) continue;
    // Never bridge narrow gaps or spill across another boundary loop.
    let dSeg = Infinity;
    for (const s of segs) dSeg = Math.min(dSeg, distanceToSegment(s, cx, cy));
    if (dSeg < 0.4 * d) continue;
    // A candidate already placed by an adjacent loop iteration?
    let dRing = Infinity;
    for (const n of ringNodes) {
      dRing = Math.min(dRing, Math.hypot(pts[n * 2]! - cx, pts[n * 2 + 1]! - cy));
    }
    if (dRing < 0.5 * d) continue;
    ringNodes.push(ensurePoint(cx, cy, 0));
  }

  // ---- 2b. interior candidate points on a jittered grid --------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]!);
    maxX = Math.max(maxX, pts[i]!);
    minY = Math.min(minY, pts[i + 1]!);
    maxY = Math.max(maxY, pts[i + 1]!);
  }
  const step = h;
  const guard = Math.max(0.3 * h, 0.55 * hb);
  for (let gy = minY + step / 2; gy < maxY; gy += step) {
    for (let gx = minX + step / 2; gx < maxX; gx += step) {
      const jx = gx + (rand() - 0.5) * 0.6 * h;
      const jy = gy + (rand() - 0.5) * 0.6 * h;
      if (!pointInsideDomain(domain, jx, jy)) continue;
      let dMin = Infinity;
      for (const s of segs) dMin = Math.min(dMin, distanceToSegment(s, jx, jy));
      if (dMin < guard) continue;
      // Keep clear of the boundary-layer ring so spacings stay comparable.
      let dRing = Infinity;
      for (const n of ringNodes) {
        dRing = Math.min(dRing, Math.hypot(pts[n * 2]! - jx, pts[n * 2 + 1]! - jy));
      }
      if (dRing < 0.5 * h) continue;
      pts.push(jx, jy);
      nodeTags.push(0);
    }
  }

  // ---- 3–5. Delaunay + filter + recovery ----------------------------------
  const region = triangulateRegion(Float64Array.from(pts), pts.length / 2, domain, segLites);
  const flat = region.pts;
  const workTris = region.tris;

  // ---- 6. assemble the mesh object ----------------------------------------
  const elements: TriElement[] = workTris.map((t) => ({
    a: t.a,
    b: t.b,
    c: t.c,
    tag: options.elementTagger
      ? options.elementTagger((flat[t.a * 2]! + flat[t.b * 2]! + flat[t.c * 2]!) / 3, (flat[t.a * 2 + 1]! + flat[t.b * 2 + 1]! + flat[t.c * 2 + 1]!) / 3)
      : 0,
  }));
  const segTagMap = new Map<string, number>();
  for (const s of segLites) segTagMap.set(s.key, s.tag);
  // Node tags: default 0; boundary segment endpoints inherit the segment tag.
  const totalNodes = flat.length / 2;
  const finalTags = new Int32Array(totalNodes);
  for (const s of segLites) {
    if (finalTags[s.p] === 0) finalTags[s.p] = s.tag;
    if (finalTags[s.q] === 0) finalTags[s.q] = s.tag;
  }
  const mesh: PlanarMesh = {
    nodes: flat,
    nodeTags: finalTags,
    elements,
    boundaryEdges: [],
  };
  mesh.boundaryEdges = rebuildBoundaryEdges(mesh, segTagMap);
  // Fill untagged boundary edges from their segment tags where possible.
  for (const e of mesh.boundaryEdges) {
    if (e.tag === 0) {
      const t = segTagMap.get(edgeKey(e.a, e.b));
      if (t !== undefined) e.tag = t;
    }
  }
  // Propagate node tags onto interior nodes adjacent to tagged boundary.
  smoothInterior(mesh, 2);
  return mesh;
}

/**
 * Laplacian smoothing of interior nodes: move each free node to the centroid
 * of its neighbours, accepting the move only when no adjacent triangle
 * inverts. Boundary nodes never move, so the boundary is preserved exactly.
 */
export function smoothInterior(mesh: PlanarMesh, iterations: number): void {
  const boundary = new Set<number>();
  for (const e of mesh.boundaryEdges) {
    boundary.add(e.a);
    boundary.add(e.b);
  }
  const n = mesh.nodes.length / 2;
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (const el of mesh.elements) {
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      if (!neighbours[p]!.includes(q)) neighbours[p]!.push(q);
      if (!neighbours[q]!.includes(p)) neighbours[q]!.push(p);
    }
  }
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < n; i += 1) {
      if (boundary.has(i)) continue;
      const nb = neighbours[i]!;
      if (nb.length === 0) continue;
      let sx = 0;
      let sy = 0;
      for (const j of nb) {
        sx += mesh.nodes[j * 2]!;
        sy += mesh.nodes[j * 2 + 1]!;
      }
      const cx = sx / nb.length;
      const cy = sy / nb.length;
      // Accept only if every triangle around the node keeps positive area.
      let ok = true;
      for (const el of mesh.elements) {
        let has = false;
        let p = 0;
        let q = 0;
        if (el.a === i) {
          has = true;
          p = el.b;
          q = el.c;
        } else if (el.b === i) {
          has = true;
          p = el.c;
          q = el.a;
        } else if (el.c === i) {
          has = true;
          p = el.a;
          q = el.b;
        }
        if (!has) continue;
        const px = mesh.nodes[p * 2]!;
        const py = mesh.nodes[p * 2 + 1]!;
        const qx = mesh.nodes[q * 2]!;
        const qy = mesh.nodes[q * 2 + 1]!;
        if (0.5 * ((px - cx) * (qy - cy) - (qx - cx) * (py - cy)) <= 0) {
          ok = false;
          break;
        }
      }
      if (ok) {
        mesh.nodes[i * 2] = cx;
        mesh.nodes[i * 2 + 1] = cy;
      }
    }
  }
}
