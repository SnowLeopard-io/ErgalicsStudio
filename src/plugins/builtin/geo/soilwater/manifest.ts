import type { PluginManifest } from '@/types/plugin';

export const soilWaterManifest: PluginManifest = {
  id: 'example.geo-soilwater',
  name: 'Soil Water Retention Fit',
  nameI18n: { 'zh-CN': '土壤水分特征曲线拟合', 'en-US': 'Soil Water Retention Fit' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'van Genuchten (1980) soil water characteristic curve fitting: Levenberg-Marquardt nonlinear least squares with box bounds and covariance standard errors, plus derived specific moisture capacity C(h), effective saturation and Young-Laplace equivalent pore radius.',
  descriptionI18n: {
    'zh-CN':
      'van Genuchten (1980) 土壤水分特征曲线拟合：Levenberg-Marquardt 非线性最小二乘（箱式约束 + 协方差标准误），并输出比水容量 C(h)、有效饱和度与 Young-Laplace 等效孔隙半径。',
    'en-US':
      'van Genuchten (1980) soil water characteristic curve fitting: Levenberg-Marquardt nonlinear least squares (box bounds + covariance standard errors), with derived specific moisture capacity C(h), effective saturation and Young-Laplace equivalent pore radius.',
  },
  license: 'MIT',
  entry: 'example.geo-soilwater',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { pressureHead: 'cm', waterContent: 'cm³/cm³', alpha: '1/cm', capacity: '1/cm', poreRadius: 'cm' },
    benchmarks: ['vg-sand-recovery', 'vg-capacity-derivative', 'vg-rmse-convergence'],
    reproducible: true,
    notes:
      'Validation: parameter recovery on seeded synthetic data (1% noise, 24 log-spaced suctions 1-15000 cm) against the published sand parameters of van Genuchten (1980), Table 1 (θr=0.045, θs=0.430, α=0.145 cm⁻¹, n=2.68), relative errors <3%; analytic C(h) vs numerical dθ/dh <1%; LM SSE monotone non-increasing. Relative-error convention |computed-analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准：以 van Genuchten (1980) 表 1 砂土参数（θr=0.045、θs=0.430、α=0.145 cm⁻¹、n=2.68）合成 1% 噪声数据（24 个对数分布吸力点 1–15000 cm）做参数回收，相对误差<3%；解析 C(h) 与数值 dθ/dh 一致性<1%；LM 的 SSE 单调不增。统一相对误差口径 |计算−解析|/|解析|。',
      'en-US':
        'Validation: parameter recovery on seeded synthetic data (1% noise, 24 log-spaced suctions 1-15000 cm) against the published sand parameters of van Genuchten (1980), Table 1 (θr=0.045, θs=0.430, α=0.145 cm⁻¹, n=2.68), relative errors <3%; analytic C(h) vs numerical dθ/dh <1%; LM SSE monotone non-increasing.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'h,theta retention data (suction cm, water content)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated h / theta columns' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace or comma h, theta rows, # comments allowed' },
  ],
};
