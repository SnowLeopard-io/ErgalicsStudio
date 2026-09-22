// scripts/_completion.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// src/plugins/builtin/chem-reaction/mols.ts
function atom(symbol, x, y, z) {
  return { symbol, x, y, z };
}
function bond(a, b, order = 1) {
  return { a, b, order };
}
function mol(name, atoms, bonds) {
  return { name, atoms, bonds };
}
var H2 = mol("H2", [atom("H", 0, 0, 0), atom("H", 0.74, 0, 0)], [bond(0, 1)]);
var O2 = mol("O2", [atom("O", 0, 0, 0), atom("O", 1.21, 0, 0)], [bond(0, 1, 2)]);
var N2 = mol("N2", [atom("N", 0, 0, 0), atom("N", 1.1, 0, 0)], [bond(0, 1, 3)]);
var Cl2 = mol("Cl2", [atom("Cl", 0, 0, 0), atom("Cl", 1.99, 0, 0)], [bond(0, 1)]);
var Br2 = mol("Br2", [atom("Br", 0, 0, 0), atom("Br", 2.28, 0, 0)], [bond(0, 1)]);
var HCl = mol("HCl", [atom("H", 0, 0, 0), atom("Cl", 1.27, 0, 0)], [bond(0, 1)]);
var CO2 = mol(
  "CO2",
  [atom("C", 0, 0, 0), atom("O", 1.16, 0, 0), atom("O", -1.16, 0, 0)],
  [bond(0, 1, 2), bond(0, 2, 2)]
);
var H2O = mol(
  "H2O",
  [atom("O", 0, 0, 0), atom("H", 0.96, 0, 0), atom("H", -0.24, 0.93, 0)],
  [bond(0, 1), bond(0, 2)]
);
var H2S = mol(
  "H2S",
  [atom("S", 0, 0, 0), atom("H", 1.34, 0, 0), atom("H", -0.05, 1.34, 0.09)],
  [bond(0, 1), bond(0, 2)]
);
var NH3 = mol(
  "NH3",
  [
    atom("N", 0, 0, 0.12),
    atom("H", 0, 0.94, -0.27),
    atom("H", 0.82, -0.47, -0.27),
    atom("H", -0.82, -0.47, -0.27)
  ],
  [bond(0, 1), bond(0, 2), bond(0, 3)]
);
var TET = 0.629;
var CH4 = mol(
  "CH4",
  [
    atom("C", 0, 0, 0),
    atom("H", TET, TET, TET),
    atom("H", -TET, -TET, TET),
    atom("H", -TET, TET, -TET),
    atom("H", TET, -TET, -TET)
  ],
  [bond(0, 1), bond(0, 2), bond(0, 3), bond(0, 4)]
);
var C2H4 = mol(
  "C2H4",
  [
    atom("C", 0, 0, 0),
    atom("C", 1.34, 0, 0),
    atom("H", -0.55, 0.94, 0),
    atom("H", -0.55, -0.94, 0),
    atom("H", 1.89, 0.94, 0),
    atom("H", 1.89, -0.94, 0)
  ],
  [bond(0, 1, 2), bond(0, 2), bond(0, 3), bond(1, 4), bond(1, 5)]
);
var C2H4Br2 = mol(
  "C2H4Br2",
  [
    atom("C", 0, 0, 0),
    atom("C", 1.54, 0, 0),
    atom("Br", -1.02, 1.35, 0.35),
    atom("Br", 2.56, 1.35, -0.35),
    atom("H", -0.66, -0.77, 0.66),
    atom("H", 0.66, -0.77, -0.66),
    atom("H", 2.2, -0.77, 0.66)
  ],
  [bond(0, 1), bond(0, 2), bond(1, 3), bond(0, 4), bond(0, 5), bond(1, 6)]
);
var NaCl = mol("NaCl", [atom("Na", 0, 0, 0), atom("Cl", 2.4, 0, 0)], [bond(0, 1)]);
var NaOH = mol(
  "NaOH",
  [atom("Na", 0, 0, 0), atom("O", 2.1, 0, 0), atom("H", 3.06, 0, 0)],
  [bond(0, 1), bond(1, 2)]
);
var CuO = mol("CuO", [atom("Cu", 0, 0, 0), atom("O", 1.85, 0, 0)], [bond(0, 1)]);
var ZnCl2 = mol(
  "ZnCl2",
  [atom("Zn", 0, 0, 0), atom("Cl", 1.95, 0, 0), atom("Cl", -1.95, 0, 0)],
  [bond(0, 1), bond(0, 2)]
);
var CaO = mol("CaO", [atom("Ca", 0, 0, 0), atom("O", 1.95, 0, 0)], [bond(0, 1)]);
var AgCl = mol("AgCl", [atom("Ag", 0, 0, 0), atom("Cl", 2.34, 0, 0)], [bond(0, 1)]);
var CaCO3 = mol(
  "CaCO3",
  [
    atom("Ca", 0, 0, 0),
    atom("C", 2.1, 0, 0),
    atom("O", 3.38, 0, 0),
    atom("O", 1.46, 1.11, 0),
    atom("O", 1.46, -1.11, 0)
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)]
);
var AgNO3 = mol(
  "AgNO3",
  [
    atom("Ag", 0, 0, 0),
    atom("N", 2, 0, 0),
    atom("O", 3.26, 0, 0),
    atom("O", 1.37, 1.09, 0),
    atom("O", 1.37, -1.09, 0)
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)]
);
var NaNO3 = mol(
  "NaNO3",
  [
    atom("Na", 0, 0, 0),
    atom("N", 2.1, 0, 0),
    atom("O", 3.36, 0, 0),
    atom("O", 1.47, 1.09, 0),
    atom("O", 1.47, -1.09, 0)
  ],
  [bond(0, 1), bond(1, 2), bond(1, 3), bond(1, 4)]
);
var Cu = mol("Cu", [atom("Cu", 0, 0, 0)], []);
var Zn = mol("Zn", [atom("Zn", 0, 0, 0)], []);
var Na = mol("Na", [atom("Na", 0, 0, 0)], []);

