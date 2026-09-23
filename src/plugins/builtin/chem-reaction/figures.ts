// ==========================================================================
// chem-reaction — analysis figures pushed to Figure Studio (ni)
//
// Builds publication-grade PlotSpec panels for the current reaction and hands
// them to Figure Studio through the shared figure store, so the user can view,
// arrange and export each one (SVG / PNG / PDF) — exactly like the other labs.
//
// Charts delivered:
//   ΔG(T)          entropy signature: ΔG = ΔH − T·ΔS, slope = −ΔS. ΔS>0 gives a
//                  falling line (entropy-gaining, spontaneous when hot).
//   Arrhenius      ln k vs 1/T from the break-bond activation barrier.
//   van't Hoff     ln K vs 1/T → slope −ΔH°/R for endo/exothermic read-off.
//   Distribution   α–pH curves for any tabulated weak acid present.
//   Solubility     s vs added common ion for a Ksp salt product.
//   Reaction graph reactant atom network, bonds coloured by role — the atom map.
// ==========================================================================

import { useFigureStore } from '@/stores/figureStore';
import type { PlotSeries, PlotSpec } from '@/core/plot';
import { bondEnergy, gibbsEnergy, equilibriumConstant, R } from '@/chem/thermo';
import { buildMechanism, type Mechanism } from './mech';
import { equationOf, renderFormula } from './plugin';
import { getLocale } from '@/i18n';
import type { ReactionDef } from './catalog';
import type { PhysicsPayload } from './reactmd/types';

/** Locale-aware label: figures follow the active UI language when built. */
const isEn = () => getLocale() === 'en-US';
const L = (zhLabel: string, enLabel: string) => (isEn() ? enLabel : zhLabel);

const T_MIN = 200;
const T_MAX = 2200;
const T_N = 121;

const KEEP = '#94a3b8';
const BREAK = '#ff8a6a';
const FORM = '#4ade80';
const ZERO = '#cbd5e1';
const ALPHA_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea'];

// ---- thermochemistry-driven charts (any balanced reaction) ------------------

function tempTrace(cb: (T: number) => number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= T_N; i += 1) {
    const T = T_MIN + ((T_MAX - T_MIN) * i) / T_N;
    pts.push({ x: T, y: cb(T) });
  }
  return pts;
}

/** ΔG(T) trace; slope = −ΔS. Adds a ΔG=0 ruler and the spontaneity crossover. */
export function entropyGibbsSpec(def: ReactionDef): PlotSpec | null {
  const mech = buildMechanism(def);
  if (!mech.thermo) return null;
  const { dh, ds } = mech.thermo;
  const series: PlotSeries[] = [
    { name: 'ΔG(T)', kind: 'line', color: '#3b82f6', points: tempTrace((T) => gibbsEnergy(dh, ds, T)) },
    { name: 'ΔG = 0', kind: 'line', color: ZERO, dash: [5, 4], points: tempTrace(() => 0) },
  ];
  const crossing = ds !== 0 ? dh / (ds / 1000) : NaN;
  if (Number.isFinite(crossing) && crossing > 0 && crossing <= T_MAX) {
    series.push({
      name: `ΔG=0 @ ${Math.round(crossing)} K`,
      kind: 'scatter',
      color: '#ef4444',
      points: [{ x: crossing, y: 0 }],
    });
  }
  return {
    width: 760,
    height: 420,
    title: `${equationOf(def)} · ΔG°(T)`,
    xLabel: 'T / K',
    yLabel: 'ΔG° / kJ·mol⁻¹',
    xDomain: [T_MIN, T_MAX],
    legend: true,
    grid: true,
    series,
  };
}

/** Arrhenius plot: ln k = ln A − (Ea/R)·(1000/T). Slope −Ea/R, intercept ln A. */
export function arrheniusSpec(def: ReactionDef): PlotSpec | null {
  const mech = buildMechanism(def);
  if (!mech.thermo) return null;
  const ea = activationEnergy(mech);
  const lnA = Math.log(1e13);
  const points = tempTrace((T) => lnA - (ea / R) * (1000 / T));
  return {
    width: 760,
    height: 420,
    title: `Arrhenius · ln k vs 1000/T`,
    xLabel: '1000 / (T / K)',
    yLabel: 'ln k',
    legend: true,
    grid: true,
    series: [{ name: `k(T), Ea = ${Math.round(ea)} kJ/mol`, kind: 'line', color: '#a855f7', points }],
  };
}

/** van't Hoff: ln K = −(ΔH°/R)·(1000/T) + ΔS°/R. Slope −ΔH°/R. */
export function vanthoffSpec(def: ReactionDef): PlotSpec | null {
  const mech = buildMechanism(def);
  if (!mech.thermo) return null;
  const { dh, ds } = mech.thermo;
  const points = tempTrace((T) => Math.log(equilibriumConstant(gibbsEnergy(dh, ds, T), T)));
  return {
    width: 760,
    height: 420,
    title: `van't Hoff · ln K vs 1000/T`,
    xLabel: '1000 / (T / K)',
    yLabel: 'ln K',
    legend: true,
    grid: true,
    series: [
      { name: 'ln K(T)', kind: 'line', color: '#10b981', points },
      { name: 'ln K = 0', kind: 'line', color: ZERO, dash: [5, 4], points: tempTrace(() => 0) },
    ],
  };
}

