// ==========================================================================
// Engineering material library (SI by default)
//
// The study model stores properties as a flat record so any format adapter
// can round-trip unknown keys. This module supplies a small curated library
// plus the conventional property names the solvers understand:
//   E   Young's modulus            [Pa]
//   nu  Poisson ratio              [-]
//   rho density                    [kg/m³]
//   k   thermal conductivity       [W/(m·K)]
//   cp  specific heat capacity     [J/(kg·K)]
//   alpha thermal expansion        [1/K]
//   sy  yield strength             [Pa]
// A unit-system note lives in metadata; the numbers below are SI.
// ==========================================================================

import type { EngineeringMaterial } from './types';

export interface MaterialTemplate {
  id: string;
  name: string;
  nameI18n: { zh: string; en: string };
  /** Property key → SI value. */
  properties: Record<string, number>;
}

export const MATERIAL_PROPERTY_META: Record<
  string,
  { symbol: string; unit: string; labelZh: string; labelEn: string }
> = {
  E: { symbol: 'E', unit: 'Pa', labelZh: '弹性模量', labelEn: "Young's modulus" },
  nu: { symbol: 'ν', unit: '-', labelZh: '泊松比', labelEn: "Poisson's ratio" },
  rho: { symbol: 'ρ', unit: 'kg/m³', labelZh: '密度', labelEn: 'Density' },
  k: { symbol: 'k', unit: 'W/(m·K)', labelZh: '导热系数', labelEn: 'Thermal conductivity' },
  cp: { symbol: 'cₚ', unit: 'J/(kg·K)', labelZh: '比热容', labelEn: 'Specific heat' },
  alpha: { symbol: 'α', unit: '1/K', labelZh: '热膨胀系数', labelEn: 'Thermal expansion' },
  sy: { symbol: 'σy', unit: 'Pa', labelZh: '屈服强度', labelEn: 'Yield strength' },
};

export const MATERIAL_LIBRARY: MaterialTemplate[] = [
  {
    id: 'steel-q235',
    name: 'Q235 Steel',
    nameI18n: { zh: 'Q235 结构钢', en: 'Q235 Structural Steel' },
    properties: {
      E: 2.06e11,
      nu: 0.3,
      rho: 7850,
      k: 45,
      cp: 470,
      alpha: 1.2e-5,
      sy: 2.35e8,
    },
  },
  {
    id: 'stainless-304',
    name: 'Stainless Steel 304',
    nameI18n: { zh: '304 不锈钢', en: 'Stainless Steel 304' },
    properties: {
      E: 1.93e11,
      nu: 0.29,
      rho: 8000,
      k: 16.2,
      cp: 500,
      alpha: 1.7e-5,
      sy: 2.05e8,
    },
  },
  {
    id: 'aluminum-6061',
    name: 'Aluminum 6061-T6',
    nameI18n: { zh: '6061-T6 铝合金', en: 'Aluminum 6061-T6' },
    properties: {
      E: 6.9e10,
      nu: 0.33,
      rho: 2700,
      k: 167,
      cp: 896,
      alpha: 2.36e-5,
      sy: 2.76e8,
    },
  },
  {
    id: 'copper',
    name: 'Copper',
    nameI18n: { zh: '纯铜', en: 'Copper' },
    properties: {
      E: 1.1e11,
      nu: 0.34,
      rho: 8960,
      k: 401,
      cp: 385,
      alpha: 1.65e-5,
      sy: 7e7,
    },
  },
  {
    id: 'titanium-ti6al4v',
    name: 'Ti-6Al-4V',
    nameI18n: { zh: 'Ti-6Al-4V 钛合金', en: 'Ti-6Al-4V Titanium' },
    properties: {
      E: 1.14e11,
      nu: 0.34,
      rho: 4430,
      k: 6.7,
      cp: 526,
      alpha: 8.6e-6,
      sy: 8.8e8,
    },
  },
  {
    id: 'concrete-c30',
    name: 'Concrete C30',
    nameI18n: { zh: 'C30 混凝土', en: 'Concrete C30' },
    properties: {
      E: 3.0e10,
      nu: 0.2,
      rho: 2400,
      k: 1.28,
      cp: 880,
      alpha: 1.0e-5,
      sy: 2.0e7,
    },
  },
  {
    id: 'glass-soda',
    name: 'Soda-lime Glass',
    nameI18n: { zh: '钠钙玻璃', en: 'Soda-lime Glass' },
    properties: {
      E: 7.0e10,
      nu: 0.22,
      rho: 2500,
      k: 1.05,
      cp: 840,
      alpha: 9.0e-6,
      sy: 4.0e7,
    },
  },
];

export function templateById(id: string): MaterialTemplate | undefined {
  return MATERIAL_LIBRARY.find((item) => item.id === id);
}

/** Materialize a library template as an editable study material. */
export function materialFromTemplate(
  id: string,
  nameOverride?: string,
): EngineeringMaterial | null {
  const template = templateById(id);
  if (!template) return null;
  return {
    name: nameOverride ?? template.name,
    properties: { ...template.properties },
  };
}

/** Build a material from arbitrary properties (e.g. an Abaqus `*ELASTIC`). */
export function makeMaterial(
  name: string,
  properties: Record<string, number | number[]> = {},
): EngineeringMaterial {
  return { name, properties: { ...properties } };
}

/** Read one scalar property (arrays fall back to their first component). */
export function materialProperty(
  material: EngineeringMaterial | undefined,
  key: string,
  fallback: number,
): number {
  const value = material?.properties?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]!;
  return fallback;
}

/** Pick the material assigned to an element group tag, then the first one. */
export function resolveMaterial(
  materials: readonly EngineeringMaterial[],
  assignment: Record<string, string> | undefined,
  tag: number,
): EngineeringMaterial | undefined {
  const assignedName = assignment?.[String(tag)];
  if (assignedName) {
    const assigned = materials.find((material) => material.name === assignedName);
    if (assigned) return assigned;
  }
  return materials[0];
}

/** Assigning a material to a tag, returning a new assignment map. */
export function assignMaterial(
  assignment: Record<string, string> | undefined,
  tag: number,
  materialName: string,
): Record<string, string> {
  return { ...(assignment ?? {}), [String(tag)]: materialName };
}

/** Compact display string for a material's headline properties. */
export function materialSummary(material: EngineeringMaterial): string {
  const e = materialProperty(material, 'E', NaN);
  const nu = materialProperty(material, 'nu', NaN);
  const parts: string[] = [];
  if (Number.isFinite(e)) parts.push(`E=${formatEngineering(e)}Pa`);
  if (Number.isFinite(nu)) parts.push(`ν=${nu}`);
  return parts.join(' · ') || '—';
}

/** Human-friendly engineering notation (1.23e9 → 1.23 GPa). */
export function formatEngineering(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e9) return `${trim(value / 1e9)}G`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}k`;
  if (abs >= 1) return trim(value);
  return value.toExponential(2);
}

function trim(value: number): string {
  return Number(value.toPrecision(4)).toString();
}