// src/plugins/builtin/chem-reaction/catalog.ts
function sp(id, formula, stoich, molecule, thermoKey) {
  return { id, formula, stoich, molecule, thermoKey };
}
var REACTIONS = [
  {
    id: "cuo-h2",
    nameZh: "\u6C22\u6C14\u8FD8\u539F\u6C27\u5316\u94DC",
    nameEn: "Hydrogen reduces copper(II) oxide",
    classification: "redox",
    reactants: [sp("cuo", "CuO", 1, CuO, "CuO(s)"), sp("h2", "H2", 1, H2, "H2(g)")],
    products: [sp("cu", "Cu", 1, Cu, "Cu(s)"), sp("h2o", "H2O", 1, H2O, "H2O(g)")]
  },
  {
    id: "ch4-o2",
    nameZh: "\u7532\u70F7\u71C3\u70E7",
    nameEn: "Methane combustion",
    classification: "combustion",
    reactants: [sp("ch4", "CH4", 1, CH4, "CH4(g)"), sp("o2", "O2", 2, O2, "O2(g)")],
    products: [sp("co2", "CO2", 1, CO2, "CO2(g)"), sp("h2o", "H2O", 2, H2O, "H2O(g)")]
  },
  {
    id: "caco3-cao",
    nameZh: "\u78B3\u9178\u9499\u9AD8\u6E29\u5206\u89E3",
    nameEn: "CaCO\u2083 thermal decomposition",
    classification: "decomposition",
    reactants: [sp("caco3", "CaCO3", 1, CaCO3, "CaCO3(s)")],
    products: [sp("cao", "CaO", 1, CaO, "CaO(s)"), sp("co2", "CO2", 1, CO2, "CO2(g)")]
  },
  {
    id: "zn-hcl",
    nameZh: "\u950C\u4E0E\u7A00\u76D0\u9178\uFF08\u7F6E\u6362\uFF09",
    nameEn: "Zinc displaces hydrogen from HCl",
    classification: "single-replacement",
    reactants: [sp("zn", "Zn", 1, Zn), sp("hcl", "HCl", 2, HCl, "HCl(g)")],
    products: [sp("zncl2", "ZnCl2", 1, ZnCl2), sp("h2", "H2", 1, H2, "H2(g)")]
  },
  {
    id: "hcl-naoh",
    nameZh: "\u76D0\u9178\u4E2D\u548C\u6C22\u6C27\u5316\u94A0",
    nameEn: "HCl neutralises NaOH",
    classification: "neutralization",
    reactants: [sp("hcl", "HCl", 1, HCl, "HCl(g)"), sp("naoh", "NaOH", 1, NaOH, "NaOH(s)")],
    products: [sp("nacl", "NaCl", 1, NaCl, "NaCl(s)"), sp("h2o", "H2O", 1, H2O, "H2O(l)")]
  },
  {
    id: "agno3-nacl",
    nameZh: "\u785D\u9178\u94F6\u4E0E\u6C2F\u5316\u94A0\uFF08\u6C89\u6DC0\uFF09",
    nameEn: "AgNO\u2083 + NaCl \u2192 AgCl\u2193",
    classification: "precipitation",
    reactants: [sp("agno3", "AgNO3", 1, AgNO3, "AgNO3(s)"), sp("nacl", "NaCl", 1, NaCl, "NaCl(s)")],
    products: [sp("agcl", "AgCl", 1, AgCl, "AgCl(s)"), sp("nano3", "NaNO3", 1, NaNO3)]
  },
  {
    id: "nacl-electrolysis",
    nameZh: "\u7194\u878D\u6C2F\u5316\u94A0\u7535\u89E3",
    nameEn: "Molten NaCl electrolysis",
    classification: "electrolysis",
    reactants: [sp("nacl", "NaCl", 2, NaCl, "NaCl(s)")],
    products: [sp("na", "Na", 2, Na, "Na(s)"), sp("cl2", "Cl2", 1, Cl2, "Cl2(g)")]
  },
  {
    id: "c2h4-br2",
    nameZh: "\u4E59\u70EF\u4E0E\u6EB4\u7684\u52A0\u6210",
    nameEn: "Alkene addition: C\u2082H\u2084 + Br\u2082",
    classification: "addition",
    reactants: [sp("c2h4", "C2H4", 1, C2H4), sp("br2", "Br2", 1, Br2)],
    products: [sp("c2h4br2", "C2H4Br2", 1, C2H4Br2)]
  }
];

