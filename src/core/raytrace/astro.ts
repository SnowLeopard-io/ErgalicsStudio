// ==========================================================================
// Shared astronomical computations (pure TypeScript, unit-tested).
//
// Sidereal time, solar/lunar positions, phase — low-precision formulas from
// Meeus (Astronomical Algorithms, ch. 25/47) and the USNO Almanac. Accurate
// to ~1 arcmin for the Sun, ~0.3° for the Moon — plenty for sky rendering
// and science-output metrics.
// ==========================================================================

/** Julian Day from a UTC date (valid across the Gregorian reform era). */
export function julianDay(date: Date): number {
  // Date.getUTCHours etc. give the civil UTC calendar; convert to JD.
  return date.getTime() / 86400000 + 2440587.5;
}

/** Greenwich Mean Sidereal Time (radians, 0..2π) for a given JD. */
export function gmst(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  // IAU 1982 GMST formula (Meeus 12.4), degrees → radians, wrapped.
  const deg =
    280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((deg % 360) + 360) % 360 * (Math.PI / 180);
}

export interface HorizontalPosition {
  /** Altitude above horizon, radians (−π/2..π/2). */
  alt: number;
  /** Azimuth from true north, radians eastward (0..2π). */
  az: number;
}

/** Converts equatorial (RA/Dec, radians) to local horizontal coordinates. */
export function equatorialToHorizontal(
  ra: number,
  dec: number,
  lst: number,
  latRad: number,
): HorizontalPosition {
  const h = lst - ra; // hour angle
  const sinAlt = Math.sin(dec) * Math.sin(latRad) + Math.cos(dec) * Math.cos(latRad) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimuth measured from north through east:
  // az = atan2(−cosδ·sinH, sinδ·cosφ − cosδ·sinφ·cosH)
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(h),
    Math.sin(dec) * Math.cos(latRad) - Math.cos(dec) * Math.sin(latRad) * Math.cos(h),
  );
  return { alt, az: ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/** Low-precision solar ecliptic longitude (Meeus ch. 25, ±0.01°). */
export function sunEclipticLongitude(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t; // mean longitude, deg
  const m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * (Math.PI / 180); // mean anomaly
  // Equation of center.
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * m) +
    0.000289 * Math.sin(3 * m);
  const trueLong = l0 + c;
  // Apparent longitude: nutation + aberration corrections (small, kept main term).
  const omega = (125.04 - 1934.136 * t) * (Math.PI / 180);
  const apparent = trueLong - 0.00569 - 0.00478 * Math.sin(omega);
  return ((apparent % 360) + 360) % 360;
}

/** Obliquity of the ecliptic (radians), IAU 1980 polynomial. */
export function obliquity(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  const eps =
    23.439291 - 0.0130042 * t - 1.64e-7 * t * t + 5.04e-7 * t * t * t;
  return eps * (Math.PI / 180);
}

/** Local solar position (alt/az, radians) for a UTC date and site. */
export function sunPosition(date: Date, latDeg: number, lonDeg: number): HorizontalPosition {
  const jd = julianDay(date);
  const lam = sunEclipticLongitude(jd) * (Math.PI / 180);
  const eps = obliquity(jd);
  // RA/dec from ecliptic longitude (Sun has zero ecliptic latitude).
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const lst = gmst(jd) + lonDeg * (Math.PI / 180);
  return equatorialToHorizontal(ra, dec, lst, latDeg * (Math.PI / 180));
}

/** Lunar ecliptic longitude/latitude + distance (Meeus ch. 47, main terms, ~0.3°). */
export function moonEcliptic(jd: number): { lon: number; lat: number; distKm: number } {
  const t = (jd - 2451545.0) / 36525.0;
  const d = (297.8501921 + 445267.1114034 * t) * (Math.PI / 180); // mean elongation
  const m = (357.5291092 + 35999.0502909 * t) * (Math.PI / 180); // sun mean anomaly
  const mp = (134.9633964 + 477198.8675055 * t) * (Math.PI / 180); // moon mean anomaly
  const f = (93.272095 + 483202.0175233 * t) * (Math.PI / 180); // argument of latitude
  const lonDeg =
    218.3164477 +
    481267.88123421 * t -
    6.28875 * Math.sin(mp) -
    1.27402 * Math.sin(2 * d - mp) +
    0.658309 * Math.sin(2 * d) -
    0.186208 * Math.sin(m) -
    0.059793 * Math.sin(2 * mp - 2 * d) -
    0.047137 * Math.sin(mp - 2 * d) +
    0.038657 * Math.sin(2 * mp) -
    0.031451 * Math.sin(2 * mp - d);
  const latDeg =
    5.128122 * Math.sin(f) +
    0.280602 * Math.sin(mp + f) +
    0.277693 * Math.sin(mp - f) +
    0.173237 * Math.sin(2 * d - f) -
    0.055413 * Math.sin(2 * d - mp + f) -
    0.046271 * Math.sin(2 * d - mp - f) +
    0.032573 * Math.sin(2 * d + f);
  // Distance (km): constant + main periodic term (Meeus 47.4, first terms).
  const distKm = 385000.56 - 20905.355 * Math.cos(mp) - 3699.111 * Math.cos(2 * d - mp);
  const wrap = (x: number) => ((x % 360) + 360) % 360;
  return { lon: wrap(lonDeg), lat: latDeg, distKm };
}

