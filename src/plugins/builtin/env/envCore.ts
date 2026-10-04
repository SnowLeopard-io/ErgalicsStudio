// ==========================================================================
// Shared numeric / parsing kernels for the environmental-science plugin
// suite. Pure, dependency-free functions only so they unit-test without a
// canvas or a 3-D context (mirrors geo/geoCore.ts for the geo suite).
//
// Standards & models referenced (hard-coded teaching defaults, PRD §8):
//   - AQI:    HJ 633-2012 / GB 3095-2012 breakpoints (CN) and the 2024 US
//             EPA AQI breakpoints (US), unit-converted at 25 °C / 1 atm.
//   - Water:  GB 3838-2002 surface-water class Ⅰ–Ⅴ limits (river values).
//   - WQI:    weighted-arithmetic WQI (Chatterjee & Raziuddin rating bands).
//   - Greenhouse: Myhre et al. 1998 radiative forcing, λ sensitivity.
//   - Plume:  Pasquill–Gifford open-country σy/σz (Turner 1970) + Gaussian
//             plume with ground reflection.
// ==========================================================================

/** Locale helper used by every env plugin. */
export function isZh(locale: string): boolean {
  return locale === 'zh-CN';
}

// ---- shared CSV ----------------------------------------------------------

/**
 * Relaxed delimited-text reader: rows on newlines, cells on commas
 * (semicolon/tab also accepted), blank lines and `#`/`//` comments dropped.
 */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    rows.push(line.split(/[,;\t]+/).map((c) => c.trim()));
  }
  return rows;
}

/** Drop a leading header row when no cell parses as a finite number. */
export function stripHeaderIfNonNumeric(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const looksNumeric = rows[0]!.some((c) => c !== '' && Number.isFinite(Number(c)));
  return looksNumeric ? rows : rows.slice(1);
}

/** Case-insensitive column resolver against a list of alias patterns. */
export function findColumn(header: string[], aliases: RegExp[]): number {
  for (const re of aliases) {
    const i = header.findIndex((c) => re.test(c));
    if (i >= 0) return i;
  }
  return -1;
}

