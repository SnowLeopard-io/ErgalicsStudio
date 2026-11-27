// ==========================================================================
// FEM core — P1 (linear) triangle shape functions and isoparametric mapping.
//
// For a CCW triangle with vertices p0, p1, p2 the barycentric (P1) basis
// functions λi satisfy λi(pj) = δij and λ0 + λ1 + λ2 = 1. Their gradients are
// constant over the element, which is all a P1 assembly needs.
// ==========================================================================

export interface TriBasis {
  /** Unsigned element area. */
  area: number;
  /** Signed area (positive when the nodes are CCW). */
  signedArea: number;
  /** Gradient of λi, flat [gx0, gy0, gx1, gy1, gx2, gy2]. */
  grad: Float64Array;
  /** Shape function values at the element centroid (all 1/3). */
  centroid: [number, number];
}

/**
 * Precompute the P1 basis data of one triangle from its vertex coordinates.
 * Works for any non-degenerate orientation; area is returned unsigned while
 * `signedArea` keeps the orientation information for callers that care.
 */
export function p1Basis(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): TriBasis {
  const signedArea = 0.5 * ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
  const area = Math.abs(signedArea);
  // ∇λ0 = (y1 - y2, x2 - x1) / (2A_signed); cyclic for the others. Using the
  // signed area makes the gradients orientation-independent.
  const gx0 = (y1 - y2) / (2 * signedArea);
  const gy0 = (x2 - x1) / (2 * signedArea);
  const gx1 = (y2 - y0) / (2 * signedArea);
  const gy1 = (x0 - x2) / (2 * signedArea);
  const gx2 = (y0 - y1) / (2 * signedArea);
  const gy2 = (x1 - x0) / (2 * signedArea);
  const grad = Float64Array.from([gx0, gy0, gx1, gy1, gx2, gy2]);
  return {
    area,
    signedArea,
    grad,
    centroid: [(x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3],
  };
}

/**
 * Evaluate the three P1 shape functions at a point (x, y) inside the
 * triangle (x0,y0)-(x1,y1)-(x2,y2). Returns barycentric coordinates
 * [λ0, λ1, λ2] with λ0 + λ1 + λ2 = 1 (valid anywhere in the plane).
 */
export function p1ShapeAt(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  x: number, y: number,
): [number, number, number] {
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (det === 0) return [Number.NaN, Number.NaN, Number.NaN];
  const l1 = ((x - x0) * (y2 - y0) - (y - y0) * (x2 - x0)) / det;
  const l2 = ((y - y0) * (x1 - x0) - (x - x0) * (y1 - y0)) / det;
  return [1 - l1 - l2, l1, l2];
}
