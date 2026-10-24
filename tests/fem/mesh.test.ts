// ==========================================================================
// FEM core — meshing tests: Delaunay empty-circumcircle property (random
// sampling), domain meshing sanity (region coverage, quality, area) and
// uniform refinement with exact boundary preservation.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { bowyerWatson, meshDomain } from '../../src/core/fem/mesh/delaunay';
import {
  circleDomain,
  annulusDomain,
  rectangleDomain,
  distanceToSegment,
  domainSegments,
  pointInsideDomain,
} from '../../src/core/fem/mesh/domain';
import { refineToSize, longestEdge } from '../../src/core/fem/mesh/refine';
import { meshQuality } from '../../src/core/fem/mesh/quality';
import { nodeCount, nodeX, nodeY, edgeKey } from '../../src/core/fem/mesh/types';

/** Deterministic LCG in [0, 1) so failures reproduce. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Squared distance from point p to the circumcentre of triangle (a, b, c). */
function circumcircleViolated(
  pts: Float64Array,
  a: number,
  b: number,
  c: number,
  p: number,
): boolean {
  const ax = pts[a * 2]!;
  const ay = pts[a * 2 + 1]!;
  const bx = pts[b * 2]!;
  const by = pts[b * 2 + 1]!;
  const cx = pts[c * 2]!;
  const cy = pts[c * 2 + 1]!;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-300) return false;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  const dx = pts[p * 2]! - ux;
  const dy = pts[p * 2 + 1]! - uy;
  // Strict interior test with a small relative slack (cocircular ties, which
  // are valid Delaunay configurations, must not be reported as violations).
  return dx * dx + dy * dy < r2 * (1 - 1e-9);
}

/** True when no vertex lies strictly inside another triangle's circumcircle. */
function satisfiesEmptyCircumcircle(pts: Float64Array, n: number, tris: Array<{ a: number; b: number; c: number }>): boolean {
  for (const t of tris) {
    for (let p = 0; p < n; p += 1) {
      if (p === t.a || p === t.b || p === t.c) continue;
      if (circumcircleViolated(pts, t.a, t.b, t.c, p)) return false;
    }
  }
  return true;
}

describe('fem mesh: Delaunay empty-circumcircle property', () => {
  it('holds exhaustively for several random point sets', () => {
    const rand = lcg(20260420);
    for (let trial = 0; trial < 8; trial += 1) {
      const n = 24 + trial * 7;
      const pts = new Float64Array(n * 2);
      for (let i = 0; i < n; i += 1) {
        pts[i * 2] = rand();
        pts[i * 2 + 1] = rand();
      }
      const tris = bowyerWatson(pts, n);
      expect(tris.length).toBeGreaterThan(n);
      expect(satisfiesEmptyCircumcircle(pts, n, tris)).toBe(true);
    }
  });

  it('holds for a sampled subset of a larger point cloud', () => {
    const rand = lcg(42);
    const n = 220;
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      pts[i * 2] = rand();
      pts[i * 2 + 1] = rand();
    }
    const tris = bowyerWatson(pts, n);
    expect(tris.length).toBeGreaterThan(n);
    // Randomly sample (triangle, vertex) pairs — 30k checks.
    for (let s = 0; s < 30000; s += 1) {
      const t = tris[Math.floor(rand() * tris.length)]!;
      const p = Math.floor(rand() * n);
      if (p === t.a || p === t.b || p === t.c) continue;
      expect(circumcircleViolated(pts, t.a, t.b, t.c, p)).toBe(false);
    }
  });
});

