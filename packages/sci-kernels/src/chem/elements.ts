// ==========================================================================
// Physical-chemistry core — periodic-table data (pure, no DOM/three deps)
//
// Everything here is plain data + tiny helpers so the parsers, the reaction
// engine and the thermo engine can share one source of truth about element
// masses, CPK colours, covalent radii and common oxidation states.
// ==========================================================================

/** Static per-element properties used across the chem engine. */
export interface ElementData {
  /** Atomic number (Z). 0 for a generic / unknown species. */
  z: number;
  /** Standard atomic weight (g/mol), rounded. 0 when unknown. */
  mass: number;
  /** Covalent radius in Å (for connectivity inference). 0 when unknown. */
  radius: number;
  /** CPK ball colour for 3-D rendering. */
  color: string;
  /** Pauling electronegativity (0 when undefined). */
  electronegativity: number;
  /** Common oxidation states (zero for noble gases). */
  oxidationStates: number[];
}

// Atomic weights (IUPAC, standard). Verified values for elements 1–86 + 88.
const MASS: Record<number, number> = {
  1: 1.008, 2: 4.003, 3: 6.94, 4: 9.012, 5: 10.81, 6: 12.011, 7: 14.007, 8: 15.999,
  9: 18.998, 10: 20.18, 11: 22.99, 12: 24.305, 13: 26.982, 14: 28.085, 15: 30.974,
  16: 32.06, 17: 35.45, 18: 39.948, 19: 39.098, 20: 40.078, 21: 44.956, 22: 47.867,
  23: 50.942, 24: 51.996, 25: 54.938, 26: 55.845, 27: 58.933, 28: 58.693, 29: 63.546,
  30: 65.38, 31: 69.723, 32: 72.63, 33: 74.922, 34: 78.971, 35: 79.904, 36: 83.798,
  37: 85.468, 38: 87.62, 39: 88.906, 40: 91.224, 41: 92.906, 42: 95.95, 43: 98,
  44: 101.07, 45: 102.91, 46: 106.42, 47: 107.87, 48: 112.41, 49: 114.82, 50: 118.71,
  51: 121.76, 52: 127.6, 53: 126.9, 54: 131.29, 55: 132.91, 56: 137.33, 57: 138.91,
  58: 140.12, 59: 140.91, 60: 144.24, 61: 145, 62: 150.36, 63: 151.96, 64: 157.25,
  65: 158.93, 66: 162.5, 67: 164.93, 68: 167.26, 69: 168.93, 70: 173.05, 71: 174.97,
  72: 178.49, 73: 180.95, 74: 183.84, 75: 186.21, 76: 190.23, 77: 192.22, 78: 195.08,
  79: 196.97, 80: 200.59, 81: 204.38, 82: 207.2, 83: 208.98, 84: 209, 85: 210,
  86: 222, 88: 226, 92: 238.03,
};

interface OxData {
  color: string;
  radius: number;
  en: number;
  ox: number[];
}