// src/chem/elements.ts
var MASS = {
  1: 1.008,
  2: 4.003,
  3: 6.94,
  4: 9.012,
  5: 10.81,
  6: 12.011,
  7: 14.007,
  8: 15.999,
  9: 18.998,
  10: 20.18,
  11: 22.99,
  12: 24.305,
  13: 26.982,
  14: 28.085,
  15: 30.974,
  16: 32.06,
  17: 35.45,
  18: 39.948,
  19: 39.098,
  20: 40.078,
  21: 44.956,
  22: 47.867,
  23: 50.942,
  24: 51.996,
  25: 54.938,
  26: 55.845,
  27: 58.933,
  28: 58.693,
  29: 63.546,
  30: 65.38,
  31: 69.723,
  32: 72.63,
  33: 74.922,
  34: 78.971,
  35: 79.904,
  36: 83.798,
  37: 85.468,
  38: 87.62,
  39: 88.906,
  40: 91.224,
  41: 92.906,
  42: 95.95,
  43: 98,
  44: 101.07,
  45: 102.91,
  46: 106.42,
  47: 107.87,
  48: 112.41,
  49: 114.82,
  50: 118.71,
  51: 121.76,
  52: 127.6,
  53: 126.9,
  54: 131.29,
  55: 132.91,
  56: 137.33,
  57: 138.91,
  58: 140.12,
  59: 140.91,
  60: 144.24,
  61: 145,
  62: 150.36,
  63: 151.96,
  64: 157.25,
  65: 158.93,
  66: 162.5,
  67: 164.93,
  68: 167.26,
  69: 168.93,
  70: 173.05,
  71: 174.97,
  72: 178.49,
  73: 180.95,
  74: 183.84,
  75: 186.21,
  76: 190.23,
  77: 192.22,
  78: 195.08,
  79: 196.97,
  80: 200.59,
  81: 204.38,
  82: 207.2,
  83: 208.98,
  84: 209,
  85: 210,
  86: 222,
  88: 226,
  92: 238.03
};
var OX = {
  H: { color: "#ffffff", radius: 0.31, en: 2.2, ox: [1, -1] },
  He: { color: "#d9ffff", radius: 0.28, en: 0, ox: [] },
  Li: { color: "#cc80ff", radius: 1.28, en: 0.98, ox: [1] },
  Be: { color: "#c2ff00", radius: 0.96, en: 1.57, ox: [2] },
  B: { color: "#ffb5b5", radius: 0.84, en: 2.04, ox: [3] },
  C: { color: "#909090", radius: 0.76, en: 2.55, ox: [4, 2, -4] },
  N: { color: "#3050f8", radius: 0.71, en: 3.04, ox: [5, 4, 3, 2, 1, -3] },
  O: { color: "#ff0d0d", radius: 0.66, en: 3.44, ox: [-2, -1] },
  F: { color: "#90e050", radius: 0.57, en: 3.98, ox: [-1] },
  Ne: { color: "#b3e3f5", radius: 0.58, en: 0, ox: [] },
  Na: { color: "#ab5cf2", radius: 1.66, en: 0.93, ox: [1] },
  Mg: { color: "#8aff00", radius: 1.41, en: 1.31, ox: [2] },
  Al: { color: "#bfa6a6", radius: 1.21, en: 1.61, ox: [3] },
  Si: { color: "#f0c8a0", radius: 1.11, en: 1.9, ox: [4, -4] },
  P: { color: "#ff8000", radius: 1.07, en: 2.19, ox: [5, 3, -3] },
  S: { color: "#ffff30", radius: 1.05, en: 2.58, ox: [6, 4, 2, -2] },
  Cl: { color: "#1ff01f", radius: 1.02, en: 3.16, ox: [7, 5, 3, 1, -1] },
  Ar: { color: "#80d1e3", radius: 1.06, en: 0, ox: [] },
  K: { color: "#8f40d4", radius: 2.03, en: 0.82, ox: [1] },
  Ca: { color: "#3dff00", radius: 1.76, en: 1, ox: [2] },
  Sc: { color: "#e6e6e6", radius: 1.7, en: 1.36, ox: [3] },
  Ti: { color: "#bfc2c7", radius: 1.6, en: 1.54, ox: [4, 3, 2] },
  V: { color: "#a6a6ab", radius: 1.53, en: 1.63, ox: [5, 4, 3, 2] },
  Cr: { color: "#8a99c7", radius: 1.39, en: 1.66, ox: [6, 3, 2] },
  Mn: { color: "#9c7ac7", radius: 1.39, en: 1.55, ox: [7, 4, 2] },
  Fe: { color: "#e06633", radius: 1.32, en: 1.83, ox: [3, 2] },
  Co: { color: "#f090a0", radius: 1.26, en: 1.88, ox: [3, 2] },
  Ni: { color: "#50d050", radius: 1.24, en: 1.91, ox: [2] },
  Cu: { color: "#c88033", radius: 1.32, en: 1.9, ox: [2, 1] },
  Zn: { color: "#7d80b0", radius: 1.22, en: 1.65, ox: [2] },
  Ga: { color: "#c28f8f", radius: 1.22, en: 1.81, ox: [3] },
  Ge: { color: "#668f8f", radius: 1.2, en: 2.01, ox: [4, 2] },
  As: { color: "#bd80e3", radius: 1.19, en: 2.18, ox: [5, 3, -3] },
  Se: { color: "#ffa100", radius: 1.2, en: 2.55, ox: [6, 4, -2] },
  Br: { color: "#a62929", radius: 1.2, en: 2.96, ox: [5, 1, -1] },
  Kr: { color: "#5cb8d1", radius: 1.16, en: 3, ox: [2] },
  Rb: { color: "#702eb0", radius: 2.2, en: 0.82, ox: [1] },
  Sr: { color: "#00ff00", radius: 1.95, en: 0.95, ox: [2] },
  Ag: { color: "#c0c0c0", radius: 1.45, en: 1.93, ox: [1] },
  Cd: { color: "#ffd98f", radius: 1.44, en: 1.69, ox: [2] },
  Sn: { color: "#668080", radius: 1.41, en: 1.96, ox: [4, 2] },
  Sb: { color: "#9e63b5", radius: 1.38, en: 2.05, ox: [5, 3, -3] },
  Te: { color: "#d47a00", radius: 1.35, en: 2.1, ox: [6, 4, -2] },
  I: { color: "#940094", radius: 1.33, en: 2.66, ox: [7, 5, 3, 1, -1] },
  Xe: { color: "#429eb0", radius: 1.3, en: 2.6, ox: [8, 6, 4, 2] },
  Ba: { color: "#00c900", radius: 2.15, en: 0.89, ox: [2] },
  Au: { color: "#ffd123", radius: 1.36, en: 2.54, ox: [3, 1] },
  Hg: { color: "#b8b8d0", radius: 1.32, en: 2, ox: [2, 1] },
  Pb: { color: "#575961", radius: 1.46, en: 2.33, ox: [4, 2] }
};
var SYMBOL_Z = {
  H: 1,
  He: 2,
  Li: 3,
  Be: 4,
  B: 5,
  C: 6,
  N: 7,
  O: 8,
  F: 9,
  Ne: 10,
  Na: 11,
  Mg: 12,
  Al: 13,
  Si: 14,
  P: 15,
  S: 16,
  Cl: 17,
  Ar: 18,
  K: 19,
  Ca: 20,
  Sc: 21,
  Ti: 22,
  V: 23,
  Cr: 24,
  Mn: 25,
  Fe: 26,
  Co: 27,
  Ni: 28,
  Cu: 29,
  Zn: 30,
  Ga: 31,
  Ge: 32,
  As: 33,
  Se: 34,
  Br: 35,
  Kr: 36,
  Rb: 37,
  Sr: 38,
  Ag: 47,
  Cd: 48,
  Sn: 50,
  Sb: 51,
  Te: 52,
  I: 53,
  Xe: 54,
  Ba: 56,
  Au: 79,
  Hg: 80,
  Pb: 82
};
function normalizeSymbol(raw) {
  const s = raw.trim();
  if (!s) return "";
  const base = s.replace(/[+\-0-9]/g, "");
  const cap = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  if (SYMBOL_Z[cap] != null) return cap;
  if (SYMBOL_Z[base] != null) return base;
  return base;
}
function elementData(symbol) {
  const sym = normalizeSymbol(symbol);
  const z = SYMBOL_Z[sym] ?? 0;
  const meta = OX[sym];
  return {
    z,
    mass: MASS[z] ?? 0,
    radius: meta?.radius ?? 0,
    color: meta?.color ?? "#8a97a8",
    electronegativity: meta?.en ?? 0,
    oxidationStates: meta?.ox ?? []
  };
}
var atomicMass = (symbol) => elementData(symbol).mass;
var covalentRadius = (symbol) => elementData(symbol).radius;

