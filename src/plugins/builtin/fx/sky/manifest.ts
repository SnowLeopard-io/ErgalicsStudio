// ==========================================================================
// fx.sky — daylight sky renderer (manifest).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const skyManifest: PluginManifest = {
  id: 'fx.sky',
  name: 'Daylight Sky · Atmosphere',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Analytic single-scattering atmosphere (Nishita-style): Rayleigh + Mie with turbidity, per-sample light marches, physically motivated twilight through the earth shadow, limb-darkened sun disk and a phase-shaded moon.',
  nameI18n: {
    'zh-CN': '日光天空 · 大气散射',
    'en-US': 'Daylight Sky · Atmosphere',
  },
  descriptionI18n: {
    'zh-CN':
      '解析式单次散射大气（Nishita 型）：Rayleigh + Mie 散射与浑浊度、逐样本光照步进；穿过地影的物理晨昏蒙影、带临边昏暗的太阳盘面与按月相明暗的月亮。昼夜循环与太阳/月亮方位由真实天文历表驱动。',
    'en-US':
      'Analytic single-scattering atmosphere (Nishita-style): Rayleigh + Mie with turbidity and per-sample light marches; twilight through the earth shadow, limb-darkened sun disk, phase-shaded moon. Day cycle and sun/moon positions driven by a real ephemeris.',
  },
  license: 'MIT',
  entry: 'fx.sky',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { length: 'm', angle: '°' },
    reproducible: true,
    notes:
      'Single-scattering Rayleigh/Mie integrator (10 view taps × 4 light taps) over a 6360/6420 km planet/atmosphere shell with exponential scale heights (8 km / 1.2 km). β_R = (5.8, 13.5, 33.1) e-6 /m; β_M scaled by a turbidity parameter. Sun/moon directions from Meeus low-precision ephemeris (~1 arcmin Sun, ~0.3° Moon). Air mass via Kasten–Young (1989). No multiple scattering, no ozone — colors are qualitatively correct, not radiometric.',
    notesI18n: {
      'zh-CN':
        '单次散射 Rayleigh/Mie 积分（视线 10 采样 × 光照 4 采样），行星/大气壳层 6360/6420 km，指数标高 8 km / 1.2 km。β_R = (5.8, 13.5, 33.1) e-6 /m；β_M 由浑浊度参数缩放。日/月方位由 Meeus 低精度历表给出。大气质量用 Kasten–Young (1989)。未含多次散射与臭氧——颜色定性正确，非辐射定量。',
      'en-US':
        'Single-scattering Rayleigh/Mie integrator (10 view taps × 4 light taps) over a 6360/6420 km planet/atmosphere shell, exponential scale heights 8 km / 1.2 km. β_R = (5.8, 13.5, 33.1) e-6 /m; β_M scaled by turbidity. Sun/moon from Meeus low-precision ephemeris. Air mass via Kasten–Young (1989). No multiple scattering or ozone — qualitatively correct colors, not radiometric.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Scene preset (time, site, turbidity)' }],
};
