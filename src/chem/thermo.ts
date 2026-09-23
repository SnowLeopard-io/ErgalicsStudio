// ==========================================================================
// Physical-chemistry core — thermodynamics & kinetics
//
// Quantitative reaction energetics from standard data:
//   ΔH° via bond-dissociation enthalpies (bond additivity) or standard
//     enthalpies of formation (preferred when the species are tabulated),
//   ΔS° from standard molar entropies,
//   ΔG°(T) = ΔH° − T·ΔS°, K = exp(−ΔG°/RT),
//   Arrhenius rate constants k(T) = A·exp(−Ea/RT).
//
// All pure functions; unit tests in tests/chem/thermo.test.ts.
// ==========================================================================

// ---- bond-dissociation energies (kJ/mol), at 298 K ------------------------

export const BOND_ENERGIES: Record<string, number> = {
  'H-H': 436, 'H-F': 568, 'H-Cl': 431, 'H-Br': 366, 'H-I': 298,
  'H-C': 414, 'H-N': 391, 'H-O': 463, 'H-S': 339, 'H-P': 318,
  'H-Si': 318,
  'C-C': 347, 'C=C': 612, 'C#C': 838,
  'C-O': 360, 'C=O': 799, 'C-N': 305, 'C=N': 615, 'C#N': 891,
  'C-Cl': 339, 'C-F': 484, 'C-Br': 285, 'C-S': 272, 'C-Si': 318,
  'N-N': 163, 'N=N': 418, 'N#N': 945,
  'N-O': 201, 'N=O': 607, 'N-H': 391,
  'O-O': 146, 'O=O': 498, 'O-H': 463, 'O-Si': 466,
  'F-F': 158, 'Cl-Cl': 243, 'Br-Br': 193, 'I-I': 151,
  'S-H': 339, 'S=S': 418,
  'Si-Si': 226, 'Si-O': 466,
  'Na-Cl': 409, 'Na-O': 255, 'Ca-O': 464, 'Ca-C': 407, 'C-O(CO2)': 804,
};

const ORDER_SUFFIX: Record<number, string> = { 1: '', 2: '=', 3: '#' };

