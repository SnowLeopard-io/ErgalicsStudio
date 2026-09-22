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
  ],
  [bond(0, 1), bond(0, 2), bond(1, 3), bond(0, 4), bond(0, 5), bond(1, 6)],
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