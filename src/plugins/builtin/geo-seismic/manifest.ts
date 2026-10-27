import type { PluginManifest } from '@/types/plugin';

export const seismicManifest: PluginManifest = {
  id: 'example.geo-seismic',
  name: 'Seismic Wave Propagation',
  nameI18n: { 'zh-CN': '地震波传播实验室', 'en-US': 'Seismic Wave Propagation' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'P/S-wave propagation in a layered Earth, spherical ray-theory travel times and shadow zones, synthetic three-phase seismograms, focal-mechanism beachballs and Richter / moment-magnitude / Mercalli scale conversion.',
  descriptionI18n: {
    'zh-CN':
      '分层地球模型中的 P 波与 S 波传播、球面射线理论走时与影区、合成三分量地震图（P/S/面波）、震源机制沙滩球，以及里氏/矩震级/麦加利烈度换算。',
    'en-US':
      'P/S-wave propagation in a layered Earth, spherical ray-theory travel times and shadow zones, synthetic three-phase seismograms, focal-mechanism beachballs and Richter / moment-magnitude / Mercalli scale conversion.',
  },
  license: 'MIT',
  entry: 'example.geo-seismic',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { depth: 'km', velocity: 'km/s', time: 's', magnitude: 'Mw', energy: 'J' },
    benchmarks: ['ray-vertical-time', 'shadow-zone', 'magnitude-energy', 'cfl-stability'],
    reproducible: true,
    notes:
      'Ray theory on a 1-km sampled radially symmetric PREM-like model (crust / mantle / outer core / inner core); travel times integrate the spherical ray parameter p = r sin i / v analytically inside each constant-velocity shell. The P shadow zone (103°–142°) follows from the core velocity drop; S is absent beyond ~103° because vS = 0 in the outer core. Synthetic seismograms are a Ricker-wavelet superposition, not measured data. Relative-error convention |computed − analytic| / |analytic|.',
    notesI18n: {
      'zh-CN':
        '基于 1 km 采样的径向对称 PREM 类模型（地壳/地幔/外核/内核）的射线理论：球面射线参数 p = r sin i / v 在每个等速壳层内解析积分。P 波影区（103°–142°）由核幔速度跃变自然产生；S 波因外核 vS = 0 在约 103° 以外缺失。合成地震图为 Ricker 子波叠加，非实测记录。相对误差口径 |计算−解析|/|解析|。',
      'en-US':
        'Ray theory on a 1-km sampled radially symmetric PREM-like model (crust / mantle / outer core / inner core); travel times integrate the spherical ray parameter p = r sin i / v analytically inside each constant-velocity shell. The P shadow zone (103°–142°) follows from the core velocity drop; S is absent beyond ~103° because vS = 0 in the outer core. Synthetic seismograms are a Ricker-wavelet superposition, not measured data.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'depth_km, vp_km_s, vs_km_s, density_g_cm3 velocity model' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated velocity model' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace-separated velocity model, # comments allowed' },
  ],
};