// ---- distribution α–pH -------------------------------------------------------

/** pKa of common acids; each entry also lists display formulas per acid stage. */
const PKA: Record<string, { name: string; nameEn: string; pka: number[]; stages: string[] }> = {
  H2CO3: { name: '碳酸', nameEn: 'Carbonic acid', pka: [6.35, 10.33], stages: ['H₂CO₃', 'HCO₃⁻', 'CO₃²⁻'] },
  H3PO4: { name: '磷酸', nameEn: 'Phosphoric acid', pka: [2.15, 7.2, 12.35], stages: ['H₃PO₄', 'H₂PO₄⁻', 'HPO₄²⁻', 'PO₄³⁻'] },
  H2SO3: { name: '亚硫酸', nameEn: 'Sulfurous acid', pka: [1.9, 7.2], stages: ['H₂SO₃', 'HSO₃⁻', 'SO₃²⁻'] },
  CH3COOH: { name: '醋酸', nameEn: 'Acetic acid', pka: [4.76], stages: ['CH₃COOH', 'CH₃COO⁻'] },
  HF: { name: '氢氟酸', nameEn: 'Hydrofluoric acid', pka: [3.17], stages: ['HF', 'F⁻'] },
  HCN: { name: '氢氰酸', nameEn: 'Hydrocyanic acid', pka: [9.21], stages: ['HCN', 'CN⁻'] },
  H2S: { name: '氢硫酸', nameEn: 'Hydrosulfuric acid', pka: [7.0, 12.92], stages: ['H₂S', 'HS⁻', 'S²⁻'] },
  NH4: { name: '铵根', nameEn: 'Ammonium', pka: [9.25], stages: ['NH₄⁺', 'NH₃'] },
};

const normKey = (formula: string): string =>
  formula.replace(/[()+]/g, '').toUpperCase();

export function distributionSpec(def: ReactionDef): PlotSpec | null {
  const hit = [...def.reactants, ...def.products].find((s) => PKA[normKey(s.formula)]);
  if (!hit) return null;
  const entry = PKA[normKey(hit.formula)]!;
  const K = entry.pka.map((p) => Math.pow(10, -p));
  const nh = K.length; // number of acidic protons
  const pHs: number[] = [];
  for (let i = 0; i <= 140; i += 1) pHs.push(i / 10); // 0 … 14
  const alpha: Array<Array<number>> = Array.from({ length: nh + 1 }, () => pHs.map(() => 0));
  pHs.forEach((pH, j) => {
    const h = Math.pow(10, -pH);
    let denom = Math.pow(h, nh);
    for (let i = 1; i <= nh; i += 1) {
      let prod = 1;
      for (let m = 0; m < i; m += 1) prod *= K[m]!;
      denom += prod * Math.pow(h, nh - i);
    }
    for (let i = 0; i <= nh; i += 1) {
      let num = 1;
      for (let m = 0; m < i; m += 1) num *= K[m]!;
      alpha[i]![j] = denom > 0 ? (num * Math.pow(h, nh - i)) / denom : 0;
    }
  });
  const series: PlotSeries[] = alpha.map((vals, i) => ({
    name: entry.stages[i] ?? `α${i}`,
    kind: 'line',
    color: ALPHA_COLORS[i % ALPHA_COLORS.length]!,
    points: pHs.map((pH, j) => ({ x: pH, y: vals[j]! })),
  }));
  return {
    width: 760,
    height: 420,
    title: `${L(entry.name, entry.nameEn)} ${renderFormula(hit.formula)} ${L('分布系数 α–pH', 'distribution α–pH')}`,
    xLabel: 'pH',
    yLabel: L('α 分布系数', 'α fraction'),
    xDomain: [0, 14],
    yDomain: [0, 1.02],
    legend: true,
    grid: true,
    series,
  };
}

// ---- precipitation / Ksp -----------------------------------------------------

const KSP: Record<string, { name: string; nameEn: string; ksp: number }> = {
  AgCl: { name: '氯化银', nameEn: 'Silver chloride', ksp: 1.8e-10 },
  AgBr: { name: '溴化银', nameEn: 'Silver bromide', ksp: 5.4e-13 },
  AgI: { name: '碘化银', nameEn: 'Silver iodide', ksp: 8.5e-17 },
  CaCO3: { name: '碳酸钙', nameEn: 'Calcium carbonate', ksp: 3.4e-9 },
  BaSO4: { name: '硫酸钡', nameEn: 'Barium sulfate', ksp: 1.1e-10 },
  CaSO4: { name: '硫酸钙', nameEn: 'Calcium sulfate', ksp: 4.9e-5 },
  CuS: { name: '硫化铜', nameEn: 'Copper(II) sulfide', ksp: 6.3e-36 },
};

