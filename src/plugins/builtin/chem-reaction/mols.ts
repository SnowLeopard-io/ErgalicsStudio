// ==========================================================================
// chem-reaction — molecular geometry library
//
// Real 3-D geometries (Angstrom) + bond orders for the small molecules used
// in the reaction catalog. Coordinates follow standard bond lengths / angles
// so the 3-D view is chemically reasonable and atoms never overlap. The
// reaction engine only needs the (element, bond-order) topology from these;
// coordinates drive the 3-D rendering and the reactant→product displacement.
// ==========================================================================

import type { Molecule, Atom, BondRecord } from '@/chem/structure';

export type Mol = Molecule;

function atom(symbol: string, x: number, y: number, z: number): Atom {
  return { symbol, x, y, z };
}
function bond(a: number, b: number, order = 1): BondRecord {
  return { a, b, order };
}
function mol(name: string, atoms: Atom[], bonds: BondRecord[]): Mol {
  return { name, atoms, bonds };
}

// ---- diatomics ------------------------------------------------------------
export const H2: Mol = mol('H2', [atom('H', 0, 0, 0), atom('H', 0.74, 0, 0)], [bond(0, 1)]);
export const O2: Mol = mol('O2', [atom('O', 0, 0, 0), atom('O', 1.21, 0, 0)], [bond(0, 1, 2)]);
export const N2: Mol = mol('N2', [atom('N', 0, 0, 0), atom('N', 1.1, 0, 0)], [bond(0, 1, 3)]);
export const Cl2: Mol = mol('Cl2', [atom('Cl', 0, 0, 0), atom('Cl', 1.99, 0, 0)], [bond(0, 1)]);
export const Br2: Mol = mol('Br2', [atom('Br', 0, 0, 0), atom('Br', 2.28, 0, 0)], [bond(0, 1)]);
export const HCl: Mol = mol('HCl', [atom('H', 0, 0, 0), atom('Cl', 1.27, 0, 0)], [bond(0, 1)]);

// ---- triatomic / polyatomic ----------------------------------------------
export const CO2: Mol = mol(
  'CO2',
  [atom('C', 0, 0, 0), atom('O', 1.16, 0, 0), atom('O', -1.16, 0, 0)],
  [bond(0, 1, 2), bond(0, 2, 2)],
);
export const H2O: Mol = mol(
  'H2O',
  [atom('O', 0, 0, 0), atom('H', 0.96, 0, 0), atom('H', -0.24, 0.93, 0)],
  [bond(0, 1), bond(0, 2)],
);
export const H2S: Mol = mol(
  'H2S',
  [atom('S', 0, 0, 0), atom('H', 1.34, 0, 0), atom('H', -0.05, 1.34, 0.09)],
  [bond(0, 1), bond(0, 2)],
);
export const NH3: Mol = mol(
  'NH3',
  [
    atom('N', 0, 0, 0.12),
    atom('H', 0, 0.94, -0.27),
    atom('H', 0.82, -0.47, -0.27),
    atom('H', -0.82, -0.47, -0.27),
  ],
  [bond(0, 1), bond(0, 2), bond(0, 3)],
);

// ---- tetrahedral carbon --------------------------------------------------
const TET = 0.629; // 1.09 Å corner
export const CH4: Mol = mol(
  'CH4',
  [
    atom('C', 0, 0, 0),
    atom('H', TET, TET, TET),
    atom('H', -TET, -TET, TET),
    atom('H', -TET, TET, -TET),
    atom('H', TET, -TET, -TET),
  ],
  [bond(0, 1), bond(0, 2), bond(0, 3), bond(0, 4)],
);
export const C2H4: Mol = mol(
  'C2H4',
  [
    atom('C', 0, 0, 0),
    atom('C', 1.34, 0, 0),
    atom('H', -0.55, 0.94, 0),
    atom('H', -0.55, -0.94, 0),
    atom('H', 1.89, 0.94, 0),
    atom('H', 1.89, -0.94, 0),
  ],
  [bond(0, 1, 2), bond(0, 2), bond(0, 3), bond(1, 4), bond(1, 5)],
);
export const C2H4Br2: Mol = mol(
  'C2H4Br2',
  [
    atom('C', 0, 0, 0),
    atom('C', 1.54, 0, 0),
    atom('Br', -1.02, 1.35, 0.35),
    atom('Br', 2.56, 1.35, -0.35),
    atom('H', -0.66, -0.77, 0.66),
    atom('H', 0.66, -0.77, -0.66),
    atom('H', 2.2, -0.77, 0.66),
    atom('H', 0.88, 0.77, 0.66),
  ],
  [bond(0, 1), bond(0, 2), bond(1, 3), bond(0, 4), bond(0, 5), bond(1, 6), bond(1, 7)],
);

