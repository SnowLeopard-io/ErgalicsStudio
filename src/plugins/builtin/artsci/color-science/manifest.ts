import type { PluginManifest } from '@/types/plugin';

export const colorScienceManifest: PluginManifest = {
  id: 'example.color-science',
  name: 'Color Science Lab',
  nameI18n: { 'zh-CN': '色彩科学实验室', 'en-US': 'Color Science Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Colour-space conversion (RGB, linear RGB, XYZ, Lab, LCH, HSV, HSL), the CIE 1931 xy and 1976 u′v′ chromaticity diagram, CIEDE2000 / CIE76 colour difference, protanopia / deuteranopia / tritanopia simulation, harmony rules, palette generation, CSV import and WCAG contrast checks.',
  descriptionI18n: {
    'zh-CN':
      '色彩空间转换（RGB、线性 RGB、XYZ、Lab、LCH、HSV、HSL）、CIE 1931 xy 与 1976 u′v′ 色度图、CIEDE2000 / CIE76 色差、红色盲/绿色盲/蓝色盲模拟、配色规则、调色板生成、CSV 导入与 WCAG 对比度可访问性检查。',
    'en-US':
      'Colour-space conversion (RGB, linear RGB, XYZ, Lab, LCH, HSV, HSL), the CIE 1931 xy and 1976 u′v′ chromaticity diagram, CIEDE2000 / CIE76 colour difference, protanopia / deuteranopia / tritanopia simulation, harmony rules, palette generation, CSV import and WCAG contrast checks.',
  },
  license: 'MIT',
  entry: 'example.color-science',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { lightness: 'L*', deltaE: 'ΔE', contrast: 'ratio' },
    benchmarks: ['d65-white', 'srgb-red', 'srgb-green', 'wcag-21', 'lab-roundtrip', 'cie-xy', 'ciede2000-sharma'],
    reproducible: true,
    notes:
      'sRGB uses the IEC 61966-2-1 transfer function and the D65 whitepoint (95.047, 100, 108.883). CIELAB follows CIE 15:2004; CIEDE2000 follows the Sharma–Wu–Dalal (2005) formulation with kL=kC=kH=1 and is validated against 34 published reference pairs. Chromaticity coordinates use the Wyman–Sloan–Shirley (2013) Gaussian fit to the CIE 1931 2° observer — suitable for an explanatory locus, not colorimetric integration. Dichromacy matrices are the widely used Viénot–Brettel–Mollon linear approximations.',
    notesI18n: {
      'zh-CN':
        'sRGB 采用 IEC 61966-2-1 传递函数与 D65 白点 (95.047, 100, 108.883)。CIELAB 按 CIE 15:2004；CIEDE2000 按 Sharma–Wu–Dalal (2005) 公式（kL=kC=kH=1），并用 34 组公开参考对验证。色度坐标采用 Wyman–Sloan–Shirley (2013) 对 CIE 1931 2° 观察者的高斯拟合，适合解释性色度图，不用于色度学积分。色盲矩阵为常用的 Viénot–Brettel–Mollon 线性近似。',
      'en-US':
        'sRGB uses the IEC 61966-2-1 transfer function and the D65 whitepoint (95.047, 100, 108.883). CIELAB follows CIE 15:2004; CIEDE2000 follows the Sharma–Wu–Dalal (2005) formulation with kL=kC=kH=1 and is validated against 34 published reference pairs. Chromaticity coordinates use the Wyman–Sloan–Shirley (2013) Gaussian fit to the CIE 1931 2° observer — suitable for an explanatory locus, not colorimetric integration. Dichromacy matrices are the widely used Viénot–Brettel–Mollon linear approximations.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'adbc490266f44dcd4cdc6f48a9dd4960dbd887a00d2ffe3b5323f8ed020b8c7ce2c1835d3c55390289d94d9afc95d82d68cc6d7edbf738f1ee507892dbffa70e',
    signer: 'Ergalics Studio (artsci pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'palette: name, hex (or name, r, g, b)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated palette' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma-separated palette with # comments' },
  ],
};