// CPK colours (classic X-ray palette) + covalent radii (Å) + electronegativity
// + common oxidation states, curated for elements the engine actually handles
// in structures. A useful rendering baseline even for heavy-ish atoms.
const OX: Record<string, OxData> = {
  H:  { color: '#ffffff', radius: 0.31, en: 2.20, ox: [1, -1] },
  He: { color: '#d9ffff', radius: 0.28, en: 0,    ox: [] },
  Li: { color: '#cc80ff', radius: 1.28, en: 0.98, ox: [1] },
  Be: { color: '#c2ff00', radius: 0.96, en: 1.57, ox: [2] },
  B:  { color: '#ffb5b5', radius: 0.84, en: 2.04, ox: [3] },
  C:  { color: '#909090', radius: 0.76, en: 2.55, ox: [4, 2, -4] },
  N:  { color: '#3050f8', radius: 0.71, en: 3.04, ox: [5, 4, 3, 2, 1, -3] },
  O:  { color: '#ff0d0d', radius: 0.66, en: 3.44, ox: [-2, -1] },
  F:  { color: '#90e050', radius: 0.57, en: 3.98, ox: [-1] },
  Ne: { color: '#b3e3f5', radius: 0.58, en: 0,    ox: [] },
  Na: { color: '#ab5cf2', radius: 1.66, en: 0.93, ox: [1] },
  Mg: { color: '#8aff00', radius: 1.41, en: 1.31, ox: [2] },
  Al: { color: '#bfa6a6', radius: 1.21, en: 1.61, ox: [3] },
  Si: { color: '#f0c8a0', radius: 1.11, en: 1.90, ox: [4, -4] },
  P:  { color: '#ff8000', radius: 1.07, en: 2.19, ox: [5, 3, -3] },
  S:  { color: '#ffff30', radius: 1.05, en: 2.58, ox: [6, 4, 2, -2] },
  Cl: { color: '#1ff01f', radius: 1.02, en: 3.16, ox: [7, 5, 3, 1, -1] },
  Ar: { color: '#80d1e3', radius: 1.06, en: 0,    ox: [] },
  K:  { color: '#8f40d4', radius: 2.03, en: 0.82, ox: [1] },
  Ca: { color: '#3dff00', radius: 1.76, en: 1.00, ox: [2] },
  Sc: { color: '#e6e6e6', radius: 1.70, en: 1.36, ox: [3] },
  Ti: { color: '#bfc2c7', radius: 1.60, en: 1.54, ox: [4, 3, 2] },
  V:  { color: '#a6a6ab', radius: 1.53, en: 1.63, ox: [5, 4, 3, 2] },
  Cr: { color: '#8a99c7', radius: 1.39, en: 1.66, ox: [6, 3, 2] },
  Mn: { color: '#9c7ac7', radius: 1.39, en: 1.55, ox: [7, 4, 2] },
  Fe: { color: '#e06633', radius: 1.32, en: 1.83, ox: [3, 2] },
  Co: { color: '#f090a0', radius: 1.26, en: 1.88, ox: [3, 2] },
  Ni: { color: '#50d050', radius: 1.24, en: 1.91, ox: [2] },
  Cu: { color: '#c88033', radius: 1.32, en: 1.90, ox: [2, 1] },
  Zn: { color: '#7d80b0', radius: 1.22, en: 1.65, ox: [2] },
  Ga: { color: '#c28f8f', radius: 1.22, en: 1.81, ox: [3] },
  Ge: { color: '#668f8f', radius: 1.20, en: 2.01, ox: [4, 2] },
  As: { color: '#bd80e3', radius: 1.19, en: 2.18, ox: [5, 3, -3] },
  Se: { color: '#ffa100', radius: 1.20, en: 2.55, ox: [6, 4, -2] },
  Br: { color: '#a62929', radius: 1.20, en: 2.96, ox: [5, 1, -1] },
  Kr: { color: '#5cb8d1', radius: 1.16, en: 3.00, ox: [2] },
  Rb: { color: '#702eb0', radius: 2.20, en: 0.82, ox: [1] },
  Sr: { color: '#00ff00', radius: 1.95, en: 0.95, ox: [2] },
  Ag: { color: '#c0c0c0', radius: 1.45, en: 1.93, ox: [1] },
  Cd: { color: '#ffd98f', radius: 1.44, en: 1.69, ox: [2] },
  Sn: { color: '#668080', radius: 1.41, en: 1.96, ox: [4, 2] },
  Sb: { color: '#9e63b5', radius: 1.38, en: 2.05, ox: [5, 3, -3] },
  Te: { color: '#d47a00', radius: 1.35, en: 2.10, ox: [6, 4, -2] },
  I:  { color: '#940094', radius: 1.33, en: 2.66, ox: [7, 5, 3, 1, -1] },
  Xe: { color: '#429eb0', radius: 1.30, en: 2.60, ox: [8, 6, 4, 2] },
  Ba: { color: '#00c900', radius: 2.15, en: 0.89, ox: [2] },
  Au: { color: '#ffd123', radius: 1.36, en: 2.54, ox: [3, 1] },
  Hg: { color: '#b8b8d0', radius: 1.32, en: 2.00, ox: [2, 1] },
  Pb: { color: '#575961', radius: 1.46, en: 2.33, ox: [4, 2] },
};

// symbol → Z for everything OX knows about (plus a few mass-only atoms).
const SYMBOL_Z: Record<string, number> = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18, K: 19, Ca: 20,
  Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27, Ni: 28, Cu: 29, Zn: 30,
  Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36, Rb: 37, Sr: 38, Ag: 47,
  Cd: 48, Sn: 50, Sb: 51, Te: 52, I: 53, Xe: 54, Ba: 56, Au: 79, Hg: 80, Pb: 82,
};

/** Normalise an element string to its standard symbol (e.g. 'na'→'Na', 'C#'→'C'). */
export function normalizeSymbol(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  // Strip charge / isotope decorations like "Fe2+", "O-", "13C".
  const base = s.replace(/[+\-0-9]/g, '');
  const cap = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  if (SYMBOL_Z[cap] != null) return cap;
  if (SYMBOL_Z[base] != null) return base;
  return base;
}

/** Element data; returns a neutral default when the symbol is unknown. */
export function elementData(symbol: string): ElementData {
  const sym = normalizeSymbol(symbol);
  const z = SYMBOL_Z[sym] ?? 0;
  const meta = OX[sym];
  return {
    z,
    mass: MASS[z] ?? 0,
    radius: meta?.radius ?? 0,
    color: meta?.color ?? '#8a97a8',
    electronegativity: meta?.en ?? 0,
    oxidationStates: meta?.ox ?? [],
  };
}

/** Convenience accessors. */
export const atomicMass = (symbol: string): number => elementData(symbol).mass;
export const covalentRadius = (symbol: string): number => elementData(symbol).radius;
export const cpkColor = (symbol: string): string => elementData(symbol).color;
export const electronegativity = (symbol: string): number => elementData(symbol).electronegativity;
export const atomicNumber = (symbol: string): number => elementData(symbol).z;

/** Sum of formula molar mass from a composition map { symbol: count }. */
export function molarMass(composition: Record<string, number>): number {
  let m = 0;
  for (const [sym, n] of Object.entries(composition)) m += atomicMass(sym) * n;
  return m;
}