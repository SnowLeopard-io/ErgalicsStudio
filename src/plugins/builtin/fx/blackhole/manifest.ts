// ==========================================================================
// Black-hole plugin — manifest
//
// Per-pixel Schwarzschild null-geodesic ray tracing (backward ray marching in
// the Binet formulation) rendered as a fullscreen GPU shader through the host
// Three.js scene. The shadow, photon ring, Einstein lensing and the Doppler-
// beamed accretion disk all emerge from the geodesic integration itself.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const blackholeManifest: PluginManifest = {
  id: 'fx.blackhole',
  name: 'Black Hole · 3D Ray Tracer',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Real-time general-relativistic ray tracer: per-pixel Schwarzschild null-geodesic integration (RK4) with a Doppler-beamed thin accretion disk, gravitational redshift and a lensed star field.',
  nameI18n: {
    'zh-CN': '黑洞 · 3D 光线追踪',
    'en-US': 'Black Hole · 3D Ray Tracer',
  },
  descriptionI18n: {
    'zh-CN':
      '广义相对论实时光线追踪：逐像素积分史瓦西零测地线（RK4），含多普勒集束吸积盘、引力红移与引力透镜星空。阴影、光子环与爱因斯坦环均由测地线积分自然产生。',
    'en-US':
      'Real-time GR ray tracing: per-pixel Schwarzschild null-geodesic integration (RK4) with Doppler-beamed accretion disk, gravitational redshift and a lensed star field.',
  },
  license: 'MIT',
  entry: 'fx.blackhole',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { length: 'km', angle: 'μas', temperature: 'K', speed: 'c' },
    reproducible: true,
    notes:
      'Exact Schwarzschild vacuum geodesics (Binet RK4) and a Shakura–Sunyaev thin disk with SR beaming + gravitational shift; shadow diameters are compared against EHT measurements. No spin (Kerr), no GRMHD flow model.',
    notesI18n: {
      'zh-CN':
        '史瓦西真空零测地线精确积分（Binet 形式 RK4）+ Shakura–Sunyaev 薄盘与相对论多普勒/引力频移；阴影角直径可与 EHT 观测对比。不含自旋（Kerr）与 GRMHD 流体模型。',
      'en-US':
        'Exact Schwarzschild vacuum geodesics (Binet RK4) and a Shakura–Sunyaev thin disk with SR beaming + gravitational shift; shadow diameters are compared against EHT measurements. No spin (Kerr), no GRMHD flow model.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Scene preset (mass, disk, distance)' }],
};
