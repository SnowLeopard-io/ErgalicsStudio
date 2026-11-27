// ==========================================================================
// Atmospheric-optics helpers shared by the sky / ocean / misty renderers.
//
// Pure functions only — no GPU, no state — so every scene agrees on air mass,
// twilight banding, meteorological visibility and the colour of the beam.
// ==========================================================================

/** Kasten & Young (1989) relative optical air mass; null at/below the horizon. */
export function airmassKastenYoung(altDeg: number): number | null {
  if (altDeg <= 0) return null;
  const z = 90 - Math.min(altDeg, 90);
  return 1 / (Math.cos((z * Math.PI) / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

export type TwilightClass = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

/** Twilight bands by solar altitude (standard definitions). */
export function twilightClass(altDeg: number): TwilightClass {
  if (altDeg > 0) return 'day';
  if (altDeg > -6) return 'civil';
  if (altDeg > -12) return 'nautical';
  if (altDeg > -18) return 'astronomical';
  return 'night';
}

/**
 * Koschmieder (1924) meteorological visibility range: the distance at which a
 * black target against the horizon sky falls to 2 % contrast, V = 3.912 / β.
 */
export function koschmiederVisibility(extinctionPerM: number): number {
  return 3.912 / Math.max(extinctionPerM, 1e-9);
}

/**
 * Aerial-perspective slider 0..1 → extinction coefficient (1/m).
 * 0 ≈ 330 km visibility (crystal air), 1 ≈ 34 km (maritime haze).
 */
export function hazeToExtinction(haze: number): number {
  const h = Math.min(Math.max(haze, 0), 1);
  return (1.2 + 10.4 * h) * 1e-5;
}

/**
 * Tint and dimming of the direct beam versus its altitude (radians).
 * Reddens towards the horizon (longer Rayleigh path) and fades below it.
 */
export function sunDiskTint(altRad: number): { rgb: [number, number, number]; dim: number } {
  const s = Math.sin(altRad);
  const warm = Math.min(Math.max((0.22 - s) / 0.22, 0), 1);
  const dim = 0.14 + 0.86 * Math.min(Math.max((s + 0.06) / 0.3, 0), 1);
  return { rgb: [1, 1 - 0.52 * warm, 1 - 0.8 * warm], dim };
}