/** Local lunar position (alt/az, radians) for a UTC date and site. */
export function moonPosition(date: Date, latDeg: number, lonDeg: number): HorizontalPosition {
  const jd = julianDay(date);
  const { lon, lat } = moonEcliptic(jd);
  const eps = obliquity(jd);
  const lam = lon * (Math.PI / 180);
  const beta = lat * (Math.PI / 180);
  // Ecliptic → equatorial.
  const ra = Math.atan2(
    Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lam),
  );
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam));
  const lst = gmst(jd) + lonDeg * (Math.PI / 180);
  return equatorialToHorizontal(ra, dec, lst, latDeg * (Math.PI / 180));
}

/**
 * Illuminated fraction of the lunar disk (0..1) — Meeus 48.1 phase angle
 * approximated from the Sun–Moon elongation.
 */
export function moonPhaseIllumination(jd: number): number {
  const { lon: moonLon } = moonEcliptic(jd);
  const sunLon = sunEclipticLongitude(jd);
  const elongDeg = (((moonLon - sunLon) % 360) + 360) % 360;
  const psi = elongDeg * (Math.PI / 180);
  const k = (1 + Math.cos(psi)) / 2;
  return Math.max(0, Math.min(1, k));
}

/** Fractional lunar phase angle in degrees (0=new, 180=full), for science output. */
export function moonPhaseAngleDeg(jd: number): number {
  const { lon: moonLon } = moonEcliptic(jd);
  const sunLon = sunEclipticLongitude(jd);
  return (((moonLon - sunLon) % 360) + 360) % 360;
}

/**
 * Builds the equatorial → local-view rotation matrix (column-major 3×3 for
 * three.js `Matrix3.fromArray`). Given local sidereal time and site latitude,
 * rotates the procedural celestial sphere so it "斗转星移": a world direction
 * d (three.js convention: +y up, x/z ground plane) maps to the same direction
 * the real sky would show. We approximate the local sky by:
 *   x̂ = toward azimuth 0 (north), ẑ = toward azimuth 90° (east), ŷ = zenith.
 */
export function celestialRotationMatrix(lstRad: number, latRad: number): number[] {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  // Local unit vectors in the world frame (three.js: +y up; north = −z, east = +x).
  // North pole direction = (0, sinLat, −cosLat) [up-tilted toward north].
  // Zenith = (0, 1, 0); celestial equator sweeps in the plane containing
  // east and the equator-pole axis. Decompose as basis change:
  //   e_zenith = (0, 1, 0)
  //   e_north  = (0, sinLat, −cosLat)   (direction of the celestial pole)
  //   e_east   = (1, 0, 0)
  // A celestial direction (α, δ) maps to:
  //   dir = cosδ·sin(α−lst)·east + cosδ·cos(α−lst)·(rotated meridian) + sinδ·pole
  // Build the matrix M so M * eqDir = worldDir with eqDir columns (x=equinox
  // meridian, y=90°RA meridian, z=pole):
  const ha = -lstRad; // hour-angle offset baked into the matrix
  const sinHa = Math.sin(ha);
  const cosHa = Math.cos(ha);
  // World components of the celestial x̂ (RA = lst, dec = 0 → on meridian, south):
  // x: (cosHa·0 − sinHa·0 ... ) — computed via the rotation chain below.
  // Equatorial frame columns in the (east, meridian, pole) local frame first:
  //   col1 = (sinHa, cosHa·cosLat, −cosHa·sinLat)  → RA direction through meridian
  //   col2 = (cosHa, −sinHa·cosLat, sinHa·sinLat)
  //   col3 = (0, sinLat, cosLat)                   → north celestial pole
  // Then map (east, meridian, pole) → world (x, y, z):
  //   east = (1,0,0); meridian = (0,1,0) is zenith-south plane; pole tilts north.
  const c1x = sinHa, c1y = cosHa * cosLat, c1z = -cosHa * sinLat;
  const c2x = cosHa, c2y = -sinHa * cosLat, c2z = sinHa * sinLat;
  const c3x = 0, c3y = sinLat, c3z = cosLat;
  // Column-major 9-float array for Matrix3.fromArray.
  return [
    c1x, c1y, c1z,
    c2x, c2y, c2z,
    c3x, c3y, c3z,
  ];
}