// ---- organic molecules -----------------------------------------------------
// Real bond lengths / angles for the organic species used by the catalog's
// organic reactions: methyl/ethyl chains (tetrahedral carbon), a planar
// benzene ring, a permanganate anion and the ester/earboxylate products.

/** Benzene / arene rings centred on the origin, radius r; C0 sits at the "top". */
const RING_C0: Array<[number, number, number]> = [
  [0, -1.39, 0],
  [1.204, -0.695, 0],
  [1.204, 0.695, 0],
  [0, 1.39, 0],
  [-1.204, 0.695, 0],
  [-1.204, -0.695, 0],
];

export const C6H6: Mol = mol(
  'C6H6',
  [
    ...RING_C0.map(([x, y]) => atom('C', x, y, 0)),
    atom('H', 0, -2.48, 0),
    atom('H', 2.148, -1.24, 0),
    atom('H', 2.148, 1.24, 0),
    atom('H', 0, 2.48, 0),
    atom('H', -2.148, 1.24, 0),
    atom('H', -2.148, -1.24, 0),
  ],
  [
    bond(0, 1, 1), bond(1, 2, 2), bond(2, 3, 1), bond(3, 4, 2), bond(4, 5, 1), bond(5, 0, 2),
    bond(0, 6), bond(1, 7), bond(2, 8), bond(3, 9), bond(4, 10), bond(5, 11),
  ],
);

/** Cyclohexane: saturated hexagon ring, two H per carbon (axial/equatorial). */
export const C6H12: Mol = mol(
  'C6H12',
  [
    atom('C', 0, -1.54, 0),
    atom('C', 1.334, -0.77, 0),
    atom('C', 1.334, 0.77, 0),
    atom('C', 0, 1.54, 0),
    atom('C', -1.334, 0.77, 0),
    atom('C', -1.334, -0.77, 0),
    atom('H', 0, -1.54, 1.0), atom('H', 0, -1.54, -1.0),
    atom('H', 1.334, -0.77, 1.0), atom('H', 1.334, -0.77, -1.0),
    atom('H', 1.334, 0.77, 1.0), atom('H', 1.334, 0.77, -1.0),
    atom('H', 0, 1.54, 1.0), atom('H', 0, 1.54, -1.0),
    atom('H', -1.334, 0.77, 1.0), atom('H', -1.334, 0.77, -1.0),
    atom('H', -1.334, -0.77, 1.0), atom('H', -1.334, -0.77, -1.0),
  ],
  [
    bond(0, 1), bond(1, 2), bond(2, 3), bond(3, 4), bond(4, 5), bond(5, 0),
    bond(0, 6), bond(0, 7), bond(1, 8), bond(1, 9),
    bond(2, 10), bond(2, 11), bond(3, 12), bond(3, 13),
    bond(4, 14), bond(4, 15), bond(5, 16), bond(5, 17),
  ],
);

/** Toluene C₆H₅CH₃: benzene with a methyl on the ring's top carbon. */
export const C7H8: Mol = mol(
  'C7H8',
  [
    ...RING_C0.map(([x, y]) => atom('C', x, y, 0)),
    atom('C', 0, -2.9, 0), // methyl attached at ring C0 (top)
    ...([
      [0, -2.48, 0], // H on C1..C5 (C0 carries the methyl instead)
      [2.148, -1.24, 0],
      [2.148, 1.24, 0],
      [0, 2.48, 0],
      [-2.148, 1.24, 0],
      [-2.148, -1.24, 0],
    ] as Array<[number, number, number]>).map(([x, y]) => atom('H', x, y, 0)),
    atom('H', 0, -3.7, 0.77), atom('H', 0.77, -3.36, -0.44), atom('H', -0.77, -3.36, -0.44),
  ],
  [
    bond(0, 1, 1), bond(1, 2, 2), bond(2, 3, 1), bond(3, 4, 2), bond(4, 5, 1), bond(5, 0, 2),
    bond(0, 6),
    bond(1, 7), bond(2, 8), bond(3, 9), bond(4, 10), bond(5, 11),
    bond(6, 12), bond(6, 13), bond(6, 14),
  ],
);

