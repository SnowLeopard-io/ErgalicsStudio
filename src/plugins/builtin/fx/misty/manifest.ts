// ==========================================================================
// fx.misty — layered misty-peaks renderer (manifest).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mistyManifest: PluginManifest = {
  id: 'fx.misty',
  name: 'Misty Peaks · Layered Ridges',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Distant mountain scenery: a stack of near-to-far ridge silhouettes carved from ridged value noise, lit by the real sun, and dissolved by aerial perspective and a Gaussian mist band. Ranges recede through Koschmieder visibility; the low mist pools in the valleys and veils the far peaks.',
  nameI18n: {
    'zh-CN': '雾锁青山 · 叠嶂云海',
    'en-US': 'Misty Peaks · Layered Ridges',
  },
  descriptionI18n: {
    'zh-CN':
      '远景山景渲染：由脊状值噪声雕刻的近→远山脊剪影层叠排列，由真实太阳照明，并通过大气透视与高斯雾带逐层隐没。山峦按 Koschmieder 能见度后退消隐，低处云雾在谷地聚积、遮蔽远峰，形成「叠嶂」意境。',
    'en-US':
      'Distant mountain scenery: a near-to-far stack of ridge silhouettes carved from ridged value noise, sun-lit and dissolved by aerial perspective plus a Gaussian mist band. Ranges recede through Koschmieder visibility while low mist pools in the valleys and veils the far peaks.',
  },
  license: 'MIT',
  entry: 'fx.misty',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'demonstration',
    units: { length: 'm', angle: '°', time: 's' },
    reproducible: true,
    notes:
      'Terrain is a stack of 6 geometric-range layers (2500 m × 1.85, so ranges sit at ≈2.5 / 4.6 / 8.6 / 15.8 / 29.3 / 54 km) whose crests come from 3-octave ridged value noise with a per-layer frequency gain of 1.55 and height gain of (0.42 + 0.30 i). Earth curvature is included as a −d²/2R_EARTH fall of the ray altitude, and the first layer crossed forms the silhouette (near-to-far, one hit). Aerial perspective uses the same Koschmieder extinction as the ocean (haze → β = (1.2 + 10.4 h) × 10⁻⁵ m⁻¹); mist is a Gaussian band centred on the mist height with half-width 0.65 × mistHeight + 120 m, integrated in 12 taps. The sky is the shared analytic one-bounce RT_SKY_SIMPLE. Not modelled: real terrain elevation data, shadow casting, cloud physics, or a ray-marched atmosphere.',
    notesI18n: {
      'zh-CN':
        '地形为 6 层几何级数距离的剪影层（2500 m × 1.85，分别约位于 2.5 / 4.6 / 8.6 / 15.8 / 29.3 / 54 km），脊线取自 3 阶脊状值噪声，每层频率增益 1.55、高度增益 (0.42 + 0.30 i)。含地球曲率项 −d²/2R_EARTH（射线高度随距离下沉），近→远首次穿过的层即剪影（单次命中）。大气透视复用与海面一致的 Koschmieder 消光（雾滑块 → β = (1.2 + 10.4 h) × 10⁻⁵ m⁻¹）；雾为高斯带，中心在雾高、半宽 0.65 × 雾高 + 120 m，12 抽样积分。天空为共享解析单次反射 RT_SKY_SIMPLE。未建模：真实地形高程数据、投影阴影、云物理、光线步进大气。',
      'en-US':
        'Terrain is 6 geometric-range layers (2500 m × 1.85, i.e. ≈2.5 / 4.6 / 8.6 / 15.8 / 29.3 / 54 km) whose crests come from 3-octave ridged value noise with a per-layer frequency gain of 1.55 and height gain of (0.42 + 0.30 i). Earth curvature enters as a −d²/2R_EARTH fall of the ray altitude; the first layer crossed is the silhouette (near-to-far, single hit). Aerial perspective reuses the ocean Koschmieder extinction (haze → β = (1.2 + 10.4 h) × 10⁻⁵ m⁻¹); mist is a Gaussian band centred on the mist height, half-width 0.65 × mistHeight + 120 m, integrated in 12 taps. The sky is the shared analytic one-bounce RT_SKY_SIMPLE. Not modelled: real terrain elevation data, shadow casting, cloud physics, or a ray-marched atmosphere.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Ridge scenery preset (time, site, mist, lighting)' }],
};
