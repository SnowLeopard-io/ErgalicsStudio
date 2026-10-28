import type { PluginManifest } from '@/types/plugin';

export const hydrogeologyManifest: PluginManifest = {
  id: 'example.geo-hydrogeology',
  name: 'Hydrogeology Workbench',
  nameI18n: { 'zh-CN': '水文地质模拟工作台', 'en-US': 'Hydrogeology Workbench' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Confined-aquifer well hydraulics with Theis and Cooper–Jacob solutions, Darcy seepage velocity, multi-well superposition and cones of depression, Ogata–Banks contaminant transport with retardation and decay, Cooper–Jacob pumping-test fitting, and tidal / barometric water-level response.',
  descriptionI18n: {
    'zh-CN':
      '承压含水层井流力学：Theis 与 Cooper–Jacob 降深解、Darcy 渗流速度、多井叠加与降落漏斗、含阻滞与衰减的 Ogata–Banks 污染物运移、Cooper–Jacob 抽水试验拟合，以及潮汐/气压水位响应。',
    'en-US':
      'Confined-aquifer well hydraulics with Theis and Cooper–Jacob solutions, Darcy seepage velocity, multi-well superposition and cones of depression, Ogata–Banks contaminant transport with retardation and decay, Cooper–Jacob pumping-test fitting, and tidal / barometric water-level response.',
  },
  license: 'MIT',
  entry: 'example.geo-hydrogeology',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: {
      discharge: 'm³/d',
      transmissivity: 'm²/d',
      storativity: 'dimensionless',
      drawdown: 'm',
      concentration: 'mg/L',
      time: 'd',
    },
    benchmarks: [
      'theis-w1',
      'theis-jacob',
      'darcy-handcalc',
      'ogata-banks-front',
      'superposition-linearity',
      'tidal-attenuation',
      'pumping-fit',
    ],
    reproducible: true,
    notes:
      'Theis uses the exponential-integral well function (series for u<1, Lentz continued fraction otherwise) and assumes a homogeneous, isotropic, infinite confined aquifer with fully penetrating wells. Cooper–Jacob is only applied where u < 0.01. Ogata–Banks is the one-dimensional advection–dispersion solution with a step source at x=0, constant seepage velocity, retardation R and first-order decay; dispersivity is a calibration parameter, not a prediction. Tidal response follows the Jacob (1950) exponential attenuation and linear phase lag with depth. Relative-error convention |computed-analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        'Theis 解使用指数积分井函数（u<1 用级数、否则用 Lentz 连分式），假定均质各向同性无限承压含水层与完整井。Cooper–Jacob 仅在 u<0.01 时适用。Ogata–Banks 为一维对流-弥散解，x=0 处为阶跃源，渗流速度恒定，含阻滞因子 R 与一阶衰减；弥散度为率定参数而非预测值。潮汐响应采用 Jacob (1950) 随深度指数衰减与线性相位滞后。相对误差口径 |计算−解析|/|解析|。',
      'en-US':
        'Theis uses the exponential-integral well function (series for u<1, Lentz continued fraction otherwise) and assumes a homogeneous, isotropic, infinite confined aquifer with fully penetrating wells. Cooper–Jacob is only applied where u < 0.01. Ogata–Banks is the one-dimensional advection–dispersion solution with a step source at x=0, constant seepage velocity, retardation R and first-order decay. Tidal response follows the Jacob (1950) exponential attenuation and linear phase lag with depth.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2eb46ec58a1bc8f44ee99f3bbae647fb',
    sig: 'b7eee183c1c46e8a919afb9b0288755187a0ea1cd62364ecb606ad3515e437daa615ffb5f2d423c0c468afd462a75b94da0d5704dff2cd011f567c8489614206',
    signer: 'Ergalics Studio (geology pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '809d8f315fe838d788e26e088c24ede43245bb9b67614ebe1fad6c2a5e1da6dd',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'pumping test: time_days (or time_min) and drawdown_m columns' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated pumping-test table' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma-separated pumping-test table, # comments allowed' },
  ],
};
