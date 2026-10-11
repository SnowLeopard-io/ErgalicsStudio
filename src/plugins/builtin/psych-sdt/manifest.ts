// ==========================================================================
// psych-sdt — signal detection theory ROC / d' analysis, manifest
//
// Equal-variance Gaussian SDT: d' = z(H) - z(F), beta, criterion c, the
// analytic ROC HR = Phi(d' + z(FAR)) and AUC = Phi(d'/sqrt(2)), plus an
// optional unequal-variance model (sigma ratio s). The inverse normal is an
// in-house Acklam rational approximation refined by one Halley step against
// the in-house high-accuracy Phi (regularized incomplete gamma).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const sdtManifest: PluginManifest = {
  id: 'example.psych-sdt',
  name: 'Signal Detection ROC / d′',
  nameI18n: { 'zh-CN': '信号检测论 ROC / d′ 分析', 'en-US': 'Signal Detection ROC / d′' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Equal-variance Gaussian signal detection theory: d′, β, criterion c and AUC from hit/false-alarm rates (or uploaded trial data), analytic ROC with optional unequal-variance σ ratio, signal/noise overlap figure with a draggable d′.',
  descriptionI18n: {
    'zh-CN':
      '等方差高斯信号检测论：由命中率/虚报率（或上传的 trial 数据）计算 d′、β、判断标准 c 与 AUC，绘制解析 ROC（机会线对照）与信号/噪声分布重叠图，支持不等方差系数 s 与拖拽调节 d′；全部数值自实现并内嵌基准验证。',
    'en-US':
      'Equal-variance Gaussian SDT: d′, β, criterion c and AUC from hit/false-alarm rates (or uploaded trial data), analytic ROC against the chance line, signal/noise overlap figure with a draggable d′, optional unequal-variance σ ratio; all numerics in-house with embedded benchmark validation.',
  },
  license: 'MIT',
  entry: 'example.psych-sdt',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    benchmarks: ['psych-sdt-benchmark'],
    reproducible: true,
    notes:
      'Kernel validated against published probit values: d′(H=0.8, F=0.2) = 1.6832 (|err| < 1e-4), Phi^-1(0.975) = 1.959964 (|err| < 1e-6), numerically integrated ROC area vs the closed form AUC = Phi(d′/sqrt(2)) (rel. err < 1e-4), and stability at H = 0.999 / F = 0.001. Uniform error metric |computed - analytic| / |analytic|.',
    notesI18n: {
      'zh-CN':
        '基准：①H=0.8, F=0.2 → d′=1.6832425（z(0.8)=0.8416212，|误差|<1e-4；任务书参考值 1.6868 系笔误，正确 probit 值为 1.6832）；②ROC 数值积分面积 vs 解析 AUC=Φ(d′/√2)，相对误差<1e-4；③H=0.999, F=0.001 极端值数值稳定（d′=6.180465）；④Φ⁻¹(0.975)=1.959964（|误差|<1e-6，Acklam 逆近似 + Halley 精化，Φ 由正则化不完全伽马实现）。出处：Green & Swets (1966) Signal Detection Theory and Psychophysics；Macmillan & Creelman (2005) Detection Theory: A User\'s Guide。',
      'en-US':
        'Benchmarks: (1) H=0.8, F=0.2 → d′=1.6832425 (z(0.8)=0.8416212, |err|<1e-4; the 1.6868 often quoted is a table-reading typo — the correct probit value is 1.6832); (2) numerically integrated ROC area vs the closed form AUC=Phi(d′/sqrt(2)), rel. err<1e-4; (3) numerically stable at H=0.999 / F=0.001 (d′=6.180465); (4) Phi^-1(0.975)=1.959964 (|err|<1e-6; Acklam inverse refined by one Halley step; Phi via the regularized incomplete gamma). Sources: Green & Swets (1966); Macmillan & Creelman (2005).',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'trial table: signal,respond (0/1) or one counts row: hits,misses,falseAlarms,correctRejections' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated signal/respond trials or counts row' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace-separated signal/respond trials or counts row' },
  ],
};