export function solubilitySpec(def: ReactionDef): PlotSpec | null {
  const solid = def.products.find((s) => KSP[s.formula]);
  if (!solid) return null;
  const { name, nameEn, ksp } = KSP[solid.formula]!;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= T_N; i += 1) {
    const c = Math.pow(10, -8 + (i * 10) / T_N); // added common ion 10⁻⁸…10² M
    points.push({ x: Math.log10(c), y: Math.sqrt(ksp) / Math.sqrt(1 + c / ksp) });
  }
  return {
    width: 760,
    height: 420,
    title: `${L(name, nameEn)} ${renderFormula(solid.formula)} ${L('溶解度随同离子变化', 'solubility vs common ion')} (Ksp = ${ksp.toExponential(1)})`,
    xLabel: L('lg c(同离子)', 'lg c(common ion)'),
    yLabel: L('溶解度 s / mol·L⁻¹', 'Solubility s / mol·L⁻¹'),
    yScale: 'log',
    grid: true,
    series: [{ name: `s(${renderFormula(solid.formula)})`, kind: 'line', color: '#0ea5e9', points }],
  };
}

// ---- reaction atom diagram ---------------------------------------------------

export function atomDiagramSpec(payload: PhysicsPayload): PlotSpec {
  const keep: PlotSeries = { name: L('保留键', 'keep'), kind: 'line', color: KEEP, points: [] };
  const brk: PlotSeries = { name: L('断裂键', 'break'), kind: 'line', color: BREAK, points: [] };
  const form: PlotSeries = { name: L('成键', 'form'), kind: 'line', color: FORM, dash: [6, 3], points: [] };
  for (const b of payload.bonds) {
    const p1 = { x: payload.atoms[b.a]!.x, y: payload.atoms[b.a]!.y };
    const p2 = { x: payload.atoms[b.b]!.x, y: payload.atoms[b.b]!.y };
    (b.kind === 'keep' ? keep : b.kind === 'break' ? brk : form).points!.push(p1, p2);
  }
  return {
    width: 760,
    height: 420,
    title: L('反应原子轨迹（灰 保留 · 橙 断裂 · 绿 成键）', 'Reaction atom map (gray keep · orange break · green form)'),
    xLabel: 'x / Å',
    yLabel: 'y / Å',
    legend: true,
    grid: true,
    series: [
      keep,
      brk,
      form,
      { name: L('原子', 'atoms'), kind: 'scatter', color: '#1e293b', points: payload.atoms.map((a) => ({ x: a.x, y: a.y })) },
    ],
  };
}

// ---- figure push -------------------------------------------------------------

/** Create (or reuse the active) Figure Studio sheet and add one panel. */
export function pushFigure(sheetName: string, spec: PlotSpec): boolean {
  const store = useFigureStore.getState();
  let sheetId = store.activeSheetId;
  if (!sheetId) sheetId = store.createSheet(sheetName);
  if (!sheetId) return false;
  store.addPanel(sheetId, spec);
  return true;
}

/** Push every applicable analysis figure for a reaction; returns pushed labels. */
export function pushAllFigures(
  def: ReactionDef,
  payload: PhysicsPayload | null,
  captionNote?: string,
): string[] {
  const sent: string[] = [];
  const store = useFigureStore.getState();
  let sheetId = store.activeSheetId;
  if (!sheetId) {
    sheetId = store.createSheet(L('化学反应分析', 'Chemical Reaction Analysis'));
  }
  if (sheetId && (def.nameZh || def.nameEn)) {
    // The balanced equation belongs in the caption once, not repeated atop
    // every subplot (keeps titles short so nothing clips or overlaps the tag).
    const note = captionNote ? ` — ${captionNote}` : '';
    store.updateSheet(sheetId, {
      caption: `${L(def.nameZh, def.nameEn)}: ${equationOf(def)}${note}`,
    });
  }
  const push = (spec: PlotSpec | null, label: string) => {
    if (spec && sheetId) store.addPanel(sheetId, spec);
    if (spec) sent.push(label);
  };
  push(entropyGibbsSpec(def), L('熵增熵减 ΔG(T)', "Entropy / ΔG(T)"));
  push(arrheniusSpec(def), 'Arrhenius ln k–1/T');
  push(vanthoffSpec(def), "van't Hoff ln K–1/T");
  push(distributionSpec(def), L('分布系数 α–pH', 'Distribution α–pH'));
  push(solubilitySpec(def), L('沉淀溶解 Ksp', 'Precipitation / Ksp'));
  if (payload) push(atomDiagramSpec(payload), L('反应原子图', 'Reaction atom map'));
  return sent;
}

// ---- helpers -----------------------------------------------------------------

/** Representative activation energy: strongest broken bond, else fallback 350. */
function activationEnergy(mech: Mechanism): number {
  let max = 0;
  for (const b of mech.broken) {
    const e = bondEnergy(b.symbolA, b.symbolB, b.order);
    if (e > max) max = e;
  }
  return max || 350;
}