/** Parse one cell as a finite number; empty/NaN → null. */
export function numCell(cell: string | undefined): number | null {
  if (cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

// ==========================================================================
// Module 1 — Air quality (AQI)
// ==========================================================================

export type AqiPollutant = 'so2' | 'no2' | 'pm25' | 'pm10' | 'co' | 'o3';

/** IAQI breakpoints: [C_low, C_high, I_low, I_high] segments, ascending. */
export type Breakpoint = [number, number, number, number];

/** GB/HJ 633-2012 24-hour breakpoints. SO₂/NO₂/PM/CO daily; O₃ 8-hour max. */
export const CN_BREAKPOINTS: Record<AqiPollutant, Breakpoint[]> = {
  so2: [
    [0, 50, 0, 50],
    [50, 150, 50, 100],
    [150, 475, 100, 150],
    [475, 800, 150, 200],
    [800, 1600, 200, 300],
    [1600, 2100, 300, 400],
    [2100, 2620, 400, 500],
  ],
  no2: [
    [0, 40, 0, 50],
    [40, 80, 50, 100],
    [80, 180, 100, 150],
    [180, 280, 150, 200],
    [280, 565, 200, 300],
    [565, 750, 300, 400],
    [750, 940, 400, 500],
  ],
  pm25: [
    [0, 35, 0, 50],
    [35, 75, 50, 100],
    [75, 115, 100, 150],
    [115, 150, 150, 200],
    [150, 250, 200, 300],
    [250, 350, 300, 400],
    [350, 500, 400, 500],
  ],
  pm10: [
    [0, 50, 0, 50],
    [50, 150, 50, 100],
    [150, 250, 100, 150],
    [250, 350, 150, 200],
    [350, 420, 200, 300],
    [420, 500, 300, 400],
    [500, 600, 400, 500],
  ],
  co: [
    [0, 2, 0, 50],
    [2, 4, 50, 100],
    [4, 14, 100, 150],
    [14, 24, 150, 200],
    [24, 36, 200, 300],
    [36, 48, 300, 400],
    [48, 60, 400, 500],
  ],
  o3: [
    [0, 100, 0, 50],
    [100, 160, 50, 100],
    [160, 215, 100, 150],
    [215, 265, 150, 200],
    [265, 800, 200, 300],
  ],
};

/**
 * 2024-updated US EPA AQI breakpoints, converted to the same reporting units
 * as the CN table (SO₂/NO₂/O₃ μg/m³, CO mg/m³) at 25 °C / 1 atm
 * (ppb = μg/m³ × 24.45 / MW). SO₂ uses the 1-hour standard, O₃ the 8-hour.
 */
export const US_BREAKPOINTS: Record<AqiPollutant, Breakpoint[]> = {
  so2: [
    [0, 97, 0, 50],
    [97, 196, 50, 100],
    [196, 484, 100, 150],
    [484, 795, 150, 200],
    [795, 1580, 200, 300],
    [1580, 2080, 300, 400],
    [2080, 2620, 400, 500],
  ],
  no2: [
    [0, 53, 0, 50],
    [53, 100, 50, 100],
    [100, 360, 100, 150],
    [360, 649, 150, 200],
    [649, 1249, 200, 300],
    [1249, 1649, 300, 400],
    [1649, 2049, 400, 500],
  ],
  pm25: [
    [0, 9, 0, 50],
    [9, 35.4, 50, 100],
    [35.4, 55.4, 100, 150],
    [55.4, 125.4, 150, 200],
    [125.4, 225.4, 200, 300],
    [225.4, 325.4, 300, 400],
    [325.4, 500, 400, 500],
  ],
  pm10: [
    [0, 54, 0, 50],
    [54, 154, 50, 100],
    [154, 254, 100, 150],
    [254, 354, 150, 200],
    [354, 424, 200, 300],
    [424, 504, 300, 400],
    [504, 604, 400, 500],
  ],
  co: [
    [0, 4.4, 0, 50],
    [4.4, 9.4, 50, 100],
    [9.4, 12.4, 100, 150],
    [12.4, 17.4, 150, 200],
    [17.4, 34, 200, 300],
    [34, 46, 300, 400],
    [46, 60, 400, 500],
  ],
  o3: [
    [0, 54, 0, 50],
    [54, 70, 50, 100],
    [70, 85, 100, 150],
    [85, 105, 150, 200],
    [105, 200, 200, 300],
    [200, 404, 300, 400],
    [404, 504, 400, 500],
  ],
};

/** Human-readable pollutant keys (zh/en) — index-aligned pairs. */
export const POLLUTANT_LABELS: Record<AqiPollutant, { zh: string; en: string }> = {
  so2: { zh: 'SO₂', en: 'SO₂' },
  no2: { zh: 'NO₂', en: 'NO₂' },
  pm25: { zh: 'PM2.5', en: 'PM2.5' },
  pm10: { zh: 'PM10', en: 'PM10' },
  co: { zh: 'CO', en: 'CO' },
  o3: { zh: 'O₃', en: 'O₃' },
};

/** Segment-linear IAQI per HJ 633-2012 §2 (clamped to the table). */
export function iaqi(bps: Breakpoint[], c: number): number | null {
  if (c < 0) return null;
  for (const [cl, ch, il, ih] of bps) {
    if (c <= ch) {
      if (c <= cl && cl === 0) return il;
      return il + ((ih - il) * (c - cl)) / (ch - cl);
    }
  }
  return null; // beyond the highest breakpoint → out of evaluation range
}

export type AqiStandard = 'cn' | 'us';

export interface AqiInput {
  so2?: number | null;
  no2?: number | null;
  pm25?: number | null;
  pm10?: number | null;
  co?: number | null;
  o3?: number | null;
}

export interface AqiResult {
  /** Overall AQI (max IAQI); null when no pollutant is evaluable. */
  aqi: number | null;
  /** Primary pollutant key (the max-IAQI one). */
  primary: AqiPollutant | null;
  /** Per-pollutant IAQI; out-of-range pollutants report `Infinity`-free `null` + flag. */
  iaqis: Partial<Record<AqiPollutant, number>>;
  /** Pollutants whose concentration exceeded the top breakpoint. */
  outOfRange: AqiPollutant[];
  /** Pollutants excluded entirely (negative/non-numeric) after cleaning. */
  dropped: AqiPollutant[];
}

/** Piecewise-linear IAQI for every pollutant, then AQI = max. */
export function computeAqi(input: AqiInput, standard: AqiStandard = 'cn'): AqiResult {
  const table = standard === 'us' ? US_BREAKPOINTS : CN_BREAKPOINTS;
  const iaqis: Partial<Record<AqiPollutant, number>> = {};
  const outOfRange: AqiPollutant[] = [];
  const dropped: AqiPollutant[] = [];
  const keys = Object.keys(table) as AqiPollutant[];
  for (const key of keys) {
    const raw = input[key];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    if (raw < 0) {
      dropped.push(key);
      continue;
    }
    const v = iaqi(table[key]!, raw);
    if (v === null) outOfRange.push(key);
    else iaqis[key] = v;
  }
  let aqi: number | null = null;
  let primary: AqiPollutant | null = null;
  for (const [k, v] of Object.entries(iaqis)) {
    if (v !== undefined && (aqi === null || v > aqi)) {
      aqi = v;
      primary = k as AqiPollutant;
    }
  }
  return { aqi, primary, iaqis, outOfRange, dropped };
}

export interface AqiBand {
  zh: string;
  en: string;
  color: string;
  /** Health advice (zh/en). */
  adviceZh: string;
  adviceEn: string;
}

/** Six GB-style AQI bands (also used for the US scale, per EPA colour names). */
export const AQI_BANDS: Array<{ max: number; band: AqiBand }> = [
  {
    max: 50,
    band: {
      zh: '优',
      en: 'Good',
      color: '#40c463',
      adviceZh: '空气质量令人满意，基本无空气污染，各类人群可正常活动。',
      adviceEn: 'Air quality is satisfactory; air pollution poses little or no risk.',
    },
  },
  {
    max: 100,
    band: {
      zh: '良',
      en: 'Moderate',
      color: '#d4c447',
      adviceZh: '空气质量可接受，极少数异常敏感人群应减少户外活动。',
      adviceEn: 'Acceptable; unusually sensitive people should limit prolonged outdoor exertion.',
    },
  },
  {
    max: 150,
    band: {
      zh: '轻度污染',
      en: 'Unhealthy for Sensitive Groups',
      color: '#e8a33d',
      adviceZh: '儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间户外锻炼。',
      adviceEn: 'Sensitive groups should reduce prolonged outdoor exertion.',
    },
  },
  {
    max: 200,
    band: {
      zh: '中度污染',
      en: 'Unhealthy',
      color: '#e05e4b',
      adviceZh: '一般人群适量减少户外活动，敏感人群避免户外锻炼。',
      adviceEn: 'Everyone should limit prolonged outdoor exertion.',
    },
  },
  {
    max: 300,
    band: {
      zh: '重度污染',
      en: 'Very Unhealthy',
      color: '#a44fb0',
      adviceZh: '儿童、老年人及病患者应停留在室内，避免户外活动。',
      adviceEn: 'Health alert: avoid outdoor exertion; stay indoors.',
    },
  },
  {
    max: Infinity,
    band: {
      zh: '严重污染',
      en: 'Hazardous',
      color: '#8c1f28',
      adviceZh: '所有人群应减少外出，健康人群也可能出现明显症状。',
      adviceEn: 'Emergency conditions: everyone should avoid all outdoor activity.',
    },
  },
];

export function aqiBand(aqi: number | null): AqiBand | null {
  if (aqi === null) return null;
  for (const { max, band } of AQI_BANDS) if (aqi <= max) return band;
  return AQI_BANDS[AQI_BANDS.length - 1]!.band;
}

/** Column aliases accepted for each pollutant (header cells, lower-cased). */
export const POLLUTANT_COLUMNS: Record<AqiPollutant, RegExp[]> = {
  so2: [/^so2$/, /^so_?2$/, /^so2·?[_ ]?24h$/, /^二氧化硫$/],
  no2: [/^no2$/, /^no_?2$/, /^二氧化氮$/],
  pm25: [/^pm2\.?5$/, /^pm25$/, /^pm_?2_?5$/],
  pm10: [/^pm10$/, /^pm_?10$/],
  co: [/^co$/, /^一氧化碳$/],
  o3: [/^o3$/, /^o_?3$/, /^臭氧$/],
};

// ==========================================================================
// Module 2 — Surface water quality (GB 3838-2002)
// ==========================================================================

export type WaterIndicator = 'ph' | 'do' | 'cod' | 'bod' | 'nh3n' | 'tp';

export const WATER_INDICATORS: WaterIndicator[] = ['ph', 'do', 'cod', 'bod', 'nh3n', 'tp'];

export const WATER_LABELS: Record<WaterIndicator, { zh: string; en: string; unit: string }> = {
  ph: { zh: 'pH', en: 'pH', unit: '—' },
  do: { zh: '溶解氧', en: 'Dissolved O₂', unit: 'mg/L' },
  cod: { zh: '高锰酸盐指数', en: 'COD (permanganate)', unit: 'mg/L' },
  bod: { zh: 'BOD₅', en: 'BOD₅', unit: 'mg/L' },
  nh3n: { zh: '氨氮', en: 'NH₃-N', unit: 'mg/L' },
  tp: { zh: '总磷', en: 'Total P', unit: 'mg/L' },
};

/** Class limits per indicator for Ⅰ…Ⅴ (river values). `higherBetter` marks
 * DO. pH is a two-sided 6–9 gate that is either met or exceeded. */
export const GB3838_LIMITS: Record<WaterIndicator, { limits: [number, number, number, number, number]; higherBetter: boolean }> = {
  ph: { limits: [6, 9, 9, 9, 9], higherBetter: false }, // two-sided: 6–9 for every class
  do: { limits: [7.5, 6, 5, 3, 2], higherBetter: true },
  cod: { limits: [2, 4, 6, 10, 15], higherBetter: false },
  bod: { limits: [3, 3, 4, 6, 10], higherBetter: false },
  nh3n: { limits: [0.15, 0.5, 1.0, 1.5, 2.0], higherBetter: false },
  tp: { limits: [0.02, 0.1, 0.2, 0.3, 0.4], higherBetter: false },
};

export const WATER_CLASS_ZH = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'] as const;
export const WATER_CLASS_EN = ['I', 'II', 'III', 'IV', 'V'] as const;

/**
 * Classify one indicator: returns class 1–5, or null when outside the
 * evaluation range (below Class Ⅴ / beyond pH 6–9).
 */
export function classifyIndicator(ind: WaterIndicator, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const { limits, higherBetter } = GB3838_LIMITS[ind];
  if (ind === 'ph') return value >= 6 && value <= 9 ? 1 : null;
  for (let i = 0; i < 5; i += 1) {
    const lim = limits[i]!;
    if (higherBetter ? value >= lim : value <= lim) return i + 1;
  }
  return null;
}

export interface WaterSiteInput {
  name?: string;
  values: Partial<Record<WaterIndicator, number>>;
}

export interface WaterSiteResult {
  name: string;
  /** Per-indicator class (1–5); null = outside range; absent = not evaluated. */
  classes: Partial<Record<WaterIndicator, number>>;
  /** Indicators beyond the evaluation range. */
  exceeded: WaterIndicator[];
  /** Indicators present in data but excluded (non-numeric). */
  missing: WaterIndicator[];
  /** Worst class across evaluated indicators (single-factor method). */
  worstClass: number | null;
  /** Weighted-arithmetic WQI (optional output). */
  wqi: number | null;
  wqiRating: string | null;
}

/** Chatterjee & Raziuddin WQI rating bands (zh labels). */
export function wqiRating(wqi: number, zh: boolean): string {
  if (wqi <= 25) return zh ? '优秀' : 'excellent';
  if (wqi <= 50) return zh ? '良好' : 'good';
  if (wqi <= 75) return zh ? '中等偏差' : 'poor';
  if (wqi <= 100) return zh ? '差' : 'very poor';
  return zh ? '不可饮用' : 'unsuitable';
}

/**
 * Weighted-arithmetic WQI with unit weights (K = 1, equal weighting):
 * q_i = 100 × (C_i,s / C_i) for lower-better parameters (C_i,s = Class Ⅰ
 * limit, best), DO inverted (q = 100 × C/7.5 capped at 100), pH two-sided
 * around 7.5. WQI = Σq/n. Teaching-scale index, not a compliance metric.
 */
export function computeWqi(values: Partial<Record<WaterIndicator, number>>): number | null {
  let sum = 0;
  let n = 0;
  for (const ind of WATER_INDICATORS) {
    const v = values[ind];
    if (v === undefined || !Number.isFinite(v)) continue;
    let q: number;
    if (ind === 'ph') {
      q = Math.max(0, 100 - (Math.abs(v - 7.5) / 1.5) * 100);
    } else if (ind === 'do') {
      q = Math.min(100, (v / 7.5) * 100);
    } else {
      const best = GB3838_LIMITS[ind]!.limits[0]!;
      q = v > 0 ? Math.min(100, (best / v) * 100) : 100;
    }
    sum += q;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/** Single-factor classification (worst class governs) + optional WQI. */
export function evaluateWaterSite(input: WaterSiteInput): WaterSiteResult {
  const classes: Partial<Record<WaterIndicator, number>> = {};
  const exceeded: WaterIndicator[] = [];
  const missing: WaterIndicator[] = [];
  for (const ind of WATER_INDICATORS) {
    const v = input.values[ind];
    if (v === undefined || !Number.isFinite(v)) {
      missing.push(ind);
      continue;
    }
    const c = classifyIndicator(ind, v);
    if (c === null) exceeded.push(ind);
    else classes[ind] = c;
  }
  const evaluated = Object.values(classes) as number[];
  const worstClass = evaluated.length > 0 ? Math.max(...evaluated) : null;
  const wqi = computeWqi(input.values);
  return {
    name: input.name ?? '',
    classes,
    exceeded,
    missing,
    worstClass,
    wqi,
    wqiRating: wqi === null ? null : wqiRating(wqi, false),
  };
}

export const WATER_COLUMNS: Record<WaterIndicator, RegExp[]> = {
  ph: [/^ph$/, /^pH$/i],
  do: [/^do$/, /^溶解氧$/, /^dissolvedo2$/, /^dissolved_?o2$/],
  cod: [/^cod$/, /^codmn$/, /^高锰酸盐$/, /^高锰酸盐指数$/],
  bod: [/^bod$/, /^bod5$/, /^bod_?5$/],
  nh3n: [/^nh3n$/, /^nh3[_-]?n$/, /^氨氮$/],
  tp: [/^tp$/, /^总磷$/, /^total_?p$/],
};

// ==========================================================================
// Module 3 — Greenhouse (0-D energy balance + Myhre forcing)
// ==========================================================================

export const SOLAR_CONSTANT = 1361; // W/m²
export const STEFAN_BOLTZMANN = 5.670374419e-8; // W/(m²·K⁴)
export const CO2_REFERENCE = 280; // ppm, pre-industrial
/** Myhre et al. 1998: ΔF = 5.35 × ln(C/C₀) W/m². */
export const FORCING_COEFF = 5.35;
/** Climate sensitivity parameter λ (IPCC best-estimate range 0.5–1.2). */
export const CLIMATE_SENSITIVITY = 0.8; // K/(W/m²)
/** Natural (pre-industrial) greenhouse effect at the reference state. */
export const NATURAL_GREENHOUSE_K = 33.2; // K
/** Cloud longwave-equivalent forcing per unit cloud fraction, pivoted at 0.5. */
export const CLOUD_FORCING = 6; // W/m²

export interface GreenhouseInput {
  co2ppm: number;
  albedo: number;
  cloud: number; // 0–1
}

export interface GreenhouseResult {
  /** Absorbed shortwave flux (S₀/4)(1−α), W/m². */
  absorbedFlux: number;
  /** Effective blackbody temperature Te, K. */
  effectiveTempK: number;
  /** Radiative forcing vs 280 ppm + cloud pivot, W/m². */
  forcing: number;
  /** Equilibrium surface temperature Ts, °C. */
  surfaceTempC: number;
  /** ΔT vs the reference state (280 ppm, α 0.30, cloud 0.5), K. */
  deltaT: number;
}

/** Zero-D energy balance: Te=(F/σ)^¼, Ts=Te+33.2+λ·ΔF. Pure. */
export function greenhouseModel(input: GreenhouseInput): GreenhouseResult {
  const absorbedFlux = (SOLAR_CONSTANT / 4) * (1 - input.albedo);
  const effectiveTempK = Math.pow(absorbedFlux / STEFAN_BOLTZMANN, 0.25);
  const forcing =
    FORCING_COEFF * Math.log(Math.max(input.co2ppm, 1) / CO2_REFERENCE) +
    CLOUD_FORCING * (input.cloud - 0.5);
  const surfaceTempK = effectiveTempK + NATURAL_GREENHOUSE_K + CLIMATE_SENSITIVITY * forcing;
  // Reference-state surface temperature for the ΔT baseline.
  const refAbsorbed = (SOLAR_CONSTANT / 4) * (1 - 0.3);
  const refTe = Math.pow(refAbsorbed / STEFAN_BOLTZMANN, 0.25);
  const refT = refTe + NATURAL_GREENHOUSE_K; // ΔF=0 at the pivot
  return {
    absorbedFlux,
    effectiveTempK,
    forcing,
    surfaceTempC: surfaceTempK - 273.15,
    deltaT: surfaceTempK - refT,
  };
}

export const GREENHOUSE_LIMITS = { co2Min: 180, co2Max: 1200, albedoMax: 0.8 } as const;

// ==========================================================================
// Module 4 — Carbon box model (4 pools, donor-controlled linear fluxes)
// ==========================================================================

export type CarbonPool = 'atmosphere' | 'vegetation' | 'soil' | 'ocean';

export const CARBON_POOL_LABELS: Record<CarbonPool, { zh: string; en: string }> = {
  atmosphere: { zh: '大气', en: 'Atmosphere' },
  vegetation: { zh: '陆地植被', en: 'Vegetation' },
  soil: { zh: '土壤', en: 'Soil' },
  ocean: { zh: '海洋', en: 'Ocean' },
};

/** Initial stocks, GtC (pre-industrial, approximate). */
export const CARBON_INITIAL: Record<CarbonPool, number> = {
  atmosphere: 590,
  vegetation: 550,
  soil: 2000,
  ocean: 38000,
};

/**
 * Linear donor-controlled rate constants (1/yr) calibrated to
 * pre-industrial steady state (fluxes ≈ 120 photosynthesis / 60 leaf
 * litter+wood / 60 soil respiration / 92 ocean in & out, GtC/yr).
 */
export const CARBON_K: Record<string, number> = {
  'atmosphere>vegetation': 120 / 590,
  'vegetation>atmosphere': 60 / 550,
  'vegetation>soil': 60 / 550,
  'soil>atmosphere': 60 / 2000,
  'atmosphere>ocean': 92 / 590,
  'ocean>atmosphere': 92 / 38000,
};

export type CarbonScenario = 'industrial' | 'current' | 'mitigation';

/** Annual anthropogenic emission, GtC/yr, per preset scenario. */
export const CARBON_SCENARIOS: Record<CarbonScenario, number> = {
  industrial: 3,
  current: 9,
  mitigation: 2,
};

export interface CarbonState extends Record<CarbonPool, number> {}

export interface CarbonYearPoint {
  year: number;
  pools: CarbonState;
  /** Net atmosphere change that year (emissions − net sink), GtC. */
  atmChange: number;
}

/**
 * One explicit Euler step (dt = 1 yr). Returns the state after the step plus
 * the atmosphere increment. `external` carries net human fluxes per pool
 * (GtC/yr, e.g. emissions into air, deforestation out of vegetation).
 * Clamps pools at zero (teaching model).
 */
export function carbonStep(
  state: CarbonState,
  emission: number,
  external?: Partial<Record<CarbonPool, number>>,
): { next: CarbonState; atmChange: number } {
  const flows: Array<[CarbonPool, CarbonPool, number]> = [
    ['atmosphere', 'vegetation', CARBON_K['atmosphere>vegetation']! * state.atmosphere],
    ['vegetation', 'atmosphere', CARBON_K['vegetation>atmosphere']! * state.vegetation],
    ['vegetation', 'soil', CARBON_K['vegetation>soil']! * state.vegetation],
    ['soil', 'atmosphere', CARBON_K['soil>atmosphere']! * state.soil],
    ['atmosphere', 'ocean', CARBON_K['atmosphere>ocean']! * state.atmosphere],
    ['ocean', 'atmosphere', CARBON_K['ocean>atmosphere']! * state.ocean],
  ];
  const next: CarbonState = { ...state };
  for (const [from, to, f] of flows) {
    next[from] -= f;
    next[to] += f;
  }
  next.atmosphere += emission;
  if (external) {
    for (const k of Object.keys(external) as CarbonPool[]) {
      const f = external[k];
      if (f) next[k] += f;
    }
  }
  // Clamp tiny negatives from numerical noise; big negatives mean the model
  // has been pushed out of its valid range — the caller warns.
  for (const k of Object.keys(next) as CarbonPool[]) {
    if (next[k] < 0 && next[k] > -1e-6) next[k] = 0;
  }
  return { next, atmChange: next.atmosphere - state.atmosphere };
}

/** Run N years; internal fluxes cancel so Σ pools grows only by emissions + external net fluxes. */
export function carbonRun(
  initial: CarbonState,
  emission: number,
  years: number,
  external?: Partial<Record<CarbonPool, number>>,
): CarbonYearPoint[] {
  const points: CarbonYearPoint[] = [{ year: 0, pools: { ...initial }, atmChange: 0 }];
  let cur = initial;
  for (let y = 1; y <= years; y += 1) {
    const { next, atmChange } = carbonStep(cur, emission, external);
    cur = next;
    points.push({ year: y, pools: { ...cur }, atmChange });
  }
  return points;
}

// ==========================================================================
// Module 5 — Biodiversity indices
// ==========================================================================

export interface DiversityIndex {
  /** Richness S. */
  richness: number;
  /** Total individuals N. */
  total: number;
  /** Shannon H′ (nats). */
  shannon: number | null;
  /** Gini–Simpson 1 − Σp². */
  simpson: number | null;
  /** Pielou evenness J = H′/ln S. */
  evenness: number | null;
  /** Dominant species name. */
  dominant: string | null;
  /** Relative abundance of the dominant. */
  dominantShare: number | null;
}

/** Shannon / Simpson / Pielou from one abundance vector. Empty → nulls. */
export function diversityIndex(counts: number[], species: string[]): DiversityIndex {
  const total = counts.reduce((a, b) => a + b, 0);
  const richness = counts.filter((c) => c > 0).length;
  const empty: DiversityIndex = {
    richness,
    total,
    shannon: null,
    simpson: null,
    evenness: null,
    dominant: null,
    dominantShare: null,
  };
  if (total <= 0 || richness === 0) return empty;
  let h = 0;
  let simpsonSum = 0;
  let maxCount = 0;
  let dominant: string | null = null;
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i]!;
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
    simpsonSum += p * p;
    if (c > maxCount) {
      maxCount = c;
      dominant = species[i] ?? `#${i + 1}`;
    }
  }
  const simpson = 1 - simpsonSum;
  const evenness = richness > 1 ? h / Math.log(richness) : null;
  return {
    richness,
    total,
    shannon: h,
    simpson,
    evenness,
    dominant,
    dominantShare: maxCount / total,
  };
}

// ==========================================================================
// Module 6 — Gaussian plume (Pasquill–Gifford, open country)
// ==========================================================================

export type StabilityClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/**
 * Open-country Pasquill–Gifford σ (m) at downwind distance x (m),
 * Turner (1970) formulation. Pure.
 */
export function sigmaYZ(cls: StabilityClass, x: number): { sy: number; sz: number } {
  const xx = Math.max(x, 1);
  switch (cls) {
    case 'A':
      return { sy: 0.22 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.2 * xx };
    case 'B':
      return { sy: 0.16 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.12 * xx };
    case 'C':
      return { sy: 0.11 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.08 * xx * Math.pow(1 + 0.0002 * xx, -0.5) };
    case 'D':
      return { sy: 0.08 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.06 * xx * Math.pow(1 + 0.0015 * xx, -0.5) };
    case 'E':
      return { sy: 0.06 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.03 * xx * Math.pow(1 + 0.0003 * xx, -1) };
    case 'F':
      return { sy: 0.04 * xx * Math.pow(1 + 0.0001 * xx, -0.5), sz: 0.016 * xx * Math.pow(1 + 0.0003 * xx, -1) };
  }
}

/**
 * Gaussian plume ground-level concentration (μg/m³ when Q is μg/s),
 * with ground reflection, receptor at (x downwind, y crosswind, z=0).
 */
export function plumeConcentration(
  q: number,
  u: number,
  cls: StabilityClass,
  stackH: number,
  x: number,
  y: number,
  z = 0,
): number {
  if (u <= 0 || x <= 0) return 0;
  const { sy, sz } = sigmaYZ(cls, x);
  const adv = q / (2 * Math.PI * u * sy * sz);
  const lateral = Math.exp(-(y * y) / (2 * sy * sy));
  const vertical =
    Math.exp(-((z - stackH) ** 2) / (2 * sz * sz)) + Math.exp(-((z + stackH) ** 2) / (2 * sz * sz));
  return adv * lateral * vertical;
}

/** Locate the max ground-level centreline concentration over 10 km. */
export function maxGroundConcentration(
  q: number,
  u: number,
  cls: StabilityClass,
  stackH: number,
): { x: number; c: number } {
  let best = { x: 1, c: 0 };
  for (let x = 10; x <= 10000; x += 10) {
    const c = plumeConcentration(q, u, cls, stackH, x, 0, 0);
    if (c > best.c) best = { x, c };
  }
  return best;
}

// ==========================================================================
// Module 8 — Lake stratification (two-layer + thermocline teaching model)
// ==========================================================================

export interface LakeProfilePoint {
  depth: number; // m, 0 = surface
  temp: number; // °C
  do: number; // mg/L
}

/**
 * Simplified thermal profile: epilimnion (mixed layer) at the inflow/surface
 * temperature, linear thermocline over 4 m, hypolimnion at 6 °C. Mixed-layer
 * depth grows with wind stress. DO saturates near the surface (~9 mg/L) and
 * decays through the thermocline to ~1.5 mg/L at depth.
 */
export function lakeProfile(
  maxDepth: number,
  surfaceTemp: number,
  windSpeed: number,
  nutrientLoad: number,
): LakeProfilePoint[] {
  const hMixed = Math.min(maxDepth * 0.6, Math.max(2, 2 + windSpeed * 2.5));
  const thermocline = Math.max(1, Math.min(6, maxDepth * 0.15));
  const bottomT = Math.min(8, Math.max(4, surfaceTemp * 0.25));
  const pts: LakeProfilePoint[] = [];
  const n = 24;
  for (let i = 0; i <= n; i += 1) {
    const d = (maxDepth * i) / n;
    let t: number;
    if (d <= hMixed) t = surfaceTemp;
    else if (d <= hMixed + thermocline) {
      const f = (d - hMixed) / thermocline;
      t = surfaceTemp + (bottomT - surfaceTemp) * f;
    } else t = bottomT;
    // DO: near saturation in the mixed layer; decays below; a modest
    // phytoplankton signal adds oxygen in the sunlit top layer.
    const doSat = 9 + nutrientLoad * 1.5 * Math.exp(-d / 3);
    const oxiDepth = Math.min(maxDepth * 0.9, hMixed + thermocline * 1.5);
    const doVal =
      d <= oxiDepth
        ? Math.max(2, doSat - 5 * Math.max(0, (d - hMixed) / Math.max(oxiDepth - hMixed, 0.1)))
        : Math.max(0.5, 2 - (d - oxiDepth) * 0.08);
    pts.push({ depth: d, temp: t, do: doVal });
  }
  return pts;
}

// ==========================================================================
// Module 9 — Global environment (built-in approximate distributions)
// ==========================================================================

/**
 * Teaching-approximate surface CO₂ mixing ratio (ppm) by latitude (°) and
 * month (1–12): inter-hemispheric gradient plus the seasonal biosphere
 * "breathing" cycle, phase-locked to the northern growing season.
 */
export function surfaceCo2(latDeg: number, month: number): number {
  const base = 420;
  const gradient = 3 * Math.sin((latDeg * Math.PI) / 180); // N higher than S
  const season = 8 * Math.sin((2 * Math.PI * (month - 4)) / 12) * Math.cos((latDeg * Math.PI) / 180);
  return base + gradient + season;
}

/** Teaching-approximate surface albedo: ocean/forest low, ice caps high. */
export function surfaceAlbedo(latDeg: number): number {
  const a = Math.abs(latDeg);
  if (a > 70) return 0.75;
  if (a > 60) return 0.45;
  return 0.12 + 0.1 * Math.pow(a / 60, 2);
}

// ==========================================================================
// Module 10 — Groundwater advection–dispersion (explicit FTCS)
// ==========================================================================

export interface GroundwaterGrid {
  nx: number;
  ny: number;
  nz: number;
  /** Row-major (x-major) concentration field, mg/L. */
  c: Float64Array;
}

/**
 * One explicit advection–dispersion step along +x with retardation-free
 * teaching parameters. Stability (CFL/Neumann) is clamped internally: the
 * caller can step freely without blowing up, but the effective velocity is
 * limited to the stable value (the UI reports when clamping bites).
 */
export function groundwaterStep(
  grid: GroundwaterGrid,
  opts: { velocity: number; dispL: number; dx: number; dt: number },
): { clamped: boolean } {
  const { nx, ny, nz, c } = grid;
  const D = opts.dispL * Math.abs(opts.velocity); // dispersivity × velocity
  const dtAdv = opts.dx / Math.max(Math.abs(opts.velocity), 1e-6);
  const dtDisp = (opts.dx * opts.dx) / (2 * D + 1e-9);
  const stableDt = Math.min(dtAdv, dtDisp);
  const clamped = opts.dt > stableDt * 1.001;
  const dt = Math.min(opts.dt, stableDt);

  const next = new Float64Array(c.length);
  next.set(c);
  const idx = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const cur = c[idx(x, y, z)]!;
        if (cur === 0) continue;
        let val = cur;
        // Advection along +x (upwind difference).
        if (x + 1 < nx) {
          const frac = (opts.velocity * dt) / opts.dx;
          const move = Math.min(frac, 1) * cur;
          next[idx(x, y, z)] = (next[idx(x, y, z)] ?? 0) - move;
          next[idx(x + 1, y, z)] = (next[idx(x + 1, y, z)] ?? 0) + move;
        }
        // Longitudinal dispersion (central difference).
        if (D > 0 && x > 0 && x + 1 < nx) {
          const grad = c[idx(x + 1, y, z)]! - 2 * cur + c[idx(x - 1, y, z)]!;
          next[idx(x, y, z)] =
            (next[idx(x, y, z)] ?? 0) + ((D * dt) / (opts.dx * opts.dx)) * grad;
        }
        val = next[idx(x, y, z)]!;
        if (val < 0 && val > -1e-6) next[idx(x, y, z)] = 0;
      }
    }
  }
  grid.c.set(next);
  return { clamped };
}

