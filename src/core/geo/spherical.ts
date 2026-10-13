// ==========================================================================
// Ergalics Studio — spherical geometry helpers (core)
//
// Pure lon/lat math shared by the globe, earth and any geospatial plugin.
// No Three.js import: vectors are plain [x, y, z] triples so this module is
// safe to use from non-3-D code and unit tests.
// ==========================================================================

/** lon/lat (degrees) → position on a sphere of `radius`, Y-up convention:
 * the north pole is +Y and λ = 0 faces +X (λ = 90°E faces −Z). Pure. */
export function lonLatToVec3(lon: number, lat: number, radius = 1): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  return [radius * Math.cos(φ) * Math.cos(λ), radius * Math.sin(φ), -radius * Math.cos(φ) * Math.sin(λ)];
}

/** Great-circle angular distance between two (lon, lat) points, radians.
 * Uses 2·asin(‖a−b‖/2) rather than acos(a·b): acos loses half its digits
 * near dot = 1 (identical points come back as ~1.5e-8 rad), while asin is
 * accurate at both ends of the range. */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = lonLatToVec3(lon1, lat1);
  const b = lonLatToVec3(lon2, lat2);
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
}