export const C2H5OH: Mol = mol(
  'C2H5OH',
  [
    atom('C', 0, 0, 0),       // C1 (CH3)
    atom('C', 1.54, 0, 0),    // C2 (CH2)
    atom('O', 2.97, 0, 0),    // OH oxygen
    atom('H', -0.8, 0.8, 0),  // C1 H
    atom('H', -0.8, -0.8, 0), // C1 H
    atom('H', 0.5, 0, 0.9),   // C1 H
    atom('H', 2.3, 0.85, 0),  // C2 H
    atom('H', 2.3, -0.85, 0), // C2 H
    atom('H', 2.97, 0, 0.96), // O H
  ],
  [
    bond(0, 1), bond(1, 2), bond(2, 8),
    bond(0, 3), bond(0, 4), bond(0, 5),
    bond(1, 6), bond(1, 7),
  ],
);

export const CH3COOH: Mol = mol(
  'CH3COOH',
  [
    atom('C', 0, 0, 0),        // C1 methyl
    atom('C', 1.54, 0, 0),     // C2 carboxyl
    atom('O', 2.66, 0.7, 0),   // C=O
    atom('O', 2.66, -0.7, 0),  // C–O (OH)
    atom('H', 2.9, -1.6, 0),   // O–H
    atom('H', -0.77, 0.77, 0), // C1 H
    atom('H', -0.77, -0.77, 0), // C1 H
    atom('H', 0.7, 0, 0.9),    // C1 H
  ],
  [
    bond(0, 1), bond(1, 2, 2), bond(1, 3), bond(3, 4),
    bond(0, 5), bond(0, 6), bond(0, 7),
  ],
);

export const CH3COOC2H5: Mol = mol(
  'CH3COOC2H5',
  [
    atom('C', 0, 0, 0),        // C1 acetyl methyl
    atom('C', 1.54, 0, 0),     // C2 carbonyl
    atom('O', 2.77, 0.7, 0),   // C=O
    atom('O', 2.77, -0.7, 0),  // ester oxygen
    atom('C', 4.2, -0.7, 0),   // ethoxy CH2 (O–C 1.43)
    atom('C', 5.74, -0.7, 0),  // ethoxy CH3
    atom('H', -0.77, 0.77, 0), atom('H', -0.77, -0.77, 0), atom('H', 0.7, 0, 0.9),
    atom('H', 4.2, 0.0, 0.9), atom('H', 4.2, -1.7, 0),
    atom('H', 6.4, -0.1, 0), atom('H', 5.9, -1.7, 0), atom('H', 5.5, 0.1, 0.9),
  ],
  [
    bond(0, 1), bond(1, 2, 2), bond(1, 3), bond(3, 4), bond(4, 5),
    bond(0, 6), bond(0, 7), bond(0, 8),
    bond(4, 9), bond(4, 10),
    bond(5, 11), bond(5, 12), bond(5, 13),
  ],
);

export const C2H4O: Mol = mol(
  'CH3CHO',
  [
    atom('C', 0, 0, 0),        // C1 methyl
    atom('C', 1.54, 0, 0.1),   // C2 aldehyde
    atom('O', 2.66, 0.65, 0.1),// C=O
    atom('H', 2.0, -0.8, 0.1), // aldehyde H
    atom('H', -0.77, 0.77, 0), atom('H', -0.77, -0.77, 0), atom('H', 0.7, 0, 0.9),
  ],
  [
    bond(0, 1), bond(1, 2, 2), bond(1, 3),
    bond(0, 4), bond(0, 5), bond(0, 6),
  ],
);

export const CH3Cl: Mol = mol(
  'CH3Cl',
  [
    atom('C', 0, 0, 0),
    atom('Cl', 1.77, 0, 0),
    atom('H', TET, TET, TET),
    atom('H', -TET, -TET, TET),
    atom('H', -TET, TET, -TET),
  ],
  [bond(0, 1), bond(0, 2), bond(0, 3), bond(0, 4)],
);

// ---- oxidants / oxoanions (toluene → benzoic acid via permanganate) --------

export const KMnO4: Mol = mol(
  'KMnO4',
  [
    atom('K', 2.8, 0, 0),
    atom('Mn', 0, 0, 0),
    atom('O', 1.62, 0, 0),
    atom('O', -0.53, 1.53, 0),
    atom('O', -0.53, -0.76, 1.32),
    atom('O', -0.53, -0.76, -1.32),
  ],
  [bond(1, 2, 2), bond(1, 3, 2), bond(1, 4, 2), bond(1, 5, 2)],
);

