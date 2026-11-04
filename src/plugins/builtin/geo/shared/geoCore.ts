// ==========================================================================
// Shared numeric / parsing helpers for the geography plugin suite.
//
// Small, dependency-free utilities reused across several geo plugins
// (measure, GPX, interp, terrain): spherical geometry, a relaxed
// delimited-text reader and marching-squares contour tracing. Pure
// functions only so they unit-test without a canvas.
// ==========================================================================

export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;

// ---- Tissot indicatrix sampling (shared by tissot / globe) ------------------

type Vec3 = [number, number, number];

export function latLonToVec(lat: number, lon: number): Vec3 {
  const φ = lat * D2R;
  const λ = lon * D2R;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

export function vecToLatLon(v: Vec3): [number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / D2R;
  const lon = Math.atan2(v[1], v[0]) / D2R;
  return [lat, lon];
}

/**
 * Sample `samples` points on the small circle of angular radius `epsDeg`
 * centred at (lat, lon) — the Tissot indicatrix footprint on the sphere.
 * Points are returned as (lon, lat) — the same order every other dataset
 * (GeoJSON rings, graticule) uses, so they all flow through traceLine.
 */
export function tissotCircle(lat: number, lon: number, epsDeg: number, samples = 24): Array<[number, number]> {
  const c = latLonToVec(lat, lon);
  const sinφ = Math.sin(lat * D2R);
  const cosφ = Math.cos(lat * D2R);
  const sinλ = Math.sin(lon * D2R);
  const cosλ = Math.cos(lon * D2R);
  const east: Vec3 = [-sinλ, cosλ, 0];
  const north: Vec3 = [-sinφ * cosλ, -sinφ * sinλ, cosφ];
  const eps = epsDeg * D2R;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * 2 * Math.PI;
    const w = Math.cos(eps);
    const r = Math.sin(eps);
    const p: Vec3 = [
      w * c[0] + r * (Math.cos(t) * east[0] + Math.sin(t) * north[0]),
      w * c[1] + r * (Math.cos(t) * east[1] + Math.sin(t) * north[1]),
      w * c[2] + r * (Math.cos(t) * east[2] + Math.sin(t) * north[2]),
    ];
    const ll = vecToLatLon(p);
    out.push([ll[1], ll[0]]); // (lon, lat)
  }
  return out;
}

/** Great-circle distance between two (lat, lon) points in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Geodesic area of a polygon given as [ [lat, lon], ... ] (closed or open
 * ring; the closure is implied) via the Chamberlain–Duquette line integral
 * (the same formulation turf.js uses). Exact in the limit of short edges and
 * numerically robust down to classroom-scale shapes — unlike the interior-
 * angle-sum method, whose excess vanishes below double-precision noise for
 * small polygons. Rings enclosing a pole are out of scope for this studio.
 */
export function sphericalAreaKm2(ring: Array<[number, number]>): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const [lat1, lon1] = ring[i]!;
    const [lat2, lon2] = ring[(i + 1) % n]!;
    total += (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return (Math.abs(total) * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2;
}

export interface ContourSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Marching-squares contour segments for one level over a row-major field.
 * Cell size is 1 in field units — the caller maps to screen space.
 * Degenerate saddle cells resolve deterministically by averaging.
 */
export function marchingSquares(field: Float64Array, cols: number, rows: number, level: number): ContourSeg[] {
  const segs: ContourSeg[] = [];
  const at = (x: number, y: number): number => field[y * cols + x]!;
  const interp = (va: number, vb: number): number => {
    const d = va - vb;
    return Math.abs(d) < 1e-12 ? 0.5 : (va - level) / d;
  };
  for (let y = 0; y + 1 < rows; y += 1) {
    for (let x = 0; x + 1 < cols; x += 1) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      let idx = 0;
      if (tl > level) idx |= 8;
      if (tr > level) idx |= 4;
      if (br > level) idx |= 2;
      if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const topX = x + interp(tl, tr);
      const topY = y;
      const botX = x + interp(bl, br);
      const botY = y + 1;
      const leftX = x;
      const leftY = y + interp(tl, bl);
      const rightX = x + 1;
      const rightY = y + interp(tr, br);
      const push = (x1: number, y1: number, x2: number, y2: number) => segs.push({ x1, y1, x2, y2 });
      switch (idx) {
        case 1:
        case 14:
          push(leftX, leftY, botX, botY);
          break;
        case 2:
        case 13:
          push(botX, botY, rightX, rightY);
          break;
        case 3:
        case 12:
          push(leftX, leftY, rightX, rightY);
          break;
        case 4:
        case 11:
          push(topX, topY, rightX, rightY);
          break;
        case 6:
        case 9:
          push(topX, topY, botX, botY);
          break;
        case 7:
        case 8:
          push(leftX, leftY, topX, topY);
          break;
        case 5:
          push(leftX, leftY, topX, topY);
          push(botX, botY, rightX, rightY);
          break;
        case 10:
          push(topX, topY, rightX, rightY);
          push(leftX, leftY, botX, botY);
          break;
        default:
          break;
      }
    }
  }
  return segs;
}
