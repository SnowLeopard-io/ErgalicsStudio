// ==========================================================================
// Color Science Lab — pure kernel
//
// sRGB ↔ linear ↔ CIE XYZ (D65) ↔ CIELAB ↔ LCH, HSV/HSL, CIE 1931 xy and
// 1976 u'v', CIE76 / CIEDE2000 colour difference, dichromacy simulation,
// colour-harmony rules and WCAG contrast. No DOM: every function is
// deterministic and unit-testable.
//
// Colour-matching functions use the Wyman/Sloan/Shirley (2013) multi-lobe
// Gaussian fit to the CIE 1931 2° observer, accurate to a few percent over
// 380–780 nm — enough for an explanatory chromaticity locus, not for
// colorimetry-grade spectral integration.
// ==========================================================================

export type RGB = [number, number, number];
export type Lab = [number, number, number];
export type XYZ = [number, number, number];

export const D65: XYZ = [95.047, 100, 108.883];

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function srgbToLinear(c: number): number {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** sRGB (0…1 per channel) → CIE XYZ (D65, Y = 100). */
export function rgbToXyz(rgb: RGB): XYZ {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100,
    (0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100,
  ];
}

/** CIE XYZ → linear sRGB (0…1, unclipped). */
export function xyzToLinearRgb(xyz: XYZ): RGB {
  const x = xyz[0] / 100;
  const y = xyz[1] / 100;
  const z = xyz[2] / 100;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

/** CIE XYZ → sRGB (0…1, clipped to the display gamut). */
export function xyzToRgb(xyz: XYZ): RGB {
  const lin = xyzToLinearRgb(xyz);
  return [clamp01(linearToSrgb(lin[0])), clamp01(linearToSrgb(lin[1])), clamp01(linearToSrgb(lin[2]))];
}

const LAB_EPS = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

const labF = (t: number): number => (t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116);
const labFInv = (t: number): number => {
  const t3 = t ** 3;
  return t3 > LAB_EPS ? t3 : (116 * t - 16) / LAB_KAPPA;
};

export function xyzToLab(xyz: XYZ, white: XYZ = D65): Lab {
  const fx = labF(xyz[0] / white[0]);
  const fy = labF(xyz[1] / white[1]);
  const fz = labF(xyz[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: Lab, white: XYZ = D65): XYZ {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  return [labFInv(fx) * white[0], labFInv(fy) * white[1], labFInv(fz) * white[2]];
}

export function rgbToLab(rgb: RGB): Lab {
  return xyzToLab(rgbToXyz(rgb));
}

export function labToRgb(lab: Lab): RGB {
  return xyzToRgb(labToXyz(lab));
}

export function labToLch(lab: Lab): Lab {
  const c = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [lab[0], c, h];
}

export function lchToLab(lch: Lab): Lab {
  const h = (lch[2] * Math.PI) / 180;
  return [lch[0], lch[1] * Math.cos(h), lch[1] * Math.sin(h)];
}

export function rgbToHsv(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-12) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max <= 0 ? 0 : d / max, max];
}

export function hsvToRgb(hsv: [number, number, number]): RGB {
  const h = ((hsv[0] % 360) + 360) % 360;
  const s = clamp01(hsv[1]);
  const v = clamp01(hsv[2]);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: RGB;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function rgbToHsl(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-12) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(hsl: [number, number, number]): RGB {
  const h = ((hsl[0] % 360) + 360) % 360;
  const s = clamp01(hsl[1]);
  const l = clamp01(hsl[2]);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: RGB;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function rgbToHex(rgb: RGB): string {
  const to = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** CIE 1931 xy chromaticity. */
export function xyzToXy(xyz: XYZ): [number, number] {
  const sum = xyz[0] + xyz[1] + xyz[2];
  if (sum <= 0) return [0, 0];
  return [xyz[0] / sum, xyz[1] / sum];
}

/** CIE 1976 u′v′ chromaticity. */
export function xyzToUv(xyz: XYZ): [number, number] {
  const [x, y] = xyzToXy(xyz);
  const denom = -2 * x + 12 * y + 3;
  if (Math.abs(denom) < 1e-12) return [0, 0];
  return [(4 * x) / denom, (9 * y) / denom];
}

export function xyToUv(x: number, y: number): [number, number] {
  const denom = -2 * x + 12 * y + 3;
  if (Math.abs(denom) < 1e-12) return [0, 0];
  return [(4 * x) / denom, (9 * y) / denom];
}

const gauss = (lambda: number, mu: number, s1: number, s2: number): number => {
  const t = lambda - mu;
  const s = t < 0 ? s1 : s2;
  return Math.exp(-0.5 * (t / s) ** 2);
};

/** Approximate CIE 1931 2° colour-matching functions (Wyman et al. 2013). */
export function cie1931Cmf(lambda: number): XYZ {
  return [
    1.056 * gauss(lambda, 599.8, 37.9, 31.0) + 0.362 * gauss(lambda, 442.0, 16.0, 26.7) - 0.065 * gauss(lambda, 501.1, 20.4, 26.2),
    0.821 * gauss(lambda, 568.8, 46.9, 40.5) + 0.286 * gauss(lambda, 530.9, 16.3, 31.1),
    1.217 * gauss(lambda, 437.0, 11.8, 36.0) + 0.681 * gauss(lambda, 459.0, 26.0, 13.8),
  ];
}

/** Spectral locus points and the matching wavelength labels. */
export function spectralLocus(start = 380, end = 700, step = 5): Array<{ x: number; y: number; nm: number }> {
  const out: Array<{ x: number; y: number; nm: number }> = [];
  for (let nm = start; nm <= end; nm += step) {
    const [x, y] = xyzToXy(cie1931Cmf(nm));
    out.push({ x, y, nm });
  }
  return out;
}

/** CIEDE2000 colour difference (Sharma et al. 2005 formulation). */
export function deltaE2000(lab1: Lab, lab2: Lab, kL = 1, kC = 1, kH = 1): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const deg = (v: number) => (v * 180) / Math.PI;
  const rad = (v: number) => (v * Math.PI) / 180;
  let h1p = C1p === 0 ? 0 : deg(Math.atan2(b1, a1p));
  if (h1p < 0) h1p += 360;
  let h2p = C2p === 0 ? 0 : deg(Math.atan2(b2, a2p));
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  return Math.sqrt(
    (dLp / (kL * SL)) ** 2 +
      (dCp / (kC * SC)) ** 2 +
      (dHp / (kH * SH)) ** 2 +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );
}

export function deltaE76(lab1: Lab, lab2: Lab): number {
  return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
}

export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia';

/**
 * Viénot–Brettel–Mollon style linear-RGB dichromacy simulations (the widely
 * used 3×3 approximations). Input/output are gamma-encoded sRGB 0…1.
 */
const CVD_MATRICES: Record<CvdType, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulateCvd(rgb: RGB, type: CvdType): RGB {
  const m = CVD_MATRICES[type];
  const lin: RGB = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  const out: RGB = [
    m[0]! * lin[0] + m[1]! * lin[1] + m[2]! * lin[2],
    m[3]! * lin[0] + m[4]! * lin[1] + m[5]! * lin[2],
    m[6]! * lin[0] + m[7]! * lin[1] + m[8]! * lin[2],
  ];
  return [clamp01(linearToSrgb(out[0])), clamp01(linearToSrgb(out[1])), clamp01(linearToSrgb(out[2]))];
}

export function relativeLuminance(rgb: RGB): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

export type HarmonyRule = 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic' | 'monochromatic';

export const HARMONY_RULES: Record<HarmonyRule, { en: string; zh: string; offsets: number[] }> = {
  complementary: { en: 'Complementary', zh: '补色', offsets: [0, 180] },
  analogous: { en: 'Analogous', zh: '邻近色', offsets: [-30, 0, 30] },
  triadic: { en: 'Triadic', zh: '三角配色', offsets: [0, 120, 240] },
  'split-complementary': { en: 'Split-complementary', zh: '分裂补色', offsets: [0, 150, 210] },
  tetradic: { en: 'Tetradic (square)', zh: '四方配色', offsets: [0, 90, 180, 270] },
  monochromatic: { en: 'Monochromatic', zh: '单色相', offsets: [0] },
};

export function harmony(base: RGB, rule: HarmonyRule): RGB[] {
  const [h, s, l] = rgbToHsl(base);
  const def = HARMONY_RULES[rule] ?? HARMONY_RULES.complementary;
  if (rule === 'monochromatic') {
    return [-0.22, -0.11, 0, 0.11, 0.22].map((d) => hslToRgb([h, s, clamp01(l + d)]));
  }
  return def.offsets.map((d) => hslToRgb([h + d, s, l]));
}

export interface PaletteEntry {
  name: string;
  rgb: RGB;
  hex: string;
}

/** Parse a palette CSV: name,hex | name,r,g,b | hex. Header optional. */
export function parsePaletteCsv(text: string): PaletteEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const split = (line: string): string[] => line.split(/[,\t;]/).map((s) => s.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]!);
  const hasHeader = head.some((h) => /name|hex|colour|color|red|green|blue/i.test(h));
  const col = (name: string, fallback: number): number => {
    const i = head.findIndex((h) => h.toLowerCase() === name);
    return i >= 0 ? i : fallback;
  };
  const start = hasHeader ? 1 : 0;
  const iName = hasHeader ? col('name', 0) : 0;
  const iHex = hasHeader ? col('hex', -1) : -1;
  const iR = hasHeader ? col('r', 1) : 1;
  const iG = hasHeader ? col('g', 2) : 2;
  const iB = hasHeader ? col('b', 3) : 3;
  const out: PaletteEntry[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const c = split(lines[i]!);
    let rgb: RGB | null = null;
    let name = c[iName] ?? `colour ${i - start + 1}`;
    if (iHex >= 0 && c[iHex]) {
      rgb = hexToRgb(c[iHex]!);
    } else {
      const hexAt = c.find((v) => /^#[0-9a-f]{3,6}$/i.test(v));
      if (hexAt) {
        rgb = hexToRgb(hexAt);
        if (name === hexAt) name = `colour ${i - start + 1}`;
      }
    }
    if (!rgb && c.length >= 3) {
      const r = Number(c[iR]);
      const g = Number(c[iG]);
      const b = Number(c[iB]);
      if ([r, g, b].every((v) => Number.isFinite(v))) {
        const scale = Math.max(r, g, b) > 1 ? 255 : 1;
        rgb = [clamp01(r / scale), clamp01(g / scale), clamp01(b / scale)];
      }
    }
    if (rgb) out.push({ name, rgb, hex: rgbToHex(rgb) });
  }
  return out;
}

export interface ColorBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

/** Validation suite against published reference values. */
export function runColorBenchmarks(): ColorBenchmark[] {
  const white = rgbToLab([1, 1, 1]);
  const red = rgbToLab([1, 0, 0]);
  const green = rgbToLab([0, 1, 0]);
  const pair = (a: Lab, b: Lab) => deltaE2000(a, b) as number;
  const sharma: Array<[Lab, Lab, number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
    [[50, 2.5, 0], [50, 1.8634, 0.5757], 1.0],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];

  const cases: Array<{ id: string; en: string; zh: string; measured: number; expected: number; tol: number }> = [
    {
      id: 'd65-white',
      en: 'White → Lab L* = 100',
      zh: '白色 → Lab L* = 100',
      measured: white[0],
      expected: 100,
      tol: 1e-6,
    },
    {
      id: 'lab-a-neutral',
      en: 'White a* ≈ 0',
      zh: '白色 a* ≈ 0',
      measured: Math.abs(white[1]),
      expected: 0,
      tol: 1e-6,
    },
    {
      id: 'sRGB-red-Lab',
      en: 'sRGB red → L* = 53.2408',
      zh: 'sRGB 红 → L* = 53.2408',
      measured: red[0],
      expected: 53.2408,
      tol: 2e-3,
    },
    {
      id: 'sRGB-green-a',
      en: 'sRGB green → a* = −86.1830',
      zh: 'sRGB 绿 → a* = −86.1830',
      measured: green[1],
      expected: -86.183,
      tol: 3e-3,
    },
    {
      id: 'wcag-black-white',
      en: 'WCAG contrast black/white = 21',
      zh: 'WCAG 黑白对比 = 21',
      measured: contrastRatio([0, 0, 0], [1, 1, 1]),
      expected: 21,
      tol: 1e-6,
    },
    {
      id: 'lab-roundtrip',
      en: 'RGB → Lab → RGB round-trip',
      zh: 'RGB → Lab → RGB 往返',
      measured: Math.max(...labToRgb(rgbToLab([0.2, 0.6, 0.9])).map((v, i) => Math.abs(v - [0.2, 0.6, 0.9][i]!))),
      expected: 0,
      tol: 1e-4,
    },
    {
      id: 'cie-white-xy',
      en: 'D65 chromaticity x ≈ 0.3127',
      zh: 'D65 色度 x ≈ 0.3127',
      measured: xyzToXy(D65)[0],
      expected: 0.3127,
      tol: 1e-3,
    },
    {
      id: 'de2000-mean',
      en: 'CIEDE2000 Sharma mean abs error',
      zh: 'CIEDE2000 Sharma 平均绝对误差',
      measured: sharma.reduce((s, [a, b, e]) => s + Math.abs(pair(a, b) - e), 0) / sharma.length,
      expected: 0,
      tol: 1e-4,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return {
      id: c.id,
      labelEn: c.en,
      labelZh: c.zh,
      measured: c.measured,
      expected: c.expected,
      relErr,
      passed: relErr <= c.tol,
    };
  });
}