/** Look up a bond-energy key from two atom symbols and a bond order. */
export function bondEnergyKey(a: string, b: string, order = 1): string {
  const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
  const suff = ORDER_SUFFIX[order] ?? '';
  const direct = `${lo}${suff}${hi}`.replace(/#/, '#');
  // Prefer the explicit-typed key; fall back to generic single-bond lookup.
  if (BOND_ENERGIES[direct]) return direct;
  if (BOND_ENERGIES[`${lo}-${hi}`]) return `${lo}-${hi}`;
  return `${direct}`;
}

/** Bond-dissociation energy (kJ/mol), 0 when unknown. */
export function bondEnergy(a: string, b: string, order = 1): number {
  const k = bondEnergyKey(a, b, order);
  return BOND_ENERGIES[k] ?? 0;
}

// ---- standard thermochemical data (298 K) ---------------------------------

export interface ThermoSpecies {
  /** Standard enthalpy of formation, kJ/mol. */
  dhf: number;
  /** Standard molar entropy, J/mol·K. */
  s: number;
}

export const THERMO: Record<string, ThermoSpecies> = {
  'H2(g)': { dhf: 0, s: 130.7 },
  'H(g)': { dhf: 218.0, s: 114.7 },
  'O2(g)': { dhf: 0, s: 205.2 },
  'N2(g)': { dhf: 0, s: 191.6 },
  'Cl2(g)': { dhf: 0, s: 223.1 },
  'F2(g)': { dhf: 0, s: 202.8 },
  'C(s)': { dhf: 0, s: 5.7 },
  'C(diamond)': { dhf: 1.9, s: 2.4 },
  'Cu(s)': { dhf: 0, s: 33.2 },
  'Fe(s)': { dhf: 0, s: 27.3 },
  'Al(s)': { dhf: 0, s: 28.3 },
  'Na(s)': { dhf: 0, s: 51.3 },
  'H2O(l)': { dhf: -285.8, s: 69.9 },
  'H2O(g)': { dhf: -241.8, s: 188.8 },
  'CO2(g)': { dhf: -393.5, s: 213.8 },
  'CO(g)': { dhf: -110.5, s: 197.7 },
  'CH4(g)': { dhf: -74.8, s: 186.3 },
  'NH3(g)': { dhf: -45.9, s: 192.8 },
  'NO(g)': { dhf: 90.3, s: 210.8 },
  'NO2(g)': { dhf: 33.2, s: 240.1 },
  'SO2(g)': { dhf: -296.8, s: 248.2 },
  'SO3(g)': { dhf: -395.7, s: 256.8 },
  'HCl(g)': { dhf: -92.3, s: 186.9 },
  'HF(g)': { dhf: -273.3, s: 173.8 },
  'HBr(g)': { dhf: -36.4, s: 198.7 },
  'NaCl(s)': { dhf: -411.2, s: 72.1 },
  'NaCl(aq)': { dhf: -407.3, s: 115.5 },
  'NaOH(s)': { dhf: -425.8, s: 64.5 },
  'NaOH(aq)': { dhf: -469.2, s: 49.8 },
  'CuO(s)': { dhf: -157.3, s: 42.6 },
  'Cu2O(s)': { dhf: -168.6, s: 93.1 },
  'Fe2O3(s)': { dhf: -824.2, s: 87.4 },
  'Fe3O4(s)': { dhf: -1118.4, s: 146.4 },
  'Al2O3(s)': { dhf: -1675.7, s: 50.9 },
  'CaCO3(s)': { dhf: -1207.6, s: 92.9 },
  'CaO(s)': { dhf: -635.5, s: 39.8 },
  'Ca(OH)2(s)': { dhf: -986.1, s: 74.5 },
  'AgNO3(s)': { dhf: -124.4, s: 140.9 },
  'AgCl(s)': { dhf: -127.0, s: 96.2 },
  'CH3COOH(aq)': { dhf: -488.4, s: 124.3 },
  'CH3COO-(aq)': { dhf: -486.0, s: 86.6 },
  'C2H5OH(l)': { dhf: -277.4, s: 160.7 },
  'C2H5OH(g)': { dhf: -235.3, s: 282.7 },
  'CH3COOH(l)': { dhf: -484.5, s: 159.8 },
  'CH3COOC2H5(l)': { dhf: -442.5, s: 259.0 },
  'CH3CHO(l)': { dhf: -192.2, s: 251.2 },
  'CH3Cl(g)': { dhf: -83.7, s: 234.4 },
  'C2H4(g)': { dhf: 52.3, s: 219.6 },
  'C6H6(l)': { dhf: 49.0, s: 173.3 },
  'C6H12(l)': { dhf: -156.0, s: 204.3 },
  'C7H8(l)': { dhf: 12.0, s: 219.6 },
  'H+ (aq)': { dhf: 0, s: 0 },
  'OH-(aq)': { dhf: -230.0, s: -10.9 },
  'H2S(g)': { dhf: -20.6, s: 205.8 },
  'Cl-(aq)': { dhf: -167.2, s: 56.5 },
  'Na+(aq)': { dhf: -240.1, s: 59.0 },
  'Cu2+(aq)': { dhf: 64.8, s: -98.0 },
  'Fe2+(aq)': { dhf: -89.1, s: -137.7 },
  'Fe3+(aq)': { dhf: -48.5, s: -315.9 },
};

export function thermoSpecies(key: string): ThermoSpecies | undefined {
  if (THERMO[key]) return THERMO[key];
  for (const [k, v] of Object.entries(THERMO)) {
    if (stripState(k) === stripState(key)) return v;
  }
  return undefined;
}

function stripState(s: string): string {
  return s.replace(/\((g|l|s|aq)\)$/, '');
}

// ---- engines --------------------------------------------------------------

/** Ideal-gas constant, J/(mol·K). */
export const R = 8.314462618;
/** Standard temperature, K. */
export const T0 = 298.15;

/**
 * Enthalpy of reaction by bond-additivity approximation:
 *   ΔH° ≈ Σ E(bonds broken) − Σ E(bonds formed).
 * Returns null when any bond energy is unknown (caller should warn).
 */
export function bondEnthalpy(broken: Array<[string, string, number]>, formed: Array<[string, string, number]>): number | null {
  let sum = 0;
  for (const [a, b, o] of broken) {
    const e = bondEnergy(a, b, o);
    if (e <= 0) return null;
    sum += e;
  }
  for (const [a, b, o] of formed) {
    const e = bondEnergy(a, b, o);
    if (e <= 0) return null;
    sum -= e;
  }
  return sum;
}

/** Enthalpy of reaction from standard formation enthalpies: Σν·ΔHf°. kJ/mol. */
export function formationEnthalpy(terms: Array<{ stoich: number; species: string }>): number | null {
  let h = 0;
  for (const { stoich, species } of terms) {
    const t = thermoSpecies(species);
    if (!t) return null;
    h += stoich * t.dhf;
  }
  return h;
}

/** Entropy of reaction: Σν·S°. J/(mol·K). */
export function reactionEntropy(terms: Array<{ stoich: number; species: string }>): number | null {
  let s = 0;
  for (const { stoich, species } of terms) {
    const t = thermoSpecies(species);
    if (!t) return null;
    s += stoich * t.s;
  }
  return s;
}

/** Standard Gibbs energy for a given T: ΔG = ΔH − T·ΔS (kJ/mol). */
export function gibbsEnergy(dh: number, ds: number, temperatureK = T0): number {
  return dh - (temperatureK * ds) / 1000;
}

/** Equilibrium constant from Gibbs energy: K = exp(−ΔG/RT). */
export function equilibriumConstant(dgKj: number, temperatureK = T0): number {
  // ΔG in J/mol, R in J/mol·K
  return Math.exp((-dgKj * 1000) / (R * temperatureK));
}

/**
 * Arrhenius rate constant k(T) = A·exp(−Ea/RT). Ea in kJ/mol.
 * Return as a plain number (1/s) — typical units depend on reaction order.
 */
export function arrheniusRate(preExponential: number, activationKj: number, temperatureK = T0): number {
  return preExponential * Math.exp((-activationKj * 1000) / (R * temperatureK));
}

/** Exponential-scaled base-10 string for large/small numbers (e.g. "1.3e12"). */
export function formatSci(value: number): string {
  if (Number.isFinite(value) && Math.abs(value) !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e6)) {
    const exp = Math.floor(Math.log10(Math.abs(value)));
    const mant = value / 10 ** exp;
    return `${mant.toPrecision(3)}×10${sup(exp)}`;
  }
  return `${Math.round(value * 1000) / 1000}`;
}

function sup(n: number): string {
  const digits = String(Math.abs(n));
  const map: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const body = [...digits].map((c) => map[c]).join('');
  return n < 0 ? `⁻${body}` : body;
}