export const C6H5COOK: Mol = mol(
  'C6H5COOK',
  [
    ...RING_C0.map(([x, y]) => atom('C', x, y, 0)), // ring C0..C5
    atom('C', 0, -2.9, 0),     // carboxyl C on ring C0
    atom('O', 1.23, -2.6, 0),  // C=O
    atom('O', -1.43, -2.6, 0), // C–O⁻
    atom('K', -1.43, -5.4, 0), // cation next to the alkoxide O
    // ring H on C1..C5 (C0 carries the carboxyl instead)
    atom('H', 2.148, -1.24, 0), atom('H', 2.148, 1.24, 0), atom('H', 0, 2.48, 0),
    atom('H', -2.148, 1.24, 0), atom('H', -2.148, -1.24, 0),
  ],
  [
    bond(0, 1, 1), bond(1, 2, 2), bond(2, 3, 1), bond(3, 4, 2), bond(4, 5, 1), bond(5, 0, 2),
    bond(0, 6), bond(6, 7, 2), bond(6, 8), bond(8, 9),
    // ring H's (10..14) → C1..C5 (1..5)
    bond(1, 10), bond(2, 11), bond(3, 12), bond(4, 13), bond(5, 14),
  ],
);

export const MnO2: Mol = mol(
  'MnO2',
  [atom('Mn', 0, 0, 0), atom('O', 1.6, 0.5, 0), atom('O', 1.6, -0.5, 0)],
  [bond(0, 1, 2), bond(0, 2, 2)],
);

export const KOH: Mol = mol(
  'KOH',
  [atom('K', 0, 0, 0), atom('O', 2.5, 0, 0), atom('H', 3.4, 0.7, 0)],
  [bond(0, 1), bond(1, 2)],
);

// ---- ionic salts (represented as ion-pair molecules for structure use) ----
export const NaCl: Mol = mol('NaCl', [atom('Na', 0, 0, 0), atom('Cl', 2.4, 0, 0)], [bond(0, 1)]);
export const NaOH: Mol = mol(
  'NaOH',
  [atom('Na', 0, 0, 0), atom('O', 2.1, 0, 0), atom('H', 3.06, 0, 0)],
  [bond(0, 1), bond(1, 2)],
);
export const CuO: Mol = mol('CuO', [atom('Cu', 0, 0, 0), atom('O', 1.85, 0, 0)], [bond(0, 1)]);
export const ZnCl2: Mol = mol(
  'ZnCl2',
  [atom('Zn', 0, 0, 0), atom('Cl', 1.95, 0, 0), atom('Cl', -1.95, 0, 0)],
  [bond(0, 1), bond(0, 2)],
);
export const CaO: Mol = mol('CaO', [atom('Ca', 0, 0, 0), atom('O', 1.95, 0, 0)], [bond(0, 1)]);
export const AgCl: Mol = mol('AgCl', [atom('Ag', 0, 0, 0), atom('Cl', 2.34, 0, 0)], [bond(0, 1)]);

export const CaCO3: Mol = mol(
  'CaCO3',
  [
    atom('Ca', 0, 0, 0),
    atom('C', 2.1, 0, 0),
    atom('O', 3.38, 0, 0),
    atom('O', 1.46, 1.11, 0),
    atom('O', 1.46, -1.11, 0),
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)],
);
export const AgNO3: Mol = mol(
  'AgNO3',
  [
    atom('Ag', 0, 0, 0),
    atom('N', 2.0, 0, 0),
    atom('O', 3.26, 0, 0),
    atom('O', 1.37, 1.09, 0),
    atom('O', 1.37, -1.09, 0),
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)],
);
export const NaNO3: Mol = mol(
  'NaNO3',
  [
    atom('Na', 0, 0, 0),
    atom('N', 2.1, 0, 0),
    atom('O', 3.36, 0, 0),
    atom('O', 1.47, 1.09, 0),
    atom('O', 1.47, -1.09, 0),
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)],
);

// ---- bare metal atoms (metallic / species without intra-species bonds) ----
export const Cu: Mol = mol('Cu', [atom('Cu', 0, 0, 0)], []);
export const Zn: Mol = mol('Zn', [atom('Zn', 0, 0, 0)], []);
export const Na: Mol = mol('Na', [atom('Na', 0, 0, 0)], []);