// ==========================================================================
// psych-rt — simple reaction-time experiment + statistics, manifest
//
// In-browser simple RT paradigm (fixed foreperiod drawn from a uniform
// window, catch-free, early presses void the trial) with full descriptive
// statistics (n, mean, median, SD, SEM, exact small-sample 95% t CI), Welch's
// independent-samples t test on two alternating conditions, Cohen's d and the
// standard 100/2000 ms outlier screen. All numerics are in-house pure TS.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const rtManifest: PluginManifest = {
  id: 'example.psych-rt',
  name: 'Reaction Time Lab',
  nameI18n: { 'zh-CN': '简单反应时实验室', 'en-US': 'Reaction Time Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'In-browser simple reaction-time experiment (uniform 1.5–4 s foreperiod, early presses void the trial) with descriptive statistics, exact 95% t CIs, Welch t test across two conditions, Cohen\'s d, outlier screening and RT sequence/histogram/box plots.',
  descriptionI18n: {
    'zh-CN':
      '浏览器内简单反应时实验：等待期在 1.5–4 s 均匀随机（提前按键作废该试次），完成后给出 n/均值/中位数/SD/SEM/精确 95% t 置信区间、双条件 Welch t 检验（Satterthwaite 自由度 + 不完全 beta 精确 p）、Cohen\'s d 与 100/2000 ms 离群值筛查，并绘制 RT 序列点图、直方图（正态叠加）与箱线图；统计内核全部自实现并内嵌基准验证。',
    'en-US':
      'In-browser simple RT experiment: uniform 1.5–4 s foreperiod, early presses void the trial; reports n/mean/median/SD/SEM with exact 95% t CIs, Welch t test across two alternating conditions (Satterthwaite df + exact incomplete-beta p), Cohen\'s d, 100/2000 ms outlier screening, and RT sequence/histogram (normal overlay)/box plots; all numerics in-house with embedded benchmark validation.',
  },
  license: 'MIT',
  entry: 'example.psych-rt',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    benchmarks: ['psych-rt-benchmark'],
    reproducible: true,
    units: { rt: 'ms' },
    notes:
      'Kernel validated on hand-computable anchors: Welch t for [1,2,3,4] vs [5,6,7,8] equals -4*sqrt(6/5) = -4.3817805 with df = 6 (rel. err < 1e-9); p(t = 2.447, df = 6) = 0.049907 matches the 0.05 critical value (|err| < 1e-3); the 95% CI is self-consistent (mean ± t_{0.975,df}·SEM, symmetric); the outlier screen keeps [250, 300] and removes [50, 5000, 90] at the 100/2000 ms window. Uniform error metric |computed - analytic| / |analytic|.',
    notesI18n: {
      'zh-CN':
        '基准：①Welch t 检验 [1,2,3,4] vs [5,6,7,8] 手工解析值 t = −4·√(6/5) = −4.3817805、df = 6，相对误差 < 1e-9；②p(t = 2.447, df = 6) = 0.049907 对应 0.05 临界值（|误差| < 1e-3），t_{0.975,6} = 2.446912（|误差| < 1e-6，精确 t 分布由正则化不完全 beta 实现）；③95% CI 自洽（均值 ± t_{0.975,df}·SEM，区间对称，用 [2,4,4,4,5,5,7,9] 验证 mean=5、样本 SD=√(32/7)≈2.1381、median=4.5）；④离群值筛查在 [100, 2000] ms 窗口内正确保留 [250, 300]、剔除 [50, 5000, 90]。出处：Welch (1947) Biometrika 34:28-35；Cohen (1988) Statistical Power Analysis for the Behavioral Sciences。',
      'en-US':
        'Benchmarks: (1) Welch t for [1,2,3,4] vs [5,6,7,8] against the hand value t = -4·sqrt(6/5) = -4.3817805 with df = 6, rel. err < 1e-9; (2) p(t = 2.447, df = 6) = 0.049907 vs the 0.05 critical value (|err| < 1e-3) and t_{0.975,6} = 2.446912 (|err| < 1e-6; exact t distribution via the regularized incomplete beta); (3) self-consistent 95% CI (mean ± t_{0.975,df}·SEM, symmetric; verified on [2,4,4,4,5,5,7,9]: mean = 5, sample SD = sqrt(32/7) ≈ 2.1381, median = 4.5); (4) the outlier screen keeps [250, 300] and removes [50, 5000, 90] at the [100, 2000] ms window. Sources: Welch (1947) Biometrika 34:28-35; Cohen (1988).',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'trial table: condition,rt (rt in ms)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated condition,rt trials' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace-separated condition,rt trials or a single-column RT list' },
  ],
};