/** Draw-down at a pumping well: local sink removing a fraction of C per step. */
export function pumpWell(grid: GroundwaterGrid, x: number, y: number, z: number, extraction = 0.2): void {
  const idx = (z * grid.ny + y) * grid.nx + x;
  if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) return;
  grid.c[idx] = Math.max(0, grid.c[idx]! * (1 - extraction));
}

// ==========================================================================
// Canvas helpers (shared empty state, colour ramp)
// ==========================================================================

/** Shared "no data" empty state painted onto a 2-D canvas. */
export function drawEmptyMessage(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  msg: string,
  hint?: string,
): void {
  g.fillStyle = 'rgba(150, 165, 185, 0.85)';
  g.font = "12px 'Microsoft YaHei', Consolas, monospace";
  g.textAlign = 'center';
  g.fillText(msg, canvas.width / 2, canvas.height / 2);
  if (hint) {
    g.fillStyle = 'rgba(120, 132, 150, 0.9)';
    g.fillText(hint, canvas.width / 2, canvas.height / 2 + 20);
  }
}

/** Turbo-like colour ramp t∈[0,1] → CSS rgb (shared by plume/heatmap views). */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const stops: Array<[number, number, number]> = [
    [34, 52, 92],
    [30, 116, 178],
    [46, 176, 142],
    [132, 196, 72],
    [248, 208, 62],
    [236, 118, 48],
    [178, 28, 44],
  ];
  const seg = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const r = Math.round(a[0] + f * (b[0] - a[0]));
  const g2 = Math.round(a[1] + f * (b[1] - a[1]));
  const b2 = Math.round(a[2] + f * (b[2] - a[2]));
  return `rgb(${r},${g2},${b2})`;
}

/** Same ramp as [r,g,b] floats for Three.js vertex colours. */
export function rampColor3(t: number): [number, number, number] {
  const css = rampColor(t);
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css);
  if (!m) return [1, 1, 1];
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}