// src/chem/thermo.ts
var BOND_ENERGIES = {
  "H-H": 436,
  "H-F": 568,
  "H-Cl": 431,
  "H-Br": 366,
  "H-I": 298,
  "H-C": 414,
  "H-N": 391,
  "H-O": 463,
  "H-S": 339,
  "H-P": 318,
  "H-Si": 318,
  "C-C": 347,
  "C=C": 612,
  "C#C": 838,
  "C-O": 360,
  "C=O": 799,
  "C-N": 305,
  "C=N": 615,
  "C#N": 891,
  "C-Cl": 339,
  "C-F": 484,
  "C-Br": 285,
  "C-S": 272,
  "C-Si": 318,
  "N-N": 163,
  "N=N": 418,
  "N#N": 945,
  "N-O": 201,
  "N=O": 607,
  "N-H": 391,
  "O-O": 146,
  "O=O": 498,
  "O-H": 463,
  "O-Si": 466,
  "F-F": 158,
  "Cl-Cl": 243,
  "Br-Br": 193,
  "I-I": 151,
  "S-H": 339,
  "S=S": 418,
  "Si-Si": 226,
  "Si-O": 466,
  "Na-Cl": 409,
  "Na-O": 255,
  "Ca-O": 464,
  "Ca-C": 407,
  "C-O(CO2)": 804
};
var ORDER_SUFFIX = { 1: "", 2: "=", 3: "#" };
function bondEnergyKey(a, b, order = 1) {
  const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
  const suff = ORDER_SUFFIX[order] ?? "";
  const direct = `${lo}${suff}${hi}`.replace(/#/, "#");
  if (BOND_ENERGIES[direct]) return direct;
  if (BOND_ENERGIES[`${lo}-${hi}`]) return `${lo}-${hi}`;
  return `${direct}`;
}
function bondEnergy(a, b, order = 1) {
  const k = bondEnergyKey(a, b, order);
  return BOND_ENERGIES[k] ?? 0;
}

// src/plugins/builtin/chem-reaction/reactmd/payload.ts
var STEP = 3.6;
var REACT_PRODUCT_GAP = 4.5;
var DEFAULT_EA = 350;
var DEFAULT_STEPS = 5e3;
var DEFAULT_FRAMES = 360;
function expandCopies(species, cursor) {
  const copies = [];
  let x = cursor;
  for (const s of species) {
    for (let k = 0; k < s.stoich; k += 1) {
      let width = 0;
      for (const a of s.molecule.atoms) if (a.x > width) width = a.x;
      copies.push({ mol: s.molecule, baseX: x });
      x += width + STEP;
    }
  }
  return copies;
}
function flatten(copies) {
  const atoms = [];
  const syms = [];
  let extent = 0;
  for (const c of copies) {
    for (const a of c.mol.atoms) {
      atoms.push({ symbol: a.symbol, x: c.baseX + a.x, y: a.y, z: a.z });
      syms.push(a.symbol);
    }
    if (c.baseX > extent) extent = c.baseX;
  }
  extent += STEP;
  return { atoms, syms, extent };
}
function assignAtoms(rSyms, rDeg, pCount, pSyms, pDeg) {
  const freq = /* @__PURE__ */ new Map();
  for (const s of pSyms) freq.set(s, (freq.get(s) ?? 0) + 1);
  const order = pSyms.map((_, i) => i).sort((a, b) => {
    const fa = freq.get(pSyms[a]) ?? 0;
    const fb = freq.get(pSyms[b]) ?? 0;
    if (fa !== fb) return fa - fb;
    return (pDeg[b] ?? 0) - (pDeg[a] ?? 0);
  });
  const used = /* @__PURE__ */ new Set();
  const map = new Array(pCount).fill(-1);
  for (const p of order) {
    const sym = pSyms[p];
    let best = -1;
    let bestScore = Infinity;
    for (let r = 0; r < rSyms.length; r += 1) {
      if (used.has(r)) continue;
      if (rSyms[r] !== sym) continue;
      const score = Math.abs((rDeg[r] ?? 0) - (pDeg[p] ?? 0));
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best >= 0) {
      used.add(best);
      map[p] = best;
    }
  }
  return map;
}
function buildPhysicsPayload(def) {
  const reactCopies = expandCopies(def.reactants, 0);
  const rFlat = flatten(reactCopies);
  const reactAtoms = rFlat.atoms;
  const nR = reactAtoms.length;
  const xMean = reactAtoms.reduce((s, a) => s + a.x, 0) / Math.max(1, reactAtoms.length);
  for (const a of reactAtoms) a.x -= xMean;
  const rBondPairs = [];
  let gi = 0;
  for (const c of reactCopies) {
    for (const b of c.mol.bonds) {
      rBondPairs.push({ a: gi + b.a, b: gi + b.b, order: b.order ?? 1, r: 0 });
    }
    gi += c.mol.atoms.length;
  }
  const rDeg = degreesCount(def.reactants);
  const pCount = def.products.reduce((s, x) => s + x.stoich * x.molecule.atoms.length, 0);
  const prodCopies = expandCopies(def.products, rFlat.extent + REACT_PRODUCT_GAP);
  const pFlat = flatten(prodCopies);
  const prodAtoms = pFlat.atoms;
  for (const a of prodAtoms) a.x -= xMean;
  const pSyms = pFlat.syms;
  const pDeg = degreesCount(def.products);
  const assign = assignAtoms(rFlat.syms, rDeg, pCount, pSyms, pDeg);
  let pg = 0;
  const mappedPairs = [];
  for (const c of prodCopies) {
    for (const b of c.mol.bonds) {
      const ra = assign[pg + b.a];
      const rb = assign[pg + b.b];
      if (ra !== void 0 && ra >= 0 && rb !== void 0 && rb >= 0) mappedPairs.push({ a: ra, b: rb, order: b.order ?? 1 });
    }
    pg += c.mol.atoms.length;
  }
  const reactPairSet = new Set(rBondPairs.map((p) => key(p.a, p.b)));
  const bonds = [];
  const eqR0 = (a, b) => 1.1 * (covalentRadius(reactAtoms[a].symbol) + covalentRadius(reactAtoms[b].symbol));
  const makeBond = (a, b, order, kind, r0) => {
    const symA = reactAtoms[a].symbol;
    const symB = reactAtoms[b].symbol;
    const ea = bondEnergy(symA, symB, order) || DEFAULT_EA;
    bonds.push({ a, b, kind, order, ea, r0 });
  };
  const mappedOrder = /* @__PURE__ */ new Map();
  for (const mp of mappedPairs) {
    const k = key(mp.a, mp.b);
    mappedOrder.set(k, Math.max(mappedOrder.get(k) ?? 0, mp.order));
  }
  for (const rb of rBondPairs) {
    const k = key(rb.a, rb.b);
    const prodOrder = mappedOrder.get(k);
    const r0 = dist3(reactAtoms[rb.a], reactAtoms[rb.b]);
    if (prodOrder === void 0) {
      makeBond(rb.a, rb.b, rb.order, "break", r0);
      continue;
    }
    if (rb.order > prodOrder) {
      makeBond(rb.a, rb.b, prodOrder, "keep", eqR0(rb.a, rb.b));
      makeBond(rb.a, rb.b, rb.order - prodOrder, "break", eqR0(rb.a, rb.b));
    } else {
      makeBond(rb.a, rb.b, rb.order, "keep", r0);
    }
  }
  for (const mp of mappedPairs) {
    if (reactPairSet.has(key(mp.a, mp.b))) continue;
    makeBond(mp.a, mp.b, mp.order, "form", eqR0(mp.a, mp.b));
  }
  const target = new Array(nR).fill(null);
  for (let p = 0; p < pCount; p += 1) {
    const r = assign[p];
    if (r !== void 0 && r >= 0) target[r] = prodAtoms[p];
  }
  const mass = reactAtoms.map((a) => atomicMass(a.symbol));
  const radius = reactAtoms.map((a) => covalentRadius(a.symbol));
  return {
    payload: {
      atoms: reactAtoms,
      mass,
      radius,
      bonds,
      target,
      seed: 20260922
    },
    atomSymbols: rFlat.syms,
    reactantExtent: rFlat.extent,
    reaction: def.id
  };
}
function degreesCount(species) {
  const deg = [];
  let base = 0;
  for (const s of species) {
    for (let k = 0; k < s.stoich; k += 1) {
      const d = new Array(s.molecule.atoms.length).fill(0);
      for (const b of s.molecule.bonds) {
        d[b.a] += 1;
        d[b.b] += 1;
      }
      for (let i = 0; i < d.length; i += 1) deg[base + i] = d[i];
      base += s.molecule.atoms.length;
    }
  }
  return deg;
}
function key(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// scripts/_completion.mjs
var builds = [];
for (const def of REACTIONS) builds.push({ id: def.id, steps: DEFAULT_STEPS, frames: DEFAULT_FRAMES, payload: buildPhysicsPayload(def).payload });
var input = JSON.stringify(builds);
writeFileSync("scripts/_completion_input.json", input);
var out = execFileSync("python", ["scripts/_completion.py"], { input, encoding: "utf8" });
console.log(out);
