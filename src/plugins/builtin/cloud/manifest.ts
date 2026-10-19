// ==========================================================================
// Volumetric cloud plugin — manifest
//
// GPU volumetric raymarching of a wind-advected cloud slab with physically
// motivated single-scattering lighting (Beer–Lambert + Henyey–Greenstein)
// and ephemeris-driven sun/moon positions (Meeus) — day, sunset and
// deep-night skies from one renderer.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const cloudManifest: PluginManifest = {
  id: 'fx.cloud',
  name: 'Volumetric Clouds · Sky Renderer',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Raymarched volumetric cloud slab with wind advection, Beer–Lambert + Henyey–Greenstein single scattering, self-shadowed light march and an ephemeris-driven sky: natural sun/moon lighting, sunset glow and a deep-blue night.',
  nameI18n: {
    'zh-CN': '体积云 · 天空渲染器',
    'en-US': 'Volumetric Clouds · Sky Renderer',
  },
  descriptionI18n: {
    'zh-CN':
      '光线步进的体积云层：风场平流、Beer–Lambert 消光 + Henyey–Greenstein 散射、自遮蔽光程积分；日月位置由真实天文历表公式（Meeus）驱动，含自然日光/月光、黄昏与深空蓝夜空。',
    'en-US':
      'Raymarched volumetric cloud slab: wind advection, Beer–Lambert extinction with Henyey–Greenstein scattering, self-shadowed light march; ephemeris-driven sun/moon (Meeus), natural day/night lighting and a deep-blue night sky.',
  },
  license: 'MIT',
  entry: 'fx.cloud',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { length: 'm', speed: 'm/s', angle: '°' },
    reproducible: true,
    notes:
      'Single-scattering volumetric rendering (Beer–Lambert extinction, dual-lobe Henyey–Greenstein phase, powder term) with a two-tap light march on a 3-D value-noise fBm density field advected by a uniform wind vector (advection time-lapsed ×20 for legibility). Sun/moon directions from low-precision Meeus ephemeris (~1 arcmin Sun, ~0.3° Moon). Not a weather model — cloud fields are procedural.',
    notesI18n: {
      'zh-CN':
        '单次散射体积渲染（Beer–Lambert 消光、双瓣 Henyey–Greenstein 相函数、powder 项）+ 2 步光程自遮蔽，密度场为三维值噪声 fBm 程序噪声并随风矢量平流（平流按 20 倍时间加速以便观察）。日/月方位由低精度 Meeus 历表公式给出（太阳约 ±1′，月球约 ±0.3°）。属程序化云场，非气象模式。',
      'en-US':
        'Single-scattering volumetric rendering (Beer–Lambert, dual-lobe HG phase, powder) with a two-tap light march over a 3-D value-noise fBm density field advected by a uniform wind (advection time-lapsed ×20 for legibility). Sun/moon directions from low-precision Meeus ephemeris (~1 arcmin Sun, ~0.3° Moon). Procedural clouds, not a weather model.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Scene preset (sky, clouds, wind)' }],
};