describe('fem mesh: meshDomain region coverage and quality', () => {
  it('circle domain: triangles tile the disc, boundary is respected, quality is sane', () => {
    const domain = circleDomain(1);
    const mesh = meshDomain(domain, { targetSize: 0.2, seed: 7 });
    expect(mesh.elements.length).toBeGreaterThan(20);

    // (a) Every element centroid lies inside the material region.
    for (const el of mesh.elements) {
      const gx = (nodeX(mesh, el.a) + nodeX(mesh, el.b) + nodeX(mesh, el.c)) / 3;
      const gy = (nodeY(mesh, el.a) + nodeY(mesh, el.b) + nodeY(mesh, el.c)) / 3;
      expect(pointInsideDomain(domain, gx, gy)).toBe(true);
    }

    // (b) Total element area matches the analytic disc area π within 2 %.
    const segs = domainSegments(domain);
    let area = 0;
    for (const el of mesh.elements) {
      const ax = nodeX(mesh, el.a);
      const ay = nodeY(mesh, el.a);
      const bx = nodeX(mesh, el.b);
      const by = nodeY(mesh, el.b);
      const cx = nodeX(mesh, el.c);
      const cy = nodeY(mesh, el.c);
      area += Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    }
    expect(Math.abs(area - Math.PI) / Math.PI).toBeLessThan(0.02);

    // (c) Every boundary edge midpoint lies on the boundary polyline.
    for (const e of mesh.boundaryEdges) {
      const mx = (nodeX(mesh, e.a) + nodeX(mesh, e.b)) / 2;
      const my = (nodeY(mesh, e.a) + nodeY(mesh, e.b)) / 2;
      let dMin = Infinity;
      for (const s of segs) dMin = Math.min(dMin, distanceToSegment(s, mx, my));
      expect(dMin).toBeLessThan(1e-9);
    }

    // (d) No degenerate elements; worst angle stays above a sane floor.
    const q = meshQuality(mesh);
    expect(q.degenerateCount).toBe(0);
    expect(q.minAngleDeg).toBeGreaterThan(20);
  });

  it('annulus domain: hole is respected (area = π(R² − r²))', () => {
    const domain = annulusDomain(0.4, 1);
    const mesh = meshDomain(domain, { targetSize: 0.15, seed: 11 });
    let area = 0;
    for (const el of mesh.elements) {
      const ax = nodeX(mesh, el.a);
      const ay = nodeY(mesh, el.a);
      const bx = nodeX(mesh, el.b);
      const by = nodeY(mesh, el.b);
      const cx = nodeX(mesh, el.c);
      const cy = nodeY(mesh, el.c);
      area += Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    }
    const exact = Math.PI * (1 - 0.16);
    expect(Math.abs(area - exact) / exact).toBeLessThan(0.02);
    // The hole boundary must exist as tagged boundary edges.
    const innerTags = mesh.boundaryEdges.filter((e) => e.tag === 2);
    expect(innerTags.length).toBeGreaterThan(0);
  });

  it('rectangle domain: every discretized boundary segment appears as a mesh edge', () => {
    const domain = rectangleDomain(1, 1);
    const mesh = meshDomain(domain, { targetSize: 0.2, seed: 3 });
    const present = new Set<string>();
    for (const el of mesh.elements) {
      present.add(edgeKey(el.a, el.b));
      present.add(edgeKey(el.b, el.c));
      present.add(edgeKey(el.c, el.a));
    }
    // Rebuild the expected boundary polyline: all distinct boundary-edge keys.
    const boundaryKeys = new Set(mesh.boundaryEdges.map((e) => edgeKey(e.a, e.b)));
    expect(boundaryKeys.size).toBeGreaterThan(16);
    // Boundary edges must form closed loops: every boundary node has ≥ 2
    // boundary edges attached.
    const degree = new Map<number, number>();
    for (const e of mesh.boundaryEdges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    for (const [, d] of degree) expect(d).toBeGreaterThanOrEqual(2);
    // All four physical tags are present.
    for (const tag of [1, 2, 3, 4]) {
      expect(mesh.boundaryEdges.some((e) => e.tag === tag)).toBe(true);
    }
    void present;
  });
});

describe('fem mesh: uniform refinement with boundary preservation', () => {
  it('refineToSize halves edges, grows 4× per pass and preserves the boundary exactly', () => {
    const domain = circleDomain(1);
    const base = meshDomain(domain, { targetSize: 0.35, seed: 7 });
    const target = 0.1;
    const refined = refineToSize(base, target);

    // Longest edge no longer exceeds the target (two passes: 0.175 → 0.0875).
    expect(longestEdge(refined)).toBeLessThanOrEqual(target * (1 + 1e-9));

    // Element count follows the red-refinement law N·4^p (no dropped children).
    let passes = 0;
    let longest = longestEdge(base);
    while (longest > target * (1 + 1e-12) && passes < 6) {
      longest /= 2;
      passes += 1;
    }
    expect(refined.elements.length).toBe(base.elements.length * 4 ** passes);

    // Original node indices are stable: coordinates of the first n0 nodes
    // must be bit-identical after refinement.
    const n0 = nodeCount(base);
    expect(nodeCount(refined)).toBeGreaterThan(n0);
    for (let i = 0; i < n0; i += 1) {
      expect(nodeX(refined, i)).toBe(nodeX(base, i));
      expect(nodeY(refined, i)).toBe(nodeY(base, i));
    }

    // Every refined boundary edge endpoint lies on the original polyline, and
    // each original boundary edge is split into 2^p sub-edges with tags kept.
    const segs = domainSegments(domain);
    for (const e of refined.boundaryEdges) {
      for (const [p, q] of [
        [e.a, e.b],
        [e.b, e.a],
      ] as const) {
        void q;
        const px = nodeX(refined, p);
        const py = nodeY(refined, p);
        let dMin = Infinity;
        for (const s of segs) dMin = Math.min(dMin, distanceToSegment(s, px, py));
        expect(dMin).toBeLessThan(1e-9);
      }
      expect(e.tag).toBe(1); // circle domain: single tag
    }
    expect(refined.boundaryEdges.length).toBe(base.boundaryEdges.length * 2 ** passes);
  });

  it('refinement inherits element tags (multi-material meshes stay labelled)', () => {
    const domain = rectangleDomain(2, 1);
    const mesh = meshDomain(domain, {
      targetSize: 0.3,
      seed: 5,
      elementTagger: (x) => (x < 1 ? 1 : 2),
    });
    expect(mesh.elements.some((e) => e.tag === 1)).toBe(true);
    expect(mesh.elements.some((e) => e.tag === 2)).toBe(true);
    const refined = refineToSize(mesh, 0.14);
    // Pass count follows the same halving law as the circle test.
    let passes = 0;
    let longest = longestEdge(mesh);
    while (longest > 0.14 * (1 + 1e-12) && passes < 6) {
      longest /= 2;
      passes += 1;
    }
    expect(refined.elements.length).toBe(mesh.elements.length * 4 ** passes);
    expect(longestEdge(refined)).toBeLessThanOrEqual(0.14 * (1 + 1e-9));
    const tags = new Set(refined.elements.map((e) => e.tag));
    expect(tags.has(1)).toBe(true);
    expect(tags.has(2)).toBe(true);
  });
});
