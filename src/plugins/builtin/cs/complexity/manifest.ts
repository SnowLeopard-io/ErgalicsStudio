import type { PluginManifest } from '@/types/plugin';

export const complexityManifest: PluginManifest = {
  id: 'example.complexity',
  name: 'Complexity Analyzer',
  nameI18n: { 'zh-CN': '复杂度分析器', 'en-US': 'Complexity Analyzer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Fit empirical input-size/runtime measurements to O(1), O(log n), O(n), O(n log n), O(n²), O(n³) and O(2ⁿ) models with least squares, rank candidates by R² and plot the log-log curve with residuals. CSV of n,time drives both the UI and Block/Flow.',
  descriptionI18n: {
    'zh-CN':
      '用最小二乘将实测的输入规模/运行时间拟合到 O(1)、O(log n)、O(n)、O(n log n)、O(n²)、O(n³) 与 O(2ⁿ) 模型，按 R² 排序并绘制双对数曲线与残差。n,time 的 CSV 同时驱动界面与 Block/Flow。',
    'en-US':
      'Fit empirical input-size/runtime measurements to O(1), O(log n), O(n), O(n log n), O(n²), O(n³) and O(2ⁿ) models with least squares, rank candidates by R² and plot the log-log curve with residuals. CSV of n,time drives both the UI and Block/Flow.',
  },
  license: 'MIT',
  entry: 'example.complexity',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { inputSize: 'elements', runtime: 'ms', exponent: 'dimensionless' },
    benchmarks: ['linear-fit', 'quadratic-exponent', 'nloglogn-ranking', 'loglog-recover', 'constant-fit'],
    reproducible: true,
    notes:
      'Each candidate model is fitted by ordinary least squares with a single scale factor (and an intercept only for O(1)), then scored by R² on the measured points. Timing data from a browser is noisy — the ranking is a heuristic, not a proof. The fitted exponent is the slope of log(time) versus log(n) over the accepted range.',
    notesI18n: {
      'zh-CN':
        '每个候选模型仅含一个尺度因子（O(1) 另含截距），用普通最小二乘拟合，再以实测点上的 R² 评分。浏览器计时数据存在噪声，排序只是启发式，不是证明。拟合指数为接受区间内 log(time) 对 log(n) 的斜率。',
      'en-US':
        'Each candidate model is fitted by ordinary least squares with a single scale factor (and an intercept only for O(1)), then scored by R² on the measured points. Timing data from a browser is noisy — the ranking is a heuristic, not a proof. The fitted exponent is the slope of log(time) versus log(n) over the accepted range.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'measurements: n, time_ms' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace separated n time pairs, # comments allowed' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '187c1ab23368713ff7cbce010b708c939f77b8c8b4ec202352ec9f27d822250dbe6b831295d200c7b269e4b51501960c4431b9d3e7630d9ecca8aa4ceb289302',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
