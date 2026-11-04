// ==========================================================================
// fx.ocean — open-sea swell renderer (manifest).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const oceanManifest: PluginManifest = {
  id: 'fx.ocean',
  name: 'Ocean Swell · Sunrise & Sunset',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Open-ocean renderer: Gerstner wave trains whose amplitudes come from a discretised Pierson–Moskowitz spectrum, a two-lobe micro-facet sun path, Schlick-Fresnel water body and marine haze dissolving the swell into a wide horizon.',
  nameI18n: {
    'zh-CN': '波浪海面 · 日升日落',
    'en-US': 'Ocean Swell · Sunrise & Sunset',
  },
  descriptionI18n: {
    'zh-CN':
      '开阔海面渲染：Gerstner 波列，幅值取自离散化的 Pierson–Moskowitz 海浪谱；双瓣微面元太阳光路、Schlick 菲涅耳水体与海雾。波幅随距离衰减，远处海面平滑成镜面并融入地平线。',
    'en-US':
      'Open-ocean renderer: Gerstner wave trains with discretised Pierson–Moskowitz amplitudes, a two-lobe micro-facet sun path, Schlick-Fresnel water body and marine haze; swell amplitude decays with range so the far sea flattens into a mirror and dissolves into the horizon.',
  },
  license: 'MIT',
  entry: 'fx.ocean',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { length: 'm', angle: '°', speed: 'm/s', time: 's' },
    reproducible: true,
    notes:
      'Spectral input is Pierson–Moskowitz (α = 0.0081, fp = 0.13 g/U10) discretised into 8 log-spaced trains over [fp/2.5, 2.5·fp] with cos² directional spreading, normalised to the analytic variance m0 = α g² / (5 (2π)⁴ fp⁴) so that Hs = 4√m0 reproduces the fully-developed-sea value 0.0246 U10². Each train is a deep-water Gerstner wave (ω² = gk) with steepness Q ≤ 0.9. Water shading uses Schlick Fresnel (F0 = 0.02, n = 1.333) with a two-lobe micro-facet sun path; haze follows Koschmieder visibility. Not modelled: whitecaps/foam, wave breaking, spray, sub-surface refraction, wave–wave nonlinearity, and the sky is a single analytic bounce rather than a ray-marched atmosphere.',
    notesI18n: {
      'zh-CN':
        '谱输入为 Pierson–Moskowitz（α = 0.0081，fp = 0.13 g/U10），在 [fp/2.5, 2.5·fp] 上对数离散为 8 条波列并施加 cos² 方向扩散，再归一化到解析方差 m0 = α g² / (5 (2π)⁴ fp⁴)，使 Hs = 4√m0 复现充分发展海况的 0.0246 U10²。每条波列为深水 Gerstner 波（ω² = gk），陡度 Q ≤ 0.9。水体着色用 Schlick 菲涅耳（F0 = 0.02，n = 1.333）与双瓣微面元太阳光路；雾按 Koschmieder 能见度。未建模：白冠泡沫、破碎波、飞沫、水下折射、波-波非线性；天空为解析单次反射而非光线步进大气。',
      'en-US':
        'Pierson–Moskowitz input (α = 0.0081, fp = 0.13 g/U10) discretised into 8 log-spaced trains over [fp/2.5, 2.5·fp] with cos² spreading and normalised to the analytic variance m0 = α g² / (5 (2π)⁴ fp⁴), so Hs = 4√m0 matches the fully-developed-sea value 0.0246 U10². Each train is a deep-water Gerstner wave (ω² = gk) with steepness Q ≤ 0.9. Shading: Schlick Fresnel (F0 = 0.02, n = 1.333) with a two-lobe micro-facet sun path; haze via Koschmieder visibility. Not modelled: whitecaps/foam, breaking waves, spray, sub-surface refraction, wave–wave nonlinearity; the sky is a single analytic bounce, not a ray-marched atmosphere.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Sea-state preset (time, site, wind)' }],
